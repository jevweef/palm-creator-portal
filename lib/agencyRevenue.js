import { sheetsClient, SPREADSHEET_ID, etWallToUtcDate } from '@/lib/transactionsSheet'

// Heavy compute for the dashboard's Agency Revenue chart: read every account's
// raw Sales/Chargebacks tabs and bucket net by the UTC (OnlyFans) day so the
// chart matches OF's per-account stats graph + our invoices. This reads ~75k
// rows, which is fine in a cron (maxDuration 300) but 504s a live request on
// Vercel — so the cron caches the (small) result and the dashboard route reads
// that. See /api/cron/cache-agency-revenue + /api/admin/agency-revenue.

const creatorFromAccount = (n) => { const m = String(n).match(/^(.+?)\s+-\s+/); return m ? m[1] : n }
const money = (v) => { const n = parseFloat(String(v ?? '').replace(/[$,]/g, '')); return isNaN(n) ? 0 : n }

// Returns { [creatorName]: { dailyData: [{date, net}] } } — UTC-bucketed, multi-
// account creators summed. Management-start gating happens client-side.
export async function computeAgencyRevenueUTC() {
  const sheets = sheetsClient()

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets(properties(title))' })
  const titles = (meta.data.sheets || []).map((s) => s.properties.title)
  const accounts = titles.filter((t) => / - Sales$/.test(t)).map((t) => t.replace(/ - Sales$/, ''))

  // Only request tabs that exist (a missing-tab range 400s the request).
  // Read A4:H (skip col I "Description" — big text we don't need).
  const ranges = []
  const rangeCreator = []
  for (const a of accounts) {
    const creator = creatorFromAccount(a)
    if (titles.includes(`${a} - Sales`)) { ranges.push(`'${a} - Sales'!A4:H`); rangeCreator.push(creator) }
    if (titles.includes(`${a} - Chargebacks`)) { ranges.push(`'${a} - Chargebacks'!A4:H`); rangeCreator.push(creator) }
  }
  if (!ranges.length) return {}

  // Fetch ONE tab at a time and fold it straight into the tiny date→net map.
  // A single batchGet of every tab (~75k rows across ~2yr × all accounts) held
  // the whole raw payload in memory at once and OOM-killed the cron (2026-07-15).
  // Per-tab lets each raw response be GC'd before the next, so peak memory stays
  // flat as history grows; the aggregate we keep is small.
  const creatorMap = {} // { creator: { utcDate: net } }
  for (let idx = 0; idx < ranges.length; idx++) {
    const creator = rangeCreator[idx]
    let values
    try {
      const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: ranges[idx] })
      values = res.data.values || []
    } catch (err) {
      // A single bad tab shouldn't sink the whole refresh — skip it.
      console.error('[agencyRevenue] range failed:', ranges[idx], err?.message || err)
      continue
    }
    for (const row of values) {
      const dateTime = row[0]
      if (!dateTime) continue
      const net = money(row[3])       // col D
      const type = row[4]             // col E
      const originalDate = row[7]     // col H — chargeback payment date
      const isChargeback = typeof type === 'string' && type.startsWith('Chargeback')
      const utcDate = etWallToUtcDate(isChargeback ? (originalDate || dateTime) : dateTime)
      if (!utcDate) continue
      if (!creatorMap[creator]) creatorMap[creator] = {}
      creatorMap[creator][utcDate] = (creatorMap[creator][utcDate] || 0) + net
    }
    values = null // release before the next tab
  }

  const earningsData = {}
  for (const [creator, dateMap] of Object.entries(creatorMap)) {
    // No negative days — a chargeback claws back PAST earnings; carry negative
    // remainders backward so a dispute batch never sinks its day below zero.
    const datesAsc = Object.keys(dateMap).sort()
    for (let i = datesAsc.length - 1; i >= 0; i--) {
      if (dateMap[datesAsc[i]] < 0) {
        if (i > 0) dateMap[datesAsc[i - 1]] += dateMap[datesAsc[i]]
        dateMap[datesAsc[i]] = 0
      }
    }
    const dailyData = Object.entries(dateMap)
      .filter(([, net]) => net !== 0)
      .map(([date, net]) => ({ date, net }))
      .sort((a, b) => a.date.localeCompare(b.date))
    if (dailyData.length) earningsData[creator] = { dailyData }
  }
  return earningsData
}
