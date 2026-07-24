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

  // Fetch tabs in CHUNKS via batchGet, folding each chunk into the tiny
  // date→net map before the next. This balances two prior failures:
  //   - A single batchGet of ALL tabs held the whole ~75k-row payload at once
  //     and OOM-killed the cron (2026-07-15).
  //   - Reading ONE tab at a time (34 sequential round-trips) exceeded the
  //     300s maxDuration on production and silently stopped refreshing the
  //     cache — the dashboard froze at a stale snapshot (2026-07-24).
  // A chunk of 8 keeps peak memory flat (only 8 raw responses live at once,
  // released each iteration) while cutting 34 round-trips to ~5 — the read
  // completes in seconds. Only existing tabs are requested (built above), so
  // no missing-tab 400 sinks the batch.
  const CHUNK = 8
  const creatorMap = {} // { creator: { utcDate: net } }
  for (let start = 0; start < ranges.length; start += CHUNK) {
    const slice = ranges.slice(start, start + CHUNK)
    let valueRanges
    try {
      const res = await sheets.spreadsheets.values.batchGet({ spreadsheetId: SPREADSHEET_ID, ranges: slice })
      valueRanges = res.data.valueRanges || []
    } catch (err) {
      // Fall back to per-tab for this chunk so one bad range can't sink it.
      console.error('[agencyRevenue] chunk batchGet failed, falling back per-tab:', err?.message || err)
      valueRanges = []
      for (let j = 0; j < slice.length; j++) {
        try {
          const r = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: slice[j] })
          valueRanges.push({ values: r.data.values || [] })
        } catch (e) { console.error('[agencyRevenue] range failed:', slice[j], e?.message || e); valueRanges.push({ values: [] }) }
      }
    }
    for (let k = 0; k < valueRanges.length; k++) {
      const creator = rangeCreator[start + k]
      for (const row of (valueRanges[k].values || [])) {
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
    }
    valueRanges = null // release the chunk before the next
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
