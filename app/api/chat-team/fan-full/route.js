import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { sheetsClient, readTabRows, fetchRevenueAccountNames } from '@/lib/transactionsSheet'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// GET ?creator=<aka>&fanName=&fanUsername= — everything the REAL FanRow modal
// needs, so the chat-team view renders the exact same component the admin
// sees (read-only): the fan object (tracker + cadence) and his transaction
// rows. Role-gated to admins + chat managers.

const OPS_BASE = 'applLIT2t83plMqNx'
const HEADERS = { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` }
const CACHE = new Map()

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

    // 1) his transaction rows (all accounts for this creator)
    const accounts = await fetchRevenueAccountNames(creator)
    const sheets = sheetsClient()
    let rows = []
    for (const acct of accounts) {
      try { rows = rows.concat(await readTabRows(sheets, `${acct} - Sales`)) } catch { /* tab missing */ }
    }
    const txns = rows
      .filter((r) => (fanUsername && (r.ofUsername || '').toLowerCase() === fanUsername) || (fanName && (r.displayName || '').trim() === fanName.trim()))
      .map((r) => ({
        date: (r.dateTime || '').slice(0, 10), net: r.net || 0, type: r.type || '',
        displayName: r.displayName || '', ofUsername: r.ofUsername || '', account: '',
      }))

    // 2) tracker row (status, cadence, alerts, notes)
    const tp = new URLSearchParams()
    tp.set('pageSize', '5')
    tp.set('filterByFormula', fanUsername
      ? `LOWER({OF Username}) = '${fanUsername.replace(/'/g, "\\'")}'`
      : `{Fan Name} = '${fanName.replace(/'/g, "\\'")}'`)
    const tres = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent('Fan Tracker')}?${tp}`, { headers: HEADERS, cache: 'no-store' })
    const trec = ((await tres.json()).records || [])[0]
    const tf = trec?.fields || {}
    let cad = null
    try { cad = JSON.parse(tf.Cadence || 'null') } catch { /* none */ }

    // fan object in the CRM's shape — real purchases only for cadence stats
    const isReal = (t) => !/chargeback|subscription/i.test(t.type || '')
    const real = txns.filter((t) => isReal(t) && t.net > 0)
    let lifetime = 0
    for (const t of txns) { if (t.net > 0 && !/chargeback/i.test(t.type || '')) lifetime += t.net }
    const dates = [...new Set(real.map((t) => t.date))].sort()
    const now = new Date()
    const thirtyAgo = new Date(now - 30 * 86400000).toISOString().slice(0, 10)
    const last30 = real.filter((t) => t.date >= thirtyAgo).reduce((s, t) => s + t.net, 0)
    const status = typeof tf.Status === 'string' ? tf.Status : tf.Status?.name
    const heatStatus = cad?.tier === 'dead' ? 'Dead' : cad?.tier ? 'Going Cold' : (status === 'Dormant' ? 'Dead' : 'Stable')
    const trackerLifetime = tf['Lifetime Spend'] || 0
    const fan = {
      id: trec?.id || `sheet-${fanUsername || fanName}`,
      fanName: tf['Fan Name'] || fanName || '',
      ofUsername: tf['OF Username'] || (fanUsername ? url.searchParams.get('fanUsername') : '') || '',
      lifetimeSpend: Math.max(Math.round(lifetime), trackerLifetime),
      lifetimeOverride: tf['Lifetime Override'] || null,
      last30: Math.round(last30),
      last180: real.filter((t) => t.date >= new Date(now - 180 * 86400000).toISOString().slice(0, 10)).reduce((s, t) => s + t.net, 0),
      txnCount: real.length,
      firstDate: dates[0] || '',
      lastDate: dates[dates.length - 1] || '',
      heatStatus,
      heatDetail: cad ? {
        reason: cad.medianGap ? `buys every ~${cad.medianGap}d — silent ${cad.currentGap}d (${cad.gapRatio}×)` : `silent ${cad.currentGap ?? '—'}d`,
        currentGap: cad.currentGap, medianGap: cad.medianGap,
        rolling30: cad.rolling30, monthlyAvg90: cad.monthlyAvg90,
        lastPurchase: cad.lastPurchaseDate,
      } : null,
      liveSignals: cad?.live || null,
      alertStatus: status === 'Alert Sent' ? 'Sent to Manager' : status === 'Analyzed' ? 'Fan Analyzed' : 'None',
      alertCount: tf['Alert Count'] || 0,
      alertHistory: (() => { try { return JSON.parse(tf['Alert History'] || '[]') } catch { return [] } })(),
      analysisRecords: [],
      firstFlagged: tf['First Flagged'] || null,
      lastAlertSent: tf['Last Alert Sent'] || null,
      timesGoneCold: tf['Times Gone Cold'] || 0,
      preAlertSpend30d: tf['Pre-Alert Spend 30d'] || 0,
      postAlertSpend30d: tf['Post-Alert Spend 30d'] || 0,
      effectiveness: tf['Effectiveness'] || '',
      notes: tf['Notes'] || '',
      banned: status === 'Banned',
      accounts: [],
      source: 'tracker',
    }
    const data = { fan, txns }
    CACHE.set(cacheKey, { at: Date.now(), data })
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
