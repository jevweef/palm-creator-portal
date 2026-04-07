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
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

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

function parseSheetDate(dateStr, timeStr) {
  if (!dateStr) return null
  try {
    return new Date(`${dateStr} ${timeStr || '12:00 AM'}`)
  } catch { return null }
}

// ── GET ─────────────────────────────────────────────────────────────────────

export async function GET(request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const creator = searchParams.get('creator')
  const refresh = searchParams.get('refresh') === 'true'

  if (!creator) {
    return Response.json({ error: 'Missing creator param' }, { status: 400 })
  }

  // Check cache
  if (!refresh) {
    const cached = getCached(creator)
    if (cached) return Response.json(cached)
  }

  const tabName = `${creator} - Sales`

  try {
    const authClient = getAuth()
    const sheets = google.sheets({ version: 'v4', auth: authClient })

    // Read all rows from the creator's tab
    let rows
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${tabName}'!A4:J`,
      })
      rows = res.data.values || []
    } catch (err) {
      // Tab doesn't exist
      if (err.message?.includes('Unable to parse range') || err.code === 400) {
        return Response.json({ error: 'no_sheet', message: `No sales data found for ${creator}` })
      }
      throw err
    }

    if (rows.length === 0) {
      return Response.json({ error: 'no_sheet', message: `No sales data found for ${creator}` })
    }

    // Parse rows into objects
    // Columns: Date, Time, Gross, OF Fee, Net, Type, Display Name, OF Username, Original Date, Description
    const transactions = []
    for (const row of rows) {
      const [date, time, gross, ofFee, net, type, displayName, ofUsername, originalDate, description] = row
      if (!date) continue
      transactions.push({
        date: date || '',
        time: time || '',
        gross: parseMoney(gross),
        ofFee: parseMoney(ofFee),
        net: parseMoney(net),
        type: type || '',
        displayName: displayName || '',
        ofUsername: ofUsername || '',
        originalDate: originalDate || '',
        description: description || '',
        dt: parseSheetDate(date, time),
      })
    }

    // Sort newest first
    transactions.sort((a, b) => (b.dt || 0) - (a.dt || 0))

    // ── Compute summaries ─────────────────────────────────────────────────

    let totalGross = 0, totalNet = 0
    const byType = {}
    const fanMap = {} // keyed by displayName

    for (const t of transactions) {
      totalGross += t.gross
      totalNet += t.net

      const tp = t.type || 'Unknown'
      byType[tp] = (byType[tp] || 0) + t.net

      const fanKey = t.displayName || 'Unknown'
      if (!fanMap[fanKey]) {
        fanMap[fanKey] = { displayName: fanKey, ofUsername: t.ofUsername, totalNet: 0, transactionCount: 0, lastDate: t.date }
      }
      fanMap[fanKey].totalNet += t.net
      fanMap[fanKey].transactionCount += 1
      // Keep earliest-appearing date as lastDate (transactions are newest-first)
      fanMap[fanKey].lastDate = t.date
    }

    // Fix lastDate — we want the most recent, which is the first occurrence in our sorted list
    // Re-iterate to get first (most recent) date per fan
    const fanLastDate = {}
    for (const t of transactions) {
      const fanKey = t.displayName || 'Unknown'
      if (!fanLastDate[fanKey]) fanLastDate[fanKey] = t.date
    }
    for (const fan of Object.values(fanMap)) {
      fan.lastDate = fanLastDate[fan.displayName] || fan.lastDate
    }

    const topFans = Object.values(fanMap)
      .sort((a, b) => b.totalNet - a.totalNet)
      .slice(0, 25)
      .map((f, i) => ({ rank: i + 1, ...f }))

    // ── Last 30 days ──────────────────────────────────────────────────────

    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    let last30Net = 0, last30Gross = 0, last30Count = 0
    const last30ByType = {}
    for (const t of transactions) {
      if (t.dt && t.dt >= thirtyDaysAgo) {
        last30Net += t.net
        last30Gross += t.gross
        last30Count += 1
        const tp = t.type || 'Unknown'
        last30ByType[tp] = (last30ByType[tp] || 0) + t.net
      }
    }

    // ── Strip dt from response (not serializable cleanly) ─────────────

    const cleanTransactions = transactions.map(({ dt, ...rest }) => rest)

    const result = {
      summary: {
        totalNet,
        totalGross,
        transactionCount: transactions.length,
        avgTransaction: transactions.length > 0 ? totalNet / transactions.length : 0,
      },
      last30Days: {
        net: last30Net,
        gross: last30Gross,
        count: last30Count,
        byType: last30ByType,
      },
      byType,
      topFans,
      transactions: cleanTransactions,
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
