import { auth } from '@clerk/nextjs/server'
import { google } from 'googleapis'

export const maxDuration = 30

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

// ── Airtable (Revenue Accounts) ────────────────────────────────────────────

const HQ_BASE = 'appL7c4Wtotpz07KS'
const REVENUE_ACCOUNTS_TABLE = 'tblQqPWlsjiyJA0ba'
const HQ_CREATORS_TABLE = 'tblYhkNvrNuOAHfgw'
const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const AIRTABLE_HEADERS = { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' }

// Fetch Revenue Accounts for a creator (by AKA name matching Account Name prefix)
async function fetchCreatorAccounts(creatorAka) {
  try {
    // Search Revenue Accounts where Account Name starts with the creator's AKA
    // e.g. "Taby" matches "Taby - Free OF" and "Taby - VIP OF"
    const acctParams = new URLSearchParams()
    acctParams.set('filterByFormula', `AND(FIND("${creatorAka.replace(/"/g, '\\"')} - ", {Account Name}) = 1, {Platform}="OnlyFans", {Status}="Active")`)
    acctParams.append('fields[]', 'fldkEi3jW9tUXSTc5') // Account Name
    acctParams.append('fields[]', 'fldxQMmYU6Ep6AkKR') // Account Type
    acctParams.set('returnFieldsByFieldId', 'true')
    acctParams.set('pageSize', '20')

    const acctRes = await fetch(`https://api.airtable.com/v0/${HQ_BASE}/${REVENUE_ACCOUNTS_TABLE}?${acctParams}`, {
      headers: AIRTABLE_HEADERS, cache: 'no-store',
    })
    const acctData = await acctRes.json()
    if (acctData.error) {
      console.error('[Earnings] Revenue Accounts lookup error:', acctData.error)
      return []
    }

    const accounts = (acctData.records || []).map(r => ({
      id: r.id,
      accountName: r.fields['fldkEi3jW9tUXSTc5'] || '',
      accountType: r.fields['fldxQMmYU6Ep6AkKR']?.name || '',
    }))

    console.log(`[Earnings] Found ${accounts.length} accounts for ${creatorAka}:`, accounts.map(a => a.accountName))
    return accounts
  } catch (err) {
    console.error('Failed to fetch creator accounts:', err)
    return []
  }
}

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

  // Group by fan (prefer ofUsername — display names change)
  const fanTxns = {}
  for (const t of transactions) {
    const key = t.ofUsername || t.displayName || 'Unknown'
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
    // Skip fans with no username (deleted/deactivated accounts)
    if (!ts.some(t => t.ofUsername)) continue

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
      // Build daily spending timeline for this fan
      const dailySpend = {}
      for (const t of ts) {
        if (!t.date) continue
        dailySpend[t.date] = (dailySpend[t.date] || 0) + t.net
      }
      const timeline = Object.entries(dailySpend)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, spend]) => ({ week: day, spend }))

      // Peak period end
      const peakEnd = peakStart ? new Date(peakStart) : null
      if (peakEnd) peakEnd.setDate(peakEnd.getDate() + 30)

      // Investigation zone: one month after the peak period ends
      const peakEndStr = peakEnd?.toISOString()?.split('T')[0] || ''
      const dropOffStart = peakEndStr
      const inspectEnd = peakEnd ? new Date(peakEnd) : null
      if (inspectEnd) inspectEnd.setDate(inspectEnd.getDate() + 30)
      const dropOffEnd = inspectEnd?.toISOString()?.split('T')[0] || ''

      alerts.push({
        fan,
        username: ts[0]?.ofUsername || '',
        peak30,
        peakStart: peakStart?.toISOString()?.split('T')[0] || '',
        peakEnd: peakEnd?.toISOString()?.split('T')[0] || '',
        last30,
        ratio,
        lastTxnDate: lastTxn?.toISOString()?.split('T')[0] || '',
        daysSince,
        lifetime: ts.reduce((s, t) => s + t.net, 0),
        status: last30 === 0 ? 'gone' : 'dropping',
        timeline,
        inspectFrom: dropOffStart,
        inspectTo: dropOffEnd,
      })
    }
  }

  alerts.sort((a, b) => b.peak30 - a.peak30)
  return alerts
}

// ── Going Cold detection ───────────────────────────────────────────────────

function detectGoingCold(transactions, now) {
  const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const sixtyDaysAgo = new Date(now);  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60)
  const ninetyDaysAgo = new Date(now); ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

  // Group by fan (prefer ofUsername — display names change)
  // Exclude chargebacks and subscription renewals — subs auto-charge and don't
  // reflect active spending intent.
  const fanTxns = {}
  for (const t of transactions) {
    if (t.type === 'Chargeback') continue
    if (t.type === 'Subscription' || t.type === 'Recurring subscription') continue
    const key = t.ofUsername || t.displayName || 'Unknown'
    if (!fanTxns[key]) fanTxns[key] = []
    fanTxns[key].push(t)
  }

  const alerts = []
  for (const [fan, txns] of Object.entries(fanTxns)) {
    const hasUsername = txns.some(t => t.ofUsername)
    if (!hasUsername) continue // skip deleted/deactivated OF accounts

    const sorted = txns.filter(t => t.dt).sort((a, b) => a.dt - b.dt)
    if (sorted.length < 3) continue

    const lifetime = sorted.reduce((s, t) => s + t.net, 0)
    const trailing90 = sorted.filter(t => t.dt >= ninetyDaysAgo).reduce((s, t) => s + t.net, 0)
    // Lower minimum — catches light-budget loyalists that the old $500/$1000
    // threshold was missing. Still enough to filter out casual one-offs.
    if (trailing90 < 200 && lifetime < 500) continue

    // Unique purchase dates → gaps
    const purchaseDates = []
    let lastDate = null
    for (const t of sorted) {
      if (t.date !== lastDate) { purchaseDates.push(t.dt); lastDate = t.date }
    }
    if (purchaseDates.length < 3) continue

    const gaps = []
    for (let i = 1; i < purchaseDates.length; i++) {
      gaps.push(Math.round((purchaseDates[i] - purchaseDates[i - 1]) / 86400000))
    }

    // Burst-spender detection — all purchases within 10 days = binge behavior,
    // not a regular cadence. Using raw median gap would flag them too easily.
    const totalSpanDays = Math.round((purchaseDates[purchaseDates.length - 1] - purchaseDates[0]) / 86400000)
    const isBurstSpender = totalSpanDays <= 10 && purchaseDates.length >= 3

    const recentGapsSorted = gaps.slice(-15).sort((a, b) => a - b)
    const rawMedianGap = recentGapsSorted[Math.floor(recentGapsSorted.length / 2)] || 0
    // For burst spenders, treat "normal" as 21 days (typical re-engagement window
    // for someone who binged — they're not going to come back in 2 days).
    const medianGap = isBurstSpender ? 21 : rawMedianGap
    const p90Gap = recentGapsSorted[Math.floor(recentGapsSorted.length * 0.9)] || medianGap

    const lastPurchase = purchaseDates[purchaseDates.length - 1]
    const currentGap = Math.floor((now - lastPurchase) / 86400000)

    // Absolute bounds — don't alert if they bought recently or if they're so far
    // gone that they're effectively lost, not "going cold."
    const MIN_GAP_DAYS = 14
    const MAX_GAP_DAYS = 120
    if (currentGap < MIN_GAP_DAYS || currentGap > MAX_GAP_DAYS) continue

    // ─── SPEND WINDOWS ─────────────────────────────────────────────
    const r30 = sorted.filter(t => t.dt >= thirtyDaysAgo).reduce((s, t) => s + t.net, 0)
    const r60 = sorted.filter(t => t.dt >= sixtyDaysAgo).reduce((s, t) => s + t.net, 0)
    const monthlyAvg90 = trailing90 / 3
    const r30to60 = Math.max(0, r60 - r30) // spend in 30-60 day window

    // ─── SCORE ─────────────────────────────────────────────────────
    // Weighted signals. Each signal adds points based on severity.
    // Total score → urgency. This catches slow decays + budget drops + whale
    // risk earlier than the old binary triggers.
    let score = 0
    const reasons = []

    // Signal 1: Gap ratio (0-30 pts)
    const gapRatio = medianGap > 0 ? currentGap / medianGap : 0
    if (gapRatio > 4) { score += 30; reasons.push(`${gapRatio.toFixed(1)}x normal gap`) }
    else if (gapRatio > 3) { score += 22; reasons.push(`${gapRatio.toFixed(1)}x normal gap`) }
    else if (gapRatio > 2) { score += 14; reasons.push(`${gapRatio.toFixed(1)}x normal gap`) }
    else if (gapRatio > 1.5) { score += 6 }

    // Signal 2: Gap trend — are recent gaps lengthening? (0-15 pts)
    // Catches slow decays that single-snapshot ratios miss.
    if (gaps.length >= 4 && !isBurstSpender) {
      const recent3 = gaps.slice(-3)
      const earlier = gaps.slice(-10, -3)
      if (earlier.length >= 2) {
        const avgRecent = recent3.reduce((s, g) => s + g, 0) / recent3.length
        const avgEarly = earlier.reduce((s, g) => s + g, 0) / earlier.length
        if (avgEarly > 0) {
          const trendRatio = avgRecent / avgEarly
          if (trendRatio > 2) { score += 15; reasons.push('gaps lengthening fast') }
          else if (trendRatio > 1.5) { score += 10; reasons.push('gaps lengthening') }
          else if (trendRatio > 1.2) { score += 5 }
        }
      }
    }

    // Signal 3: Spend drop — rolling30 vs 90d avg (0-25 pts)
    const spendDropRatio = monthlyAvg90 > 0 ? r30 / monthlyAvg90 : 1
    if (monthlyAvg90 > 0) {
      if (spendDropRatio < 0.05) { score += 25; reasons.push('spend collapsed') }
      else if (spendDropRatio < 0.15) { score += 18; reasons.push(`spend ~${Math.round(spendDropRatio * 100)}% of avg`) }
      else if (spendDropRatio < 0.35) { score += 10; reasons.push(`spend ~${Math.round(spendDropRatio * 100)}% of avg`) }
      else if (spendDropRatio < 0.6) { score += 4 }
    }

    // Signal 4: Spend trend — last 30d vs 30-60d ago (0-12 pts)
    // Catches fans whose amounts are shrinking even if frequency looks normal.
    if (r30to60 > 0) {
      const monthOverMonth = r30 / r30to60
      if (monthOverMonth < 0.3) { score += 12; reasons.push('spend shrinking MoM') }
      else if (monthOverMonth < 0.6) { score += 6 }
    }

    // Signal 5: Whale/patron bonus (0-15 pts)
    // Higher-value fans get earlier detection — the cost of missing them is greater.
    if (lifetime >= 5000) { score += 15; reasons.push('patron-tier') }
    else if (lifetime >= 2000) { score += 10; reasons.push('whale') }
    else if (lifetime >= 1000) { score += 5 }

    // Signal 6: Absolute silence — $0 in last 30 days after having history (0-15 pts)
    if (r30 === 0 && trailing90 > 0) {
      score += 15
      reasons.push('silent 30d+')
    }

    // Signal 7: Uptrend protection — subtract score if recently re-engaged.
    // Prevents flagging fans who just came back (e.g. Chucky pattern).
    if (gaps.length >= 2 && currentGap < medianGap) {
      score -= 30
    }

    // Thresholds → urgency
    let urgency = null
    if (score >= 70) urgency = 'critical'
    else if (score >= 45) urgency = 'high'
    else if (score >= 25) urgency = 'warning'
    if (!urgency) continue

    let triggerReason = reasons[0] || 'multiple signals'

    // Monthly spending history (last 6 months)
    const sixMonthsAgo = new Date(now)
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
    const monthlySpend = {}
    for (const t of sorted) {
      if (!t.dt || t.dt < sixMonthsAgo) continue
      const mo = t.date.slice(0, 7) // YYYY-MM
      monthlySpend[mo] = (monthlySpend[mo] || 0) + t.net
    }
    // Fill in zero months
    const cursor = new Date(sixMonthsAgo)
    while (cursor <= now) {
      const mo = cursor.toISOString().slice(0, 7)
      if (!monthlySpend[mo]) monthlySpend[mo] = 0
      cursor.setMonth(cursor.getMonth() + 1)
    }
    const monthlyHistory = Object.entries(monthlySpend)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, spend]) => ({ month, spend }))

    // Use most recent display name for the label (display names change, username is the key)
    const latestDisplayName = sorted[sorted.length - 1]?.displayName || fan

    alerts.push({
      fan: latestDisplayName,
      username: fan,
      medianGap,
      p90Gap,
      currentGap,
      gapRatio: Math.round(gapRatio * 10) / 10,
      rolling30: r30,
      monthlyAvg90: Math.round(monthlyAvg90),
      spendDropRatio: Math.round(spendDropRatio * 100) / 100,
      lastPurchaseDate: sorted[sorted.length - 1]?.date || '',
      lifetime,
      triggerReason,
      reasons,              // full list of firing signals
      score,                // composite 0-100+ score that drove urgency
      isBurstSpender,       // flagged separately so UI can note it
      urgency,
      monthlyHistory,
      totalPurchases: purchaseDates.length,
    })
  }

  // Sort: critical first, then by composite score (higher = more urgent)
  const urgencyOrder = { critical: 0, high: 1, warning: 2 }
  alerts.sort((a, b) => (urgencyOrder[a.urgency] - urgencyOrder[b.urgency]) || b.score - a.score)
  return alerts
}

// ── Row parser ─────────────────────────────────────────────────────────────

function parseSheetRow(row, account) {
  const [dateTime, gross, ofFee, net, type, displayName, ofUsername, originalDate, description] = row
  if (!dateTime) return null
  const datePart = dateTime.split(' ')[0] || ''
  let dt = null
  if (dateTime.includes(' ')) {
    dt = new Date(dateTime.replace(' ', 'T') + ':00')
  } else {
    dt = parseSheetDate(dateTime)
  }
  if (dt && isNaN(dt.getTime())) dt = parseSheetDate(datePart)
  return {
    date: datePart, time: dateTime.split(' ').slice(1).join(' ') || '',
    gross: parseMoney(gross), ofFee: parseMoney(ofFee), net: parseMoney(net),
    type: type || '', displayName: displayName || '', ofUsername: ofUsername || '',
    originalDate: originalDate || '', description: description || '', dt,
    account: account || '',
  }
}

// ── GET ─────────────────────────────────────────────────────────────────────

export async function GET(request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const creator = searchParams.get('creator')
  const refresh = searchParams.get('refresh') === 'true'
  const goingColdOnly = searchParams.get('goingColdOnly') === 'true'

  if (!creator) return Response.json({ error: 'Missing creator param' }, { status: 400 })

  if (!refresh) {
    const cached = getCached(creator)
    if (cached) return Response.json(cached)
  }

  try {
    const authClient = getAuth()
    const sheets = google.sheets({ version: 'v4', auth: authClient })

    // ── Fetch Revenue Accounts from Airtable ─────────────────────────────
    const accounts = await fetchCreatorAccounts(creator)
    let tabsToFetch = []

    if (accounts.length > 1) {
      // Multi-account creator — fetch from each account's tab
      tabsToFetch = accounts.map(a => ({
        tabName: `${a.accountName} - Sales`,
        account: a.accountType || a.accountName,
        accountName: a.accountName,
      }))
    } else if (accounts.length === 1) {
      // Single account with explicit Revenue Account
      tabsToFetch = [{
        tabName: `${accounts[0].accountName} - Sales`,
        account: accounts[0].accountType || accounts[0].accountName,
        accountName: accounts[0].accountName,
      }]
    }

    // Always try the legacy tab as fallback
    if (tabsToFetch.length === 0) {
      tabsToFetch = [{ tabName: `${creator} - Sales`, account: '', accountName: '' }]
    }

    console.log(`[Earnings] Fetching tabs for ${creator}:`, tabsToFetch.map(t => t.tabName))

    // Fetch from all tabs in parallel
    const tabResults = await Promise.allSettled(
      tabsToFetch.map(async ({ tabName, account, accountName }) => {
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `'${tabName}'!A4:I`,
        })
        return { rows: res.data.values || [], account, accountName }
      })
    )

    // Parse rows from all tabs
    const transactions = []
    const accountList = [] // accounts that actually had data
    let failedTabs = 0

    for (let i = 0; i < tabResults.length; i++) {
      const result = tabResults[i]
      if (result.status !== 'fulfilled') {
        failedTabs++
        console.log(`[Earnings] Tab "${tabsToFetch[i].tabName}" failed:`, result.reason?.message || result.reason)
        continue
      }

      const { rows, account, accountName } = result.value
      if (rows.length > 0) {
        accountList.push({ account, accountName })
        for (const row of rows) {
          const parsed = parseSheetRow(row, account)
          if (parsed) transactions.push(parsed)
        }
      }
    }

    // Fallback: if account-specific tabs failed/empty, try legacy "{creator} - Sales"
    if (transactions.length === 0 && accounts.length > 0) {
      console.log(`[Earnings] Account tabs yielded no data, trying legacy tab "${creator} - Sales"`)
      try {
        const fallbackRes = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `'${creator} - Sales'!A4:I`,
        })
        const rows = fallbackRes.data.values || []
        for (const row of rows) {
          const parsed = parseSheetRow(row, '')
          if (parsed) transactions.push(parsed)
        }
        if (rows.length > 0) accountList.push({ account: '', accountName: '' })
      } catch (err) {
        console.log(`[Earnings] Legacy fallback also failed:`, err?.message || err)
      }
    }

    if (transactions.length === 0) {
      return Response.json({ error: 'no_sheet', message: `No sales data found for ${creator}` })
    }

    transactions.sort((a, b) => (b.dt || 0) - (a.dt || 0))

    const now = new Date()

    // Separate sales and chargebacks
    const salesTxns = transactions.filter(t => t.type !== 'Chargeback')
    const chargebackTxns = transactions.filter(t => t.type === 'Chargeback')

    // ── Zero out original purchases for chargebacks ──────────────────────
    // Instead of subtracting chargebacks on the chargeback date, find the original
    // purchase and zero it out. This gives accurate per-period revenue.
    const zeroedSaleIndices = new Set()
    for (const cb of chargebackTxns) {
      if (!cb.originalDate && !cb.ofUsername) continue
      // Find matching original sale: same fan + original date + similar amount
      const cbOrigDate = cb.originalDate?.split(' ')[0] || ''
      let bestMatch = -1
      let bestScore = 0
      for (let i = 0; i < salesTxns.length; i++) {
        if (zeroedSaleIndices.has(i)) continue
        const sale = salesTxns[i]
        let score = 0
        // Match by fan username
        if (cb.ofUsername && sale.ofUsername && cb.ofUsername === sale.ofUsername) score += 2
        // Match by original date
        if (cbOrigDate && sale.date === cbOrigDate) score += 3
        // Match by amount (within $0.01)
        if (Math.abs(sale.net - cb.net) < 0.02) score += 2
        if (score > bestScore && score >= 3) { // need at least date OR fan+amount match
          bestScore = score
          bestMatch = i
        }
      }
      if (bestMatch >= 0) {
        // Zero out the original sale
        salesTxns[bestMatch]._zeroedByChargeback = true
        salesTxns[bestMatch]._originalNet = salesTxns[bestMatch].net
        salesTxns[bestMatch]._originalGross = salesTxns[bestMatch].gross
        salesTxns[bestMatch].net = 0
        salesTxns[bestMatch].gross = 0
        zeroedSaleIndices.add(bestMatch)
        cb._matched = true
      }
    }
    // Any unmatched chargebacks will still be subtracted the old way (on chargeback date)

    // ── Daily aggregation for chart (shift ET→UTC to match OF daily rollover at 8 PM ET) ──
    // Sheet stores ET local times but Vercel runs UTC, so parsed Dates are "ET pretending to be UTC".
    // Add the ET→UTC offset so 8 PM ET → midnight UTC → next day, matching OF's daily boundaries.
    function etToUtcDate(dt) {
      // Determine if this date falls in EDT (Mar second Sun – Nov first Sun) or EST
      const year = dt.getUTCFullYear(), month = dt.getUTCMonth(), day = dt.getUTCDate()
      // EDT: second Sunday in March through first Sunday in November
      const marStart = new Date(Date.UTC(year, 2, 8)) // Mar 8 at earliest
      marStart.setUTCDate(8 + (7 - marStart.getUTCDay()) % 7) // second Sunday
      const novEnd = new Date(Date.UTC(year, 10, 1)) // Nov 1 at earliest
      novEnd.setUTCDate(1 + (7 - novEnd.getUTCDay()) % 7) // first Sunday
      const isEDT = dt >= marStart && dt < novEnd
      const offsetHours = isEDT ? 4 : 5
      const shifted = new Date(dt.getTime() + offsetHours * 3600000)
      return shifted.toISOString().split('T')[0]
    }

    const dailyMap = {}
    const dailyByType = {}
    const dailyGross = {}
    const dailyCount = {}
    const dailyByAccount = {} // { date: { account: net } }
    // Aggregate sales (some may be zeroed out by chargeback matching)
    for (const t of salesTxns) {
      if (!t.date) continue
      const utcDate = t.dt ? etToUtcDate(t.dt) : t.date
      if (!dailyMap[utcDate]) dailyMap[utcDate] = 0
      if (!dailyGross[utcDate]) dailyGross[utcDate] = 0
      if (!dailyCount[utcDate]) dailyCount[utcDate] = 0
      dailyMap[utcDate] += t.net
      dailyGross[utcDate] += t.gross
      dailyCount[utcDate] += 1

      const tp = t.type || 'Unknown'
      if (!dailyByType[utcDate]) dailyByType[utcDate] = {}
      if (!dailyByType[utcDate][tp]) dailyByType[utcDate][tp] = 0
      dailyByType[utcDate][tp] += t.net

      if (t.account) {
        if (!dailyByAccount[utcDate]) dailyByAccount[utcDate] = {}
        if (!dailyByAccount[utcDate][t.account]) dailyByAccount[utcDate][t.account] = 0
        dailyByAccount[utcDate][t.account] += t.net
      }
    }
    // Only subtract unmatched chargebacks (matched ones already zeroed the original sale)
    for (const t of chargebackTxns) {
      if (t._matched) continue // already handled by zeroing original sale
      if (!t.date) continue
      const utcDate = t.dt ? etToUtcDate(t.dt) : t.date
      if (!dailyMap[utcDate]) dailyMap[utcDate] = 0
      if (!dailyGross[utcDate]) dailyGross[utcDate] = 0
      if (!dailyCount[utcDate]) dailyCount[utcDate] = 0
      dailyMap[utcDate] -= t.net
      dailyGross[utcDate] -= t.gross
      dailyCount[utcDate] += 1

      if (!dailyByType[utcDate]) dailyByType[utcDate] = {}
      if (!dailyByType[utcDate]['Chargeback']) dailyByType[utcDate]['Chargeback'] = 0
      dailyByType[utcDate]['Chargeback'] -= t.net
    }

    // Build daily array sorted chronologically
    const dailyData = Object.entries(dailyMap)
      .map(([date, net]) => ({
        date,
        net,
        gross: dailyGross[date] || 0,
        txnCount: dailyCount[date] || 0,
        byType: dailyByType[date] || {},
        byAccount: dailyByAccount[date] || {},
        dt: parseSheetDate(date),
      }))
      .sort((a, b) => (a.dt || 0) - (b.dt || 0))
      .map(({ dt, ...rest }) => rest)

    // ── Summary (all time) ────────────────────────────────────────────────
    let totalGross = 0, totalNet = 0, chargebackTotal = 0, matchedChargebacks = 0, unmatchedChargebacks = 0
    const byType = {}
    for (const t of salesTxns) {
      totalGross += t.gross
      totalNet += t.net // zeroed sales already have net = 0
      const tp = t.type || 'Unknown'
      byType[tp] = (byType[tp] || 0) + t.net
    }
    for (const t of chargebackTxns) {
      chargebackTotal += t.net
      if (t._matched) {
        matchedChargebacks += t.net
      } else {
        unmatchedChargebacks += t.net
      }
    }
    // Only subtract unmatched chargebacks (matched ones already zeroed the original sale)
    totalNet -= unmatchedChargebacks

    // ── Top fans (all time) ───────────────────────────────────────────────
    const fanMap = {}
    // Use sales (with zeroed chargebacks) for fan totals
    for (const t of salesTxns) {
      const key = t.ofUsername || t.displayName || 'Unknown'
      if (!fanMap[key]) fanMap[key] = { displayName: t.displayName || key, ofUsername: t.ofUsername, totalNet: 0, transactionCount: 0, lastDate: '', accounts: new Set() }
      fanMap[key].totalNet += t.net
      fanMap[key].transactionCount += 1
      if (t.displayName) fanMap[key].displayName = t.displayName
      if (!fanMap[key].lastDate) fanMap[key].lastDate = t.date
      if (t.account) fanMap[key].accounts.add(t.account)
    }
    // Subtract unmatched chargebacks from fan totals
    for (const t of chargebackTxns) {
      if (t._matched) continue
      const key = t.ofUsername || t.displayName || 'Unknown'
      if (!fanMap[key]) fanMap[key] = { displayName: t.displayName || key, ofUsername: t.ofUsername, totalNet: 0, transactionCount: 0, lastDate: '', accounts: new Set() }
      fanMap[key].totalNet -= t.net
      fanMap[key].transactionCount += 1
    }
    const topFans = Object.values(fanMap)
      .sort((a, b) => b.totalNet - a.totalNet)
      .slice(0, 25)
      .map((f, i) => ({ rank: i + 1, ...f, accounts: [...f.accounts] }))

    // ── Going cold alerts ────────────────────────────────────────────────
    const goingColdAlerts = detectGoingCold(transactions, now)

    // Lightweight mode: skip chart/topFans computation, just return alerts
    if (goingColdOnly) {
      return Response.json({
        creator,
        goingColdAlerts: goingColdAlerts.slice(0, 30),
        goingColdCount: goingColdAlerts.length,
      })
    }

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

    // Build unique account types for UI pills (only when multi-account)
    const uniqueAccounts = accountList.length > 1
      ? accountList.map(a => a.account).filter(Boolean)
      : []

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
      transactions: cleanTxns,
      goingColdAlerts: goingColdAlerts.slice(0, 30),
      goingColdCount: goingColdAlerts.length,
      dailyData,
      accounts: uniqueAccounts, // e.g. ['Free', 'VIP'] — empty for single-account creators
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
