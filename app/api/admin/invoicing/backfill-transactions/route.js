import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'
import { ofApi, createDataExport, waitForDataExport, downloadExportCsv, findDataExport, getDataExport } from '@/lib/onlyfansApi'
import {
  sheetsClient, ensureTab, ensureExtraHeaders, readTabRows, txnFingerprint,
  appendRowsAtBottom, utcToEtDateTime, utcToEtDate, mapType, stripHtmlText,
} from '@/lib/transactionsSheet'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// POST — ONE-TIME deep-history backfill. Fills the sheet UNDERNEATH the
// existing data, back to `years` (default 2) before today. Credit-frugal by
// design: exports are billed per row (1 credit / 20 rows), so we only export
// the window the tab is MISSING — from the 2-year mark up to the tab's oldest
// row. A tab already covered that far back exports nothing and costs nothing.
// The regular "Update Sales & Chargebacks" button owns the recent end; this
// owns the historical end. Rows append at the BOTTOM (they're the oldest).
//
// Body: { creatorRecordId, accountName, years?=2 }
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorRecordId, accountName, years = 2 } = await request.json()
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
    const targetStart = new Date(Date.now() - years * 365 * 86400000)
    const results = {}

    for (const dataType of ['Sales', 'Chargebacks']) {
      const exportType = dataType === 'Sales' ? 'transactions' : 'chargebacks'
      const { tabName } = await ensureTab(sheets, accountName, dataType)
      await ensureExtraHeaders(sheets, tabName)

      // What does the tab already cover? Only export the missing older window.
      const existing = await readTabRows(sheets, tabName)
      const dts = existing.map((r) => r.dateTime).filter(Boolean).sort()
      const oldest = dts[0] || null

      let windowEnd
      if (!oldest) {
        windowEnd = new Date() // empty tab → full window
      } else {
        const oldestDt = new Date(oldest.replace(' ', 'T') + ':00Z')
        // Covered to (or past) the target already → nothing to pull, 0 credits.
        // 2-day margin absorbs the ET/UTC offset.
        if (oldestDt.getTime() <= targetStart.getTime() + 2 * 86400000) {
          results[dataType] = { uploaded: 0, skipped: 0, credits: 0, tab: tabName, note: `already covered back to ${oldest.slice(0, 10)}` }
          continue
        }
        windowEnd = new Date(oldestDt.getTime() + 86400000) // +1d overlap; dedup handles it
      }

      // Big accounts take many minutes to scrape (Caitie's missing year =
      // 11,300 rows). ATTACH to an existing export for this exact window
      // instead of creating a duplicate (the API 404s those); if it's still
      // running, report progress and let the user click again later —
      // "pending" is a normal state here, not an error.
      const startDate = targetStart.toISOString().slice(0, 10) + 'T00:00:00Z'
      const endDate = windowEnd.toISOString().slice(0, 19) + 'Z'
      let done = null
      const prior = await findDataExport({ type: exportType, accountId: ofAccountId, startDate, endDate })
      if (prior?.status === 'completed') {
        done = prior // reuse — already paid for, downloading is free
      } else if (prior) {
        results[dataType] = { pending: true, progress: prior.progress_percentage ?? 0, totalRows: prior.total_rows ?? null, tab: tabName }
        continue
      } else {
        const exp = await createDataExport({ type: exportType, accountIds: [ofAccountId], startDate, endDate })
        try {
          done = await waitForDataExport(exp.id, { maxWaitMs: 150000 })
        } catch (e) {
          if (!/timed out/i.test(e.message)) throw e
          const d = await getDataExport(exp.id).catch(() => null)
          results[dataType] = { pending: true, progress: d?.progress_percentage ?? 0, totalRows: d?.total_rows ?? null, tab: tabName }
          continue
        }
      }
      const csv = await downloadExportCsv(done)
      const parsed = parseCsvObjects(csv)

      // Transform — identical to pull-transactions (columns A–L, ET, signs).
      const isSales = dataType === 'Sales'
      const txns = []
      for (const t of parsed) {
        const status = (t.status || '').toLowerCase()
        if (isSales && ['failed', 'cancelled', 'canceled', 'refunded', 'error'].includes(status)) continue
        const created = t.onlyfans_created_at || t.created_at || ''
        if (!created) continue
        const gross = parseFloat(t.amount || '0') || 0
        const fee = parseFloat(t.fee_amount || '0') || 0
        const net = parseFloat(t.net_amount || '0') || 0
        const displayName = stripHtmlText((t.description || '').replace(/^.*?from\s+/i, '')) || (t.fan_name || '')
        const sign = isSales ? 1 : -1
        txns.push({
          dateTimeEt: utcToEtDateTime(created),
          gross: sign * gross,
          fee: sign * fee,
          net: sign * net,
          type: isSales ? mapType(t.type) : 'Chargeback',
          displayName,
          fanId: t.fan_id || '',
          vat: t.vat_amount || '',
          originalDate: !isSales && t.payment_created_at ? utcToEtDate(t.payment_created_at) : '',
          description: (isSales ? '' : 'Chargeback: ') + stripHtmlText(t.description || ''),
        })
      }

      // Usernames from fan_ids (mass endpoint, 10 per call)
      const fanIds = [...new Set(txns.map((t) => t.fanId).filter(Boolean))]
      const userMap = {}
      for (let i = 0; i < fanIds.length; i += 10) {
        try {
          const json = await ofApi(`/${ofAccountId}/users/list?ids=${fanIds.slice(i, i + 10).join(',')}`)
          const users = json?.data ?? json ?? []
          for (const u of Array.isArray(users) ? users : Object.values(users)) {
            if (u?.id) userMap[String(u.id)] = u.username || ''
          }
        } catch { /* usernames stay blank like deleted accounts */ }
      }

      // Dedup against the WHOLE tab (backfill overlaps the oldest rows, not
      // the newest, so the top-rows fingerprint window doesn't apply here).
      const existingFps = new Set(existing.map((r) => txnFingerprint(r.dateTime, r.net, r.displayName)))
      const fresh = txns.filter((t) => !existingFps.has(txnFingerprint(t.dateTimeEt, t.net, t.displayName)))

      // Newest-first within the batch, appended under the oldest existing row
      // → the whole tab stays globally newest-first. Cutoff banner untouched
      // (the newest row didn't change).
      fresh.sort((a, b) => (b.dateTimeEt || '').localeCompare(a.dateTimeEt || ''))
      const rows = fresh.map((t) => [
        t.dateTimeEt, t.gross, t.fee, t.net, t.type, t.displayName,
        userMap[t.fanId] || '', t.originalDate, t.description,
        t.fanId, t.vat, 'API',
      ])
      await appendRowsAtBottom(sheets, tabName, rows)

      const earliest = fresh.map((t) => t.dateTimeEt.slice(0, 10)).filter(Boolean).sort()[0] || null
      results[dataType] = { parsed: txns.length, uploaded: rows.length, skipped: txns.length - rows.length, credits: done.credit_cost ?? null, tab: tabName, earliest }
    }

    await updateCoverageStart(accountName, results)
    return NextResponse.json({ ok: true, creator: cf.AKA || cf.Creator, accountName, years, ...results })
  } catch (err) {
    console.error('[backfill-transactions] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

const HQ_BASE = 'appL7c4Wtotpz07KS'
const REVENUE_ACCOUNTS_TABLE = 'tblQqPWlsjiyJA0ba'
const RA_FIELDS = {
  earningsStart: 'fldIFvqIOE1mFCFbq',
  chargebackStart: 'fldcWM6RkZUsNyUlp',
}

// Backfill only ever EXTENDS coverage backwards — set the start dates earlier
// when the pulled data reaches earlier; never touch end/last-upload (the
// regular update button owns those).
async function updateCoverageStart(accountName, results) {
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
    const cur = record.fields || {}
    const fields = {}
    const se = results.Sales?.earliest
    if (se && (!cur[RA_FIELDS.earningsStart] || se < cur[RA_FIELDS.earningsStart])) fields[RA_FIELDS.earningsStart] = se
    const ce = results.Chargebacks?.earliest
    if (ce && (!cur[RA_FIELDS.chargebackStart] || ce < cur[RA_FIELDS.chargebackStart])) fields[RA_FIELDS.chargebackStart] = ce
    if (!Object.keys(fields).length) return
    await fetch(`https://api.airtable.com/v0/${HQ_BASE}/${REVENUE_ACCOUNTS_TABLE}/${record.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    })
  } catch (e) { console.warn('[backfill-transactions] coverage update failed:', e.message) }
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
