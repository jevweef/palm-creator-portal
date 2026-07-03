import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'
import { ofApi, createDataExport, waitForDataExport, downloadExportCsv } from '@/lib/onlyfansApi'
import {
  sheetsClient, ensureTab, ensureExtraHeaders, getCutoff, getLastFingerprints,
  txnFingerprint, insertRowsAtTop, updateCutoffBanner, utcToEtDateTime, utcToEtDate,
  mapType, stripHtmlText, fetchRevenueAccountNames,
} from '@/lib/transactionsSheet'

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
    const { creatorRecordId, accountName } = await request.json()
    if (!creatorRecordId || !accountName) {
      return NextResponse.json({ error: 'creatorRecordId and accountName required' }, { status: 400 })
    }

    const creators = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(creatorRecordId)}`,
      fields: ['Creator', 'AKA', 'OF API Account ID'],
    })
    const cf = creators[0]?.fields || {}
    const ofAccountId = cf['OF API Account ID']
    if (!ofAccountId) {
      return NextResponse.json({ error: `${cf.AKA || 'This creator'} isn't connected to the OnlyFans API yet` }, { status: 400 })
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
      const start = cutoff
        ? new Date(cutoff.getTime() - 4 * 86400000)
        : new Date(end.getTime() - 365 * 86400000)

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
        if (isSales && status && status !== 'done') continue // pending/failed never hit statements
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

      // Dedup — same fingerprint as the HTML upload (datetime|net|displayName),
      // against the tab's recent rows.
      const existingFps = await getLastFingerprints(sheets, tabName, 120)
      const fresh = txns.filter((t) => !existingFps.has(txnFingerprint(t.dateTimeEt, t.net, t.displayName)))
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

      results[dataType] = { parsed: txns.length, uploaded: rows.length, skipped: txns.length - rows.length, credits: done.credit_cost ?? null, tab: tabName }
    }

    // Airtable coverage — same fields the HTML upload maintains, so the
    // coverage chart + Ed's freshness checks reflect API pulls too.
    await updateCoverage(accountName, results)

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
      const accounts = await fetchRevenueAccountNames(c.fields.AKA || c.fields.Creator)
      out.push({
        creatorRecordId: c.id,
        aka: c.fields.AKA || c.fields.Creator,
        accounts: accounts.length ? accounts : [`${c.fields.AKA || c.fields.Creator} - Free OF`],
      })
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
    if (results.Sales) { fields[RA_FIELDS.earningsEnd] = today; fields[RA_FIELDS.earningsLastUpload] = nowIso }
    if (results.Chargebacks) { fields[RA_FIELDS.chargebackEnd] = today; fields[RA_FIELDS.chargebacksLastUpload] = nowIso }
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
