import { auth } from '@clerk/nextjs/server'
import { sheetsClient, SPREADSHEET_ID, etWallToUtcDate } from '@/lib/transactionsSheet'

export const maxDuration = 60

// Daily agency revenue for the dashboard chart, bucketed by the UTC (OnlyFans)
// day so it MATCHES OF's per-account statistics graph + our invoices (midnight
// UTC = 8 PM ET → evening-ET sales roll into the next day). Reads the raw
// "<account> - Sales"/"- Chargebacks" tabs (ET timestamps) and re-buckets each
// row by its UTC date — the same net (col D) + chargeback-by-payment-date (col
// H) logic invoicing's refresh-period uses, so the numbers stay consistent.
// (Superseded the ET-dated formula-driven "Agency Revenue" tab, which is what
// made the dashboard disagree with OF. Management-start gating happens
// client-side, so we return every creator's full daily series here.)
//
// Shape unchanged: { [creatorName]: { dailyData: [{date, net}] } } (multi-
// account creators e.g. Sunny Free + VIP are summed).

// 5-min in-memory cache
let cache = null
function getCached() {
  if (!cache) return null
  if (Date.now() - cache.t > 5 * 60 * 1000) return null
  return cache.data
}
function setCached(data) { cache = { t: Date.now(), data } }

// Map an account name (e.g. "Sunny - VIP OF") → creator (e.g. "Sunny")
function creatorFromAccount(accountName) {
  const m = accountName.match(/^(.+?)\s+-\s+/)
  return m ? m[1] : accountName
}
const money = (v) => { const n = parseFloat(String(v ?? '').replace(/[$,]/g, '')); return isNaN(n) ? 0 : n }

export async function GET(request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const refresh = searchParams.get('refresh') === 'true'
  if (!refresh) {
    const cached = getCached()
    if (cached) return Response.json(cached)
  }

  try {
    const sheets = sheetsClient()

    // Every managed account = a "<account> - Sales" tab.
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets(properties(title))' })
    const titles = (meta.data.sheets || []).map((s) => s.properties.title)
    const accounts = titles.filter((t) => / - Sales$/.test(t)).map((t) => t.replace(/ - Sales$/, ''))
    if (!accounts.length) return Response.json({ error: 'no_data', message: 'No Sales tabs found' })

    // Batch-read Sales + Chargebacks (A4:I) in one request. Only include tabs
    // that EXIST — a range pointing at a missing tab 400s the whole batch, and
    // most accounts have no Chargebacks tab. Track the creator per range so we
    // can map results back after conditional inclusion.
    const ranges = []
    const rangeCreator = []
    for (const a of accounts) {
      const creator = creatorFromAccount(a)
      if (titles.includes(`${a} - Sales`)) { ranges.push(`'${a} - Sales'!A4:I`); rangeCreator.push(creator) }
      if (titles.includes(`${a} - Chargebacks`)) { ranges.push(`'${a} - Chargebacks'!A4:I`); rangeCreator.push(creator) }
    }
    const batch = await sheets.spreadsheets.values.batchGet({ spreadsheetId: SPREADSHEET_ID, ranges })
    const valueRanges = batch.data.valueRanges || []

    // creatorMap: { [creator]: { [utcDate]: net } }
    const creatorMap = {}
    valueRanges.forEach((vr, idx) => {
      const creator = rangeCreator[idx]
      for (const row of (vr.values || [])) {
        const dateTime = row[0]
        if (!dateTime) continue
        const net = money(row[3]) // col D
        const type = row[4]       // col E
        const originalDate = row[7] // col H — chargeback payment date
        // Chargebacks bucket by their ORIGINAL PAYMENT date (col H), not the
        // dispute date; net is already negative. Same as invoicing.
        const isChargeback = typeof type === 'string' && type.startsWith('Chargeback')
        const utcDate = etWallToUtcDate(isChargeback ? (originalDate || dateTime) : dateTime)
        if (!utcDate) continue
        if (!creatorMap[creator]) creatorMap[creator] = {}
        creatorMap[creator][utcDate] = (creatorMap[creator][utcDate] || 0) + net
      }
    })

    // Reshape to the chart's expected earningsData shape
    const earningsData = {}
    for (const [creator, dateMap] of Object.entries(creatorMap)) {
      // No negative days — a chargeback claws back PAST earnings, so a batch
      // processed on one date must not sink that day below zero (mid-June
      // showed -$3k on the month's best sales day). Carry negative remainders
      // backward into prior days; totals unchanged. Same rule as
      // /api/admin/creator-earnings.
      const datesAsc = Object.keys(dateMap).sort()
      for (let i = datesAsc.length - 1; i >= 0; i--) {
        if (dateMap[datesAsc[i]] < 0) {
          if (i > 0) dateMap[datesAsc[i - 1]] += dateMap[datesAsc[i]]
          dateMap[datesAsc[i]] = 0
        }
      }
      const dailyData = Object.entries(dateMap)
        .filter(([, net]) => net !== 0) // drop zero-net days (pre-management gate or no activity)
        .map(([date, net]) => ({ date, net }))
        .sort((a, b) => a.date.localeCompare(b.date))
      if (dailyData.length === 0) continue
      earningsData[creator] = { dailyData }
    }

    const payload = { earningsData, cachedAt: new Date().toISOString() }
    setCached(payload)
    return Response.json(payload)
  } catch (err) {
    console.error('[agency-revenue]', err?.message || err)
    return Response.json({ error: 'fetch_failed', message: String(err?.message || err) }, { status: 500 })
  }
}
