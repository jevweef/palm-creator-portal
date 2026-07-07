import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { sheetsClient, readTabRows, fetchRevenueAccountNames } from '@/lib/transactionsSheet'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// GET ?creator=<aka>&fanName=&fanUsername= — the fan's money picture for the
// chat-team view: same stats the admin fan modal shows (lifetime, last 30d,
// best 6-mo, peak month, timeline, monthly series), computed with the same
// math as the whale audit. Role-gated to admins + chat managers.

const OPS_BASE = 'applLIT2t83plMqNx'
const CACHE = new Map() // `${creator}|${fan}` -> { at, data }

export async function GET(request) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await currentUser()
  const role = user?.publicMetadata?.role
  if (!['admin', 'super_admin', 'chat_manager'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    const url = new URL(request.url)
    const creator = url.searchParams.get('creator') || ''
    const fanName = url.searchParams.get('fanName') || ''
    const fanUsername = (url.searchParams.get('fanUsername') || '').toLowerCase()
    if (!creator || (!fanName && !fanUsername)) return NextResponse.json({ error: 'creator and fan required' }, { status: 400 })

    const cacheKey = `${creator}|${fanUsername || fanName}`.toLowerCase()
    const hit = CACHE.get(cacheKey)
    if (hit && Date.now() - hit.at < 5 * 60000) return NextResponse.json(hit.data)

    const accounts = await fetchRevenueAccountNames(creator)
    if (!accounts.length) return NextResponse.json({ error: 'creator not found' }, { status: 404 })
    const sheets = sheetsClient()
    let rows = []
    for (const acct of accounts) {
      try { rows = rows.concat(await readTabRows(sheets, `${acct} - Sales`)) } catch { /* tab missing */ }
    }
    const mine = rows.filter((r) => {
      if (fanUsername && (r.ofUsername || '').toLowerCase() === fanUsername) return true
      if (fanName && (r.displayName || '').trim() === fanName.trim()) return true
      return false
    })

    let lifetime = 0
    const purchases = []
    for (const r of mine) {
      if (/chargeback/i.test(r.type || '')) continue
      const net = r.net || 0
      if (net <= 0) continue
      lifetime += net // subs count toward lifetime, same as everywhere else
      if (!/subscription/i.test(r.type || '')) purchases.push({ date: (r.dateTime || '').slice(0, 10), net })
    }

    const now = Date.now()
    const dates = [...new Set(purchases.map((p) => p.date))].sort()
    const thirtyAgo = new Date(now - 30 * 86400000).toISOString().slice(0, 10)
    const ninetyAgo = new Date(now - 90 * 86400000).toISOString().slice(0, 10)
    const rolling30 = purchases.filter((p) => p.date >= thirtyAgo).reduce((s, p) => s + p.net, 0)
    const monthlyAvg90 = purchases.filter((p) => p.date >= ninetyAgo).reduce((s, p) => s + p.net, 0) / 3

    // Same peak / best-6-month math as the whale audit.
    const monthly = {}
    for (const p of purchases) { const mo = p.date.slice(0, 7); monthly[mo] = (monthly[mo] || 0) + p.net }
    const moKeys = Object.keys(monthly).sort()
    let peakMonth = null, peakMonthSpend = 0
    for (const k of moKeys) if (monthly[k] > peakMonthSpend) { peakMonthSpend = monthly[k]; peakMonth = k }
    let best6moAvg = 0
    const series = []
    if (moKeys.length) {
      let [y, m] = moKeys[0].split('-').map(Number)
      const nowKey = new Date().toISOString().slice(0, 7)
      for (let guard = 0; guard < 600; guard++) {
        const k = `${y}-${String(m).padStart(2, '0')}`
        series.push({ month: k, net: Math.round(monthly[k] || 0) })
        if (k === nowKey) break
        m++; if (m > 12) { m = 1; y++ }
      }
      const seq = series.map((s) => s.net)
      const win = Math.min(6, seq.length)
      for (let i = 0; i <= seq.length - win; i++) {
        const avg = seq.slice(i, i + win).reduce((a, b) => a + b, 0) / win
        if (avg > best6moAvg) best6moAvg = avg
      }
    }
    const lastBuy = dates[dates.length - 1] || null
    // Rhythm + tier — identical formulas to the whale audit.
    const gaps = []
    for (let i = 1; i < dates.length; i++) {
      const d = Math.round((new Date(dates[i]) - new Date(dates[i - 1])) / 86400000)
      if (d > 0) gaps.push(d)
    }
    gaps.sort((a, b) => a - b)
    const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null
    const currentGap = lastBuy ? Math.round((now - new Date(lastBuy).getTime()) / 86400000) : null
    let tier = null, gapRatio = null
    if (medianGap && dates.length >= 3 && currentGap != null) {
      gapRatio = +(currentGap / Math.max(medianGap, 1)).toFixed(1)
      if (currentGap < 7) tier = null
      else if (gapRatio >= 8 || currentGap >= 120) tier = 'dead'
      else if (gapRatio >= 5) tier = 'critical'
      else if (gapRatio >= 3) tier = 'high'
      else if (gapRatio >= 2) tier = 'warning'
    }
    const monthsOver500 = moKeys.filter((k) => monthly[k] >= 500).length
    const data = {
      medianGap, currentGap, gapRatio, tier, monthsOver500,
      lifetime: Math.round(lifetime),
      rolling30: Math.round(rolling30),
      monthlyAvg90: Math.round(monthlyAvg90),
      best6moAvg: Math.round(best6moAvg),
      peakMonth, peakMonthSpend: Math.round(peakMonthSpend),
      firstBuy: dates[0] || null,
      lastBuy,
      silentDays: lastBuy ? Math.round((now - new Date(lastBuy).getTime()) / 86400000) : null,
      purchases: purchases.length,
      series,
    }
    CACHE.set(cacheKey, { at: Date.now(), data })
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
