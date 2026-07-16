import { NextResponse } from 'next/server'
import { stampWhaleRun } from '@/lib/whaleRuns'
import { ofApi } from '@/lib/onlyfansApi'
import {
  sheetsClient, ensureTab, ensureExtraHeaders, insertRowsAtTop,
  utcToEtDateTime, mapType, stripHtmlText, withRetry,
} from '@/lib/transactionsSheet'
import { SPREADSHEET_ID } from '@/lib/transactionsSheet'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Nightly self-healing sync for the transactions sheet. The webhook keeps
// sales current in real time, but it has no chargeback event and can miss a
// delivery (outage, deploy gap, upstream hiccup — the Jul 3→4 webhook cutover
// left a $3.4k hole found by audit). This cron re-reads the cheap LIST
// endpoints (1 credit/page, NOT the per-row exports) and fills whatever the
// tabs are missing:
//   Sales       — last 3 days per account
//   Chargebacks — last 35 days per account (they surface late by nature)
// ~20 credits/night across 7 accounts. After each account it stamps the
// Revenue Accounts coverage fields, so the invoicing UI's "Last upload"
// reflects verified-current data — no manual button click needed before
// invoicing.

const OPS_BASE = 'applLIT2t83plMqNx'
const HQ_BASE = 'appL7c4Wtotpz07KS'
const RA_TABLE = 'tblQqPWlsjiyJA0ba'
const RA = {
  earningsEnd: 'fldZtO52nDZXKY0R7', earningsLastUpload: 'fldxD7iDFZHWttC9n',
  chargebackEnd: 'fldCbyspe7EiJo0iW', chargebacksLastUpload: 'fldNCy327oIndVw2R',
}

export async function GET(request) {
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  if (expectedAuth && request.headers.get('authorization') !== expectedAuth) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  // ?salesDays=N (max 30) — manual deeper sweeps for known outage windows
  // (Jul 2-3 2026 predated both the hardened webhook store and this cron).
  const salesDays = Math.min(30, Math.max(3, Number(new URL(request.url).searchParams.get('salesDays')) || 3))

  try {
    const accounts = await connectedAccounts()
    const sheets = sheetsClient()
    const results = {}
    let credits = 0

    for (const acct of accounts) {
      const r = { sales: 0, chargebacks: 0 }
      try {
        // ── Sales: last 3 days vs the tab ──────────────────────────────────
        const { tabName } = await ensureTab(sheets, acct.accountName, 'Sales')
        await ensureExtraHeaders(sheets, tabName)
        const salesCutoff = Date.now() - salesDays * 86400000
        const txns = await pageList(acct.id, 'transactions', salesCutoff, (n) => { credits += n })
        const fresh = txns
          .filter((t) => !['failed', 'cancelled', 'canceled', 'refunded', 'error'].includes(String(t.status || '').toLowerCase()))
          .map((t) => ({
            dtEt: utcToEtDateTime(t.createdAt || ''),
            row: [
              utcToEtDateTime(t.createdAt || ''), +t.amount || 0, +t.fee || 0, +t.net || 0,
              mapType(t.type), displayNameOf(t), t.user?.username || '', '',
              stripHtmlText(t.description || ''),
              t.user?.id != null ? String(t.user.id) : '', t.vatAmount ?? '', 'API',
            ],
            net: +t.net || 0,
          }))
        r.sales = await fillMissing(sheets, tabName, fresh)

        // ── Chargebacks: last 35 days (no webhook event exists for these) ──
        const { tabName: cbTab } = await ensureTab(sheets, acct.accountName, 'Chargebacks')
        await ensureExtraHeaders(sheets, cbTab)
        const cbCutoff = Date.now() - 35 * 86400000
        const cbs = await pageList(acct.id, 'chargebacks', cbCutoff, (n) => { credits += n })
        const cbFresh = cbs.map((c) => {
          const p = c.payment || {}
          return {
            dtEt: utcToEtDateTime(c.createdAt || ''),
            row: [
              utcToEtDateTime(c.createdAt || ''), -(+p.amount || 0), -(+p.fee || 0), -(+p.net || 0),
              'Chargeback', displayNameOf(p), p.user?.username || '',
              p.createdAt ? utcToEtDateTime(p.createdAt).slice(0, 10) : '',
              'Chargeback: ' + stripHtmlText(p.description || ''),
              p.user?.id != null ? String(p.user.id) : '', p.vatAmount ?? '', 'API',
            ],
            net: -(+p.net || 0),
          }
        })
        r.chargebacks = await fillMissing(sheets, cbTab, cbFresh)

        await stampCoverage(acct.accountName)
        // keep the whale tab's 'Sales & chargebacks' stamp honest — the
        // nightly true-up IS a sales refresh
        if (acct.creatorRecordId) await stampWhaleRun(acct.creatorRecordId, 'sales')
      } catch (e) {
        r.error = e.message
        console.error(`[trueup] ${acct.accountName}:`, e.message)
      }
      results[acct.accountName] = r
    }

    const filled = Object.values(results).reduce((s, r) => s + (r.sales || 0) + (r.chargebacks || 0), 0)
    console.log(`[trueup] done — filled ${filled} rows, ~${credits} credits`, JSON.stringify(results))
    return NextResponse.json({ ok: true, filled, credits, results })
  } catch (err) {
    console.error('[trueup] fatal:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

// All accounts with an OF API id, resolved to their Revenue Account name
// (same Free/VIP convention as the webhook receiver).
async function connectedAccounts() {
  const res = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent('Palm Creators')}?pageSize=100&fields%5B%5D=AKA&fields%5B%5D=Creator&fields%5B%5D=OF%20API%20Account%20ID`,
    { headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` } },
  )
  if (!res.ok) throw new Error(`Airtable creators ${res.status}`)
  const { fetchRevenueAccountNames } = await import('@/lib/transactionsSheet')
  const out = []
  for (const rec of (await res.json()).records || []) {
    const ids = String(rec.fields?.['OF API Account ID'] || '').split(',').map((x) => x.trim()).filter(Boolean)
    if (!ids.length) continue
    const aka = rec.fields?.AKA || rec.fields?.Creator
    const names = await fetchRevenueAccountNames(aka)
    ids.forEach((id, i) => {
      const isVip = ids.length > 1 && i > 0
      const accountName = (isVip
        ? names.find((n) => /vip/i.test(n))
        : names.find((n) => !/vip/i.test(n))) || names[0] || `${aka} - ${isVip ? 'VIP' : 'Free'} OF`
      out.push({ id, accountName, creatorRecordId: rec.id })
    })
  }
  return out
}

// Marker-paginate a list endpoint back to `cutoffMs`; returns only rows newer.
async function pageList(accountId, kind, cutoffMs, countCredits) {
  const all = []
  let marker = null
  for (let page = 0; page < 25; page++) {
    const json = await ofApi(`/${accountId}/${kind}?limit=100${marker ? `&marker=${marker}` : ''}`)
    countCredits(1)
    const d = json?.data || {}
    const list = d.list || []
    all.push(...list)
    const oldest = list[list.length - 1]?.createdAt
    if (!d.hasMore || !d.nextMarker || !list.length || (oldest && new Date(oldest).getTime() < cutoffMs)) break
    marker = d.nextMarker
  }
  return all.filter((x) => x.createdAt && new Date(x.createdAt).getTime() >= cutoffMs)
}

function displayNameOf(t) {
  return stripHtmlText(String(t.description || '').replace(/^.*?from\s+/i, '')) || (t.user?.name || '')
}

// Insert rows the tab doesn't have (matched on ET-minute + net, the same
// fingerprint core the pull/webhook writers dedup on).
async function fillMissing(sheets, tabName, fresh) {
  if (!fresh.length) return 0
  const res = await withRetry(() => sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID, range: `'${tabName}'!A4:L`,
  }), `trueup read ${tabName}`)
  // MULTISET diff, not presence: same-minute + same-net siblings share a key,
  // so a boolean Set dropped the second one. Keep an incoming row only while the
  // sheet is still short by one of that key (see getLastFingerprints note).
  const remaining = new Map()
  for (const r of (res.data.values || [])) {
    const k = `${r[0] || ''}|${(parseFloat(r[3]) || 0).toFixed(2)}`
    remaining.set(k, (remaining.get(k) || 0) + 1)
  }
  const rows = []
  for (const f of fresh.filter((f) => f.dtEt).sort((a, b) => (b.dtEt || '').localeCompare(a.dtEt || ''))) {
    const k = `${f.dtEt}|${f.net.toFixed(2)}`
    const have = remaining.get(k) || 0
    if (have > 0) { remaining.set(k, have - 1); continue }
    rows.push(f.row)
  }
  await insertRowsAtTop(sheets, tabName, rows)
  return rows.length
}

async function stampCoverage(accountName) {
  try {
    const params = new URLSearchParams()
    params.append('filterByFormula', `{Account Name} = '${String(accountName).replace(/'/g, "\\'")}'`)
    params.append('pageSize', '1')
    const res = await fetch(`https://api.airtable.com/v0/${HQ_BASE}/${RA_TABLE}?${params}`, {
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` },
    })
    if (!res.ok) return
    const record = (await res.json()).records?.[0]
    if (!record) return
    const nowIso = new Date().toISOString()
    const today = nowIso.split('T')[0]
    await fetch(`https://api.airtable.com/v0/${HQ_BASE}/${RA_TABLE}/${record.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: {
        [RA.earningsEnd]: today, [RA.earningsLastUpload]: nowIso,
        [RA.chargebackEnd]: today, [RA.chargebacksLastUpload]: nowIso,
      } }),
    })
  } catch (e) { console.warn('[trueup] coverage stamp failed:', e.message) }
}
