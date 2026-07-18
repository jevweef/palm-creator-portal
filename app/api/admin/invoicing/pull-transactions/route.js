import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'
import { ofApi, createDataExport, waitForDataExport, downloadExportCsv } from '@/lib/onlyfansApi'
import {
  sheetsClient, ensureTab, ensureExtraHeaders, getCutoff, getLastFingerprints,
  txnFingerprint, insertRowsAtTop, updateCutoffBanner, utcToEtDateTime, utcToEtDate,
  mapType, stripHtmlText, fetchRevenueAccountNames, fetchRevenueAccountsApiState,
} from '@/lib/transactionsSheet'
import { stampWhaleRun } from '@/lib/whaleRuns'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// POST — the API replacement for the manual HTML earnings upload. ONE ingestion
// system: pulls transactions + chargebacks from the OF API and appends them to
// the SAME Google Sheet tabs the HTML upload writes, in the SAME format
// (columns A–I identical, ET timezone, same fingerprint dedup, newest-first
// insert, cutoff banner, Airtable coverage update). Everything that reads the
// sheet today (invoices, earnings dashboard, going-cold, Ed) keeps working —
// they can't tell an API row from an HTML row. Richer API-only data (fan_id,
// VAT, source) goes in columns J–L, which no existing reader touches.
//
// Body: { creatorRecordId, accountName }  (accountName = Revenue Account name,
//        e.g. "Meadow Marie - Free OF" — the sheet tab prefix)
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorRecordId, accountName, sinceDate } = await request.json()
    if (!creatorRecordId || !accountName) {
      return NextResponse.json({ error: 'creatorRecordId and accountName required' }, { status: 400 })
    }
    // Optional override: force the pull window back to `sinceDate` (YYYY-MM-DD)
    // to recover a MID-RANGE gap the normal cutoff-minus-4d window won't reach.
    // The multiset dedup makes re-covering already-present days harmless.
    const sinceOverride = sinceDate ? new Date(`${sinceDate}T00:00:00Z`) : null

    const creators = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(creatorRecordId)}`,
      fields: ['Creator', 'AKA', 'OF API Account ID'],
    })
    const cf = creators[0]?.fields || {}
    // Per-account first (Revenue Accounts 'OF API Connect'/'OF API Account
    // ID'): pulling THIS account requires THIS account's id — the legacy
    // fallback (VIP name → 2nd ops id, else 1st) pulled the Free account's
    // data into a VIP tab when the VIP page wasn't connected.
    const apiState = await fetchRevenueAccountsApiState(cf.AKA || cf.Creator)
    const acct = apiState.find((a) => a.name.toLowerCase() === String(accountName).toLowerCase())
    let ofAccountId
    if (acct && (acct.connect || acct.acctId)) {
      if (acct.connect === 'Skip') {
        return NextResponse.json({ error: `${accountName} is marked Skip for the OF API — connect it on the onboarding board first` }, { status: 400 })
      }
      ofAccountId = acct.acctId
    } else {
      // Legacy fallback (no per-account data on the record).
      const idList = String(cf['OF API Account ID'] || '').split(',').map((x) => x.trim()).filter(Boolean)
      ofAccountId = /vip/i.test(String(accountName)) ? (idList[1] || idList[0]) : idList[0]
    }
    if (!ofAccountId) {
      return NextResponse.json({ error: `${accountName} isn't connected to the OnlyFans API yet — connect it on the onboarding board` }, { status: 400 })
    }

    const sheets = sheetsClient()
    const results = {}

    for (const dataType of ['Sales', 'Chargebacks']) {
      const exportType = dataType === 'Sales' ? 'transactions' : 'chargebacks'
      const { tabName } = await ensureTab(sheets, accountName, dataType)
      await ensureExtraHeaders(sheets, tabName)

      // Window: from the tab's own cutoff (its newest row, ET) minus a 4-day
      // overlap (covers the ET/UTC offset + stragglers — fingerprint dedup
      // makes the overlap harmless), or 365 days on an empty tab.
      const cutoff = await getCutoff(sheets, tabName)
      const end = new Date()
      const start = sinceOverride
        || (cutoff
          ? new Date(cutoff.getTime() - 4 * 86400000)
          : new Date(end.getTime() - 365 * 86400000))

      const exp = await createDataExport({
        type: exportType,
        accountIds: [ofAccountId],
        startDate: start.toISOString().slice(0, 10) + 'T00:00:00Z',
        endDate: end.toISOString().slice(0, 19) + 'Z',
      })
      const done = await waitForDataExport(exp.id)
      const csv = await downloadExportCsv(done)
      const parsed = parseCsvObjects(csv)

      // Transform API rows → sheet rows (columns A–L)
      const isSales = dataType === 'Sales'
      const txns = []
      for (const t of parsed) {
        const status = (t.status || '').toLowerCase()
        // OF marks recent transactions 'loading' until they clear — those DO
        // appear on the statements page (the HTML flow always included them),
        // so only skip explicit failure states. (Bug found 2026-07-03: the
        // old status==='done' filter silently dropped everything recent.)
        if (isSales && ['failed', 'cancelled', 'canceled', 'refunded', 'error'].includes(status)) continue
        const created = t.onlyfans_created_at || t.created_at || ''
        if (!created) continue
        const gross = parseFloat(t.amount || '0') || 0
        const fee = parseFloat(t.fee_amount || '0') || 0
        const net = parseFloat(t.net_amount || '0') || 0
        const displayName = stripHtmlText((t.description || '').replace(/^.*?from\s+/i, '')) || (t.fan_name || '')
        const sign = isSales ? 1 : -1 // chargebacks are negative, matching the HTML parser
        txns.push({
          dateTimeEt: utcToEtDateTime(created),
          gross: sign * gross,
          fee: sign * fee,
          net: sign * net,
          type: isSales ? mapType(t.type) : `Chargeback`,
          displayName,
          fanId: t.fan_id || '',
          vat: t.vat_amount || '',
          originalDate: !isSales && t.payment_created_at ? utcToEtDate(t.payment_created_at) : '',
          description: (isSales ? '' : 'Chargeback: ') + stripHtmlText(t.description || ''),
        })
      }

      // Resolve usernames from fan_ids (mass endpoint, 10 per call) — the
      // HTML flow got these from profile links; the API needs one lookup.
      const fanIds = [...new Set(txns.map((t) => t.fanId).filter(Boolean))]
      const userMap = {}
      for (let i = 0; i < fanIds.length; i += 10) {
        try {
          const json = await ofApi(`/${ofAccountId}/users/list?ids=${fanIds.slice(i, i + 10).join(',')}`)
          const users = json?.data ?? json ?? []
          for (const u of Array.isArray(users) ? users : Object.values(users)) {
            if (u?.id) userMap[String(u.id)] = u.username || ''
          }
        } catch { /* usernames stay blank like deleted accounts in HTML flow */ }
      }

      // Dedup — MULTISET diff against the tab's recent rows. The fingerprint
      // (datetime|net|displayName) collides when a fan makes two identical-value
      // transactions in the same minute; a boolean check dropped the sibling, so
      // we instead keep an incoming row only while the sheet is still short by
      // one of that fingerprint (getLastFingerprints returns counts).
      const remainingFps = new Map(await getLastFingerprints(sheets, tabName))
      const fresh = txns.filter((t) => {
        const fp = txnFingerprint(t.dateTimeEt, t.net, t.displayName)
        const have = remainingFps.get(fp) || 0
        if (have > 0) { remainingFps.set(fp, have - 1); return false } // already in the sheet
        return true // new — or a legit same-minute sibling the sheet is missing
      })
        .filter((t) => !cutoff || new Date(t.dateTimeEt.replace(' ', 'T') + ':00') > new Date(cutoff.getTime() - 4 * 86400000))

      // Newest first, then insert at top (identical to the HTML flow).
      fresh.sort((a, b) => (b.dateTimeEt || '').localeCompare(a.dateTimeEt || ''))
      const rows = fresh.map((t) => [
        t.dateTimeEt, t.gross, t.fee, t.net, t.type, t.displayName,
        userMap[t.fanId] || '', t.originalDate, t.description,
        t.fanId, t.vat, 'API',
      ])
      await insertRowsAtTop(sheets, tabName, rows)

      // Cutoff banner reflects the newest datetime now on the tab.
      let newCutoff = cutoff
      for (const t of fresh) {
        const d = new Date(t.dateTimeEt.replace(' ', 'T') + ':00')
        if (!isNaN(d) && (!newCutoff || d > newCutoff)) newCutoff = d
      }
      if (rows.length) await updateCutoffBanner(sheets, tabName, newCutoff)

      const earliest = txns.map((t) => t.dateTimeEt.slice(0, 10)).filter(Boolean).sort()[0] || null
      results[dataType] = { parsed: txns.length, uploaded: rows.length, skipped: txns.length - rows.length, credits: done.credit_cost ?? null, tab: tabName, earliest }
    }

    // Airtable coverage — same fields the HTML upload maintains, so the
    // coverage chart + Ed's freshness checks reflect API pulls too.
    await updateCoverage(accountName, results)

    await stampWhaleRun(creatorRecordId, 'sales')
    return NextResponse.json({ ok: true, creator: cf.AKA || cf.Creator, accountName, ...results })
  } catch (err) {
    console.error('[pull-transactions] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// GET — list connected creators + their Revenue Account names so the UI can
// render pull buttons only where they'll work.
export async function GET() {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const creators = await fetchAirtableRecords('Palm Creators', {
      fields: ['Creator', 'AKA', 'OF API Account ID'],
    })
    const connected = creators.filter((c) => c.fields?.['OF API Account ID'])
    const out = []
    for (const c of connected) {
      const aka = c.fields.AKA || c.fields.Creator
      // Per-account: only offer pull buttons for accounts actually connected
      // (decision=Connect with an id). Accounts with no per-account data yet
      // (legacy) stay offered via the name list.
      const apiState = await fetchRevenueAccountsApiState(aka)
      let accounts
      if (apiState.length) {
        accounts = apiState.filter((a) => a.connect === 'Connect' && a.acctId).map((a) => a.name)
      } else {
        accounts = await fetchRevenueAccountNames(aka)
      }
      if (!accounts.length && !apiState.length) accounts = [`${aka} - Free OF`]
      if (accounts.length) {
        out.push({ creatorRecordId: c.id, aka, accounts })
      }
    }
    return NextResponse.json({ connected: out })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

const HQ_BASE = 'appL7c4Wtotpz07KS'
const REVENUE_ACCOUNTS_TABLE = 'tblQqPWlsjiyJA0ba'
const RA_FIELDS = {
  earningsStart: 'fldIFvqIOE1mFCFbq', earningsEnd: 'fldZtO52nDZXKY0R7', earningsLastUpload: 'fldxD7iDFZHWttC9n',
  chargebackStart: 'fldcWM6RkZUsNyUlp', chargebackEnd: 'fldCbyspe7EiJo0iW', chargebacksLastUpload: 'fldNCy327oIndVw2R',
}


async function updateCoverage(accountName, results) {
  try {
    const params = new URLSearchParams()
    params.append('filterByFormula', `{Account Name} = ${quoteAirtableString(accountName)}`)
    params.append('fields[]', RA_FIELDS.earningsStart)
    params.append('fields[]', RA_FIELDS.chargebackStart)
    params.append('returnFieldsByFieldId', 'true')
    params.append('pageSize', '1')
    const res = await fetch(`https://api.airtable.com/v0/${HQ_BASE}/${REVENUE_ACCOUNTS_TABLE}?${params}`, {
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` },
    })
    if (!res.ok) return
    const record = (await res.json()).records?.[0]
    if (!record) return
    const nowIso = new Date().toISOString()
    const today = nowIso.split('T')[0]
    const fields = {}
    const cur = record.fields || {}
    if (results.Sales) {
      fields[RA_FIELDS.earningsEnd] = today
      fields[RA_FIELDS.earningsLastUpload] = nowIso
      // Start: earliest pulled txn if it's earlier than (or replaces a missing) start
      const e = results.Sales.earliest
      if (e && (!cur[RA_FIELDS.earningsStart] || e < cur[RA_FIELDS.earningsStart])) fields[RA_FIELDS.earningsStart] = e
    }
    if (results.Chargebacks) {
      fields[RA_FIELDS.chargebackEnd] = today
      fields[RA_FIELDS.chargebacksLastUpload] = nowIso
      const e = results.Chargebacks.earliest
      if (e && (!cur[RA_FIELDS.chargebackStart] || e < cur[RA_FIELDS.chargebackStart])) fields[RA_FIELDS.chargebackStart] = e
      else if (!cur[RA_FIELDS.chargebackStart]) {
        // No chargebacks pulled — anchor to earnings start (same as HTML flow)
        const es = fields[RA_FIELDS.earningsStart] || cur[RA_FIELDS.earningsStart]
        if (es) fields[RA_FIELDS.chargebackStart] = es
      }
    }
    await fetch(`https://api.airtable.com/v0/${HQ_BASE}/${REVENUE_ACCOUNTS_TABLE}/${record.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    })
  } catch (e) { console.warn('[pull-transactions] coverage update failed:', e.message) }
}

function parseCsvObjects(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return []
  const split = (line) => {
    const out = []; let cur = ''; let q = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c }
      else if (c === '"') q = true
      else if (c === ',') { out.push(cur); cur = '' }
      else cur += c
    }
    out.push(cur); return out
  }
  const headers = split(lines[0])
  return lines.slice(1).map((l) => Object.fromEntries(headers.map((h, i) => [h, split(l)[i] ?? ''])))
}
