import { auth } from '@clerk/nextjs/server'
import { google } from 'googleapis'

export const maxDuration = 30

// Reads the `Agency Revenue` tab from the OF Transactions spreadsheet — a
// purely-formula-driven daily ledger where each row = one day, columns =
// per-account net revenue (Sales + Chargebacks), gated by each account's
// "Managed From" date in the `Accounts` config tab. See spreadsheet for math.
//
// Returns the chart's existing earningsData shape so the dashboard chart
// doesn't need to change: { [creatorName]: { dailyData: [{date, net}], ... } }
// where multi-account creators (e.g. Sunny Free + VIP) are pre-summed.

function getAuth() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  )
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })
  return oauth2
}

const SPREADSHEET_ID = process.env.OF_TRANSACTIONS_SPREADSHEET_ID

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
    const sheets = google.sheets({ version: 'v4', auth: getAuth() })

    // Pull whole Agency Revenue tab as unformatted (we want raw numbers + date serials)
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'Agency Revenue'!A1:Z2000`,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING', // dates come back as 'yyyy-mm-dd'
    })
    const rows = res.data.values || []
    if (rows.length < 2) {
      return Response.json({ error: 'no_data', message: 'Agency Revenue tab is empty' })
    }

    const header = rows[0]
    // header: ['Date', 'Total Net', accountName, accountName, ...]
    const accountNames = header.slice(2)

    // Build per-creator daily map (sum multi-account creators)
    // creatorMap: { [creator]: { [date]: net } }
    const creatorMap = {}
    for (const r of rows.slice(1)) {
      const date = r[0]
      if (!date) continue
      for (let i = 0; i < accountNames.length; i++) {
        const acctName = accountNames[i]
        const creator = creatorFromAccount(acctName)
        const net = Number(r[2 + i]) || 0
        if (!creatorMap[creator]) creatorMap[creator] = {}
        creatorMap[creator][date] = (creatorMap[creator][date] || 0) + net
      }
    }

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
