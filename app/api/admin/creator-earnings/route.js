import { auth } from '@clerk/nextjs/server'
import { google } from 'googleapis'

// ── Auth ────────────────────────────────────────────────────────────────────

function getAuth() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  )
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })
  return oauth2
}

const SPREADSHEET_ID = process.env.OF_TRANSACTIONS_SPREADSHEET_ID

// ── Cache ───────────────────────────────────────────────────────────────────

const earningsCache = new Map()
const CACHE_TTL = 5 * 60 * 1000

function getCached(creator) {
  const entry = earningsCache.get(creator)
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) return entry.data
  return null
}

function setCache(creator, data) {
  earningsCache.set(creator, { data, timestamp: Date.now() })
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseMoney(s) {
  if (!s) return 0
  return parseFloat(String(s).replace(/[$,]/g, '')) || 0
}

const MONTHS = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 }

function parseSheetDate(dateStr) {
  if (!dateStr) return null
  try {
    // Handle YYYY-MM-DD format (new UTC dates)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [y, m, d] = dateStr.split('-').map(Number)
      return new Date(y, m - 1, d)
    }
    // Handle "Apr 6, 2026" format (legacy)
    const parts = dateStr.replace(',', '').split(/\s+/)
    const mon = MONTHS[parts[0]]
    if (mon === undefined) return new Date(dateStr)
    return new Date(parseInt(parts[2]), mon, parseInt(parts[1]))
  } catch { return null }
}

// ── Whale detection ─────────────────────────────────────────────────────────

function detectWhales(transactions, now) {
  const sixMonthsAgo = new Date(now)
  sixMonthsAgo.setDate(sixMonthsAgo.getDate() - 180)

  // Group by fan
  const fanTxns = {}
  for (const t of transactions) {
    const key = t.displayName || 'Unknown'
    if (!fanTxns[key]) fanTxns[key] = []
    fanTxns[key].push(t)
  }

  // Top 10 threshold (6mo total)
  const fan6mo = {}
  for (const [fan, ts] of Object.entries(fanTxns)) {
    const total = ts.filter(t => t.dt && t.dt >= sixMonthsAgo).reduce((s, t) => s + t.net, 0)
    if (total > 0) fan6mo[fan] = total
  }
  const sorted6mo = Object.values(fan6mo).sort((a, b) => b - a)
  const top10Threshold = sorted6mo[9] || 0
  const monthlyThreshold = top10Threshold / 6

  const thirtyDaysAgo = new Date(now)
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const alerts = []
  for (const [fan, ts] of Object.entries(fanTxns)) {
    const recent = ts.filter(t => t.dt && t.dt >= sixMonthsAgo)
    if (recent.length === 0) continue

    // Peak 30-day window (slide by week)
    let peak30 = 0, peakStart = null
    let cursor = new Date(sixMonthsAgo)
    const windowEnd30 = new Date(now)
    windowEnd30.setDate(windowEnd30.getDate() - 30)
    while (cursor <= windowEnd30) {
      const wEnd = new Date(cursor)
      wEnd.setDate(wEnd.getDate() + 30)
      const spend = recent.filter(t => t.dt >= cursor && t.dt < wEnd).reduce((s, t) => s + t.net, 0)
      if (spend > peak30) { peak30 = spend; peakStart = new Date(cursor) }
      cursor.setDate(cursor.getDate() + 7)
    }

    if (peak30 < monthlyThreshold) continue

    const last30 = recent.filter(t => t.dt >= thirtyDaysAgo).reduce((s, t) => s + t.net, 0)
    const lastTxn = ts.reduce((max, t) => (!max || (t.dt && t.dt > max) ? t.dt : max), null)
    const daysSince = lastTxn ? Math.floor((now - lastTxn) / 86400000) : 999
    const ratio = peak30 > 0 ? last30 / peak30 : 0

    if (ratio <= 0.25) {
      alerts.push({
        fan,
        username: ts[0]?.ofUsername || '',
        peak30,
        peakStart: peakStart?.toISOString() || '',
        last30,
        ratio,
        lastTxnDate: lastTxn?.toISOString()?.split('T')[0] || '',
        daysSince,
        lifetime: ts.reduce((s, t) => s + t.net, 0),
        status: last30 === 0 ? 'gone' : 'dropping',
      })
    }
  }

  alerts.sort((a, b) => b.peak30 - a.peak30)
  return alerts
}

// ── GET ─────────────────────────────────────────────────────────────────────

export async function GET(request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const creator = searchParams.get('creator')
  const refresh = searchParams.get('refresh') === 'true'

  if (!creator) return Response.json({ error: 'Missing creator param' }, { status: 400 })

  if (!refresh) {
    const cached = getCached(creator)
    if (cached) return Response.json(cached)
  }

  const tabName = `${creator} - Sales`

  try {
    const authClient = getAuth()
    const sheets = google.sheets({ version: 'v4', auth: authClient })

    let rows
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${tabName}'!A4:J`,
      })
      rows = res.data.values || []
    } catch (err) {
      if (err.message?.includes('Unable to parse range') || err.code === 400) {
        return Response.json({ error: 'no_sheet', message: `No sales data found for ${creator}` })
      }
      throw err
    }

    if (rows.length === 0) {
      return Response.json({ error: 'no_sheet', message: `No sales data found for ${creator}` })
    }

    // Parse rows
    const transactions = []
    for (const row of rows) {
      const [date, time, gross, ofFee, net, type, displayName, ofUsername, originalDate, description] = row
      if (!date) continue
      const dt = parseSheetDate(date)
      transactions.push({
        date: date || '', time: time || '',
        gross: parseMoney(gross), ofFee: parseMoney(ofFee), net: parseMoney(net),
        type: type || '', displayName: displayName || '', ofUsername: ofUsername || '',
        originalDate: originalDate || '', description: description || '', dt,
      })
    }

    transactions.sort((a, b) => (b.dt || 0) - (a.dt || 0))

    const now = new Date()

    // Separate sales and chargebacks
    const salesTxns = transactions.filter(t => t.type !== 'Chargeback')
    const chargebackTxns = transactions.filter(t => t.type === 'Chargeback')

    // ── Daily aggregation for chart ───────────────────────────────────────
    const dailyMap = {}
    const dailyByType = {}
    for (const t of transactions) {
      if (!t.date) continue
      if (!dailyMap[t.date]) dailyMap[t.date] = 0
      // Chargebacks are negative
      const netVal = t.type === 'Chargeback' ? -t.net : t.net
      dailyMap[t.date] += netVal

      const tp = t.type || 'Unknown'
      if (!dailyByType[t.date]) dailyByType[t.date] = {}
      if (!dailyByType[t.date][tp]) dailyByType[t.date][tp] = 0
      dailyByType[t.date][tp] += t.net // keep positive for type breakdown
    }

    // Build daily array sorted chronologically
    const dailyData = Object.entries(dailyMap)
      .map(([date, net]) => ({
        date,
        net,
        byType: dailyByType[date] || {},
        dt: parseSheetDate(date),
      }))
      .sort((a, b) => (a.dt || 0) - (b.dt || 0))
      .map(({ dt, ...rest }) => rest)

    // ── Summary (all time) ────────────────────────────────────────────────
    let totalGross = 0, totalNet = 0, chargebackTotal = 0
    const byType = {}
    for (const t of salesTxns) {
      totalGross += t.gross
      totalNet += t.net
      const tp = t.type || 'Unknown'
      byType[tp] = (byType[tp] || 0) + t.net
    }
    for (const t of chargebackTxns) {
      chargebackTotal += t.net
    }
    // Net after chargebacks
    totalNet -= chargebackTotal

    // ── Top fans (all time) ───────────────────────────────────────────────
    const fanMap = {}
    for (const t of transactions) {
      const key = t.displayName || 'Unknown'
      if (!fanMap[key]) fanMap[key] = { displayName: key, ofUsername: t.ofUsername, totalNet: 0, transactionCount: 0, lastDate: '' }
      fanMap[key].totalNet += t.net
      fanMap[key].transactionCount += 1
      if (!fanMap[key].lastDate) fanMap[key].lastDate = t.date
    }
    const topFans = Object.values(fanMap)
      .sort((a, b) => b.totalNet - a.totalNet)
      .slice(0, 25)
      .map((f, i) => ({ rank: i + 1, ...f }))

    // ── Whale alerts ──────────────────────────────────────────────────────
    const whaleAlerts = detectWhales(transactions, now)

    // ── Period summaries ──────────────────────────────────────────────────
    const periods = {}
    const periodDefs = [
      { key: 'last30', days: 30 },
      { key: 'last90', days: 90 },
    ]
    for (const { key, days } of periodDefs) {
      const cutoff = new Date(now)
      cutoff.setDate(cutoff.getDate() - days)
      let pNet = 0, pGross = 0, pCount = 0
      const pByType = {}
      for (const t of transactions) {
        if (t.dt && t.dt >= cutoff) {
          pNet += t.net; pGross += t.gross; pCount++
          const tp = t.type || 'Unknown'
          pByType[tp] = (pByType[tp] || 0) + t.net
        }
      }
      periods[key] = { net: pNet, gross: pGross, count: pCount, byType: pByType }
    }

    // Strip dt from transactions for response
    const cleanTxns = transactions.map(({ dt, ...rest }) => rest)

    const result = {
      summary: {
        totalNet, totalGross, chargebackTotal,
        transactionCount: salesTxns.length,
        chargebackCount: chargebackTxns.length,
        avgTransaction: salesTxns.length > 0 ? (totalNet + chargebackTotal) / salesTxns.length : 0,
      },
      periods,
      byType,
      topFans,
      whaleAlerts: whaleAlerts.slice(0, 20),
      whaleCount: whaleAlerts.length,
      dailyData,
      cachedAt: new Date().toISOString(),
      totalRows: transactions.length,
    }

    setCache(creator, result)
    return Response.json(result)
  } catch (err) {
    console.error('Creator earnings error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
