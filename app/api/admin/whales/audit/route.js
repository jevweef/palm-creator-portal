import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord, createAirtableRecord } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'
import { sheetsClient, readTabRows, fetchRevenueAccountNames } from '@/lib/transactionsSheet'
import { stampWhaleRun } from '@/lib/whaleRuns'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const FAN_TRACKER = 'Fan Tracker'

// POST — "Run audit" for one creator. Button-triggered (no cron, per Evan).
//
// Reads the creator's transactions from the SAME Google Sheet the invoice
// pipeline uses (one data source — filled by the HTML upload or the OF API
// pull on the invoicing page), computes each fan's PERSONAL spending cadence,
// and flags fans falling off their own rhythm (not a fixed day-count).
// Upserts flagged fans into Fan Tracker so the existing whale flow (alerts,
// analyses, Wendy) picks them up. Zero OF-API credits per audit.
//
// Body: { creatorRecordId, days?=365, minLifetime?=100 }
// Tiers (personalized): gapRatio = daysSinceLastPurchase / medianGap
//   warning ≥ 2×   high ≥ 3×   critical ≥ 5×   dead ≥ 8× (or 120d+ silent)
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorRecordId, days = 365, minLifetime = 100 } = await request.json()
    if (!creatorRecordId) return NextResponse.json({ error: 'creatorRecordId required' }, { status: 400 })

    const creators = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(creatorRecordId)}`,
      fields: ['Creator', 'AKA', 'OF API Account ID'],
    })
    const cf = creators[0]?.fields || {}
    // No OF-API connection required — the audit reads the sheet, which the
    // HTML upload fills for unconnected creators too.

    // ── 1) Read transactions from the sheet (the single data source) ─────────
    const sheets = sheetsClient()
    const accountNames = await fetchRevenueAccountNames(cf.AKA || cf.Creator)
    const tabs = accountNames.length ? accountNames.map((a) => `${a} - Sales`) : [`${cf.AKA || cf.Creator} - Sales`]
    const cutoffDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
    let txns = []
    for (const tab of tabs) {
      const rows = await readTabRows(sheets, tab)
      txns = txns.concat(rows)
    }
    txns = txns.filter((t) => t.dateTime && t.dateTime.slice(0, 10) >= cutoffDate)
    if (!txns.length) {
      return NextResponse.json({ error: `No transaction data on the sheet for ${cf.AKA || cf.Creator} (tabs: ${tabs.join(', ')}). Pull from OF on the Invoicing → Raw Data Upload page first.` }, { status: 404 })
    }

    // ── 2) Per-fan cadence ───────────────────────────────────────────────────
    // Real purchases only: positive net, not chargebacks. Subscriptions count
    // toward lifetime but NOT cadence (renewals are passive). Fans keyed by
    // OF username (stable) falling back to display name; fan_id (col J) rides
    // along when the row came from an API pull.
    const byFan = {}
    for (const t of txns) {
      const key = (t.ofUsername || t.displayName || '').trim()
      if (!key) continue
      if (/chargeback/i.test(t.type || '')) continue
      const net = t.net || 0
      if (net <= 0) continue
      const isSub = /subscription/i.test(t.type || '')
      const date = t.dateTime.slice(0, 10)
      const f = (byFan[key] ||= { fanId: '', lifetime: 0, purchases: [], name: '', username: '' })
      f.lifetime += net
      if (!isSub) f.purchases.push({ date, net })
      if (!f.name && t.displayName) f.name = t.displayName
      if (!f.username && t.ofUsername) f.username = t.ofUsername
      if (!f.fanId && t.fanId) f.fanId = t.fanId
    }

    const now = Date.now()
    const results = []
    for (const f of Object.values(byFan)) {
      if (f.lifetime < minLifetime) continue
      const dates = [...new Set(f.purchases.map((p) => p.date))].sort()
      if (!dates.length) continue
      const gaps = []
      for (let i = 1; i < dates.length; i++) {
        const d = Math.round((new Date(dates[i]) - new Date(dates[i - 1])) / 86400000)
        if (d > 0) gaps.push(d)
      }
      gaps.sort((a, b) => a - b)
      const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null
      const lastDate = dates[dates.length - 1]
      const currentGap = Math.round((now - new Date(lastDate)) / 86400000)
      const thirtyAgo = new Date(now - 30 * 86400000).toISOString().slice(0, 10)
      const ninetyAgo = new Date(now - 90 * 86400000).toISOString().slice(0, 10)
      const rolling30 = f.purchases.filter((p) => p.date >= thirtyAgo).reduce((s, p) => s + p.net, 0)
      const monthlyAvg90 = f.purchases.filter((p) => p.date >= ninetyAgo).reduce((s, p) => s + p.net, 0) / 3

      // Personalized falloff: a fan is "off rhythm" relative to THEIR median
      // gap. One-purchase fans have no rhythm — fall back to absolute silence.
      // Minimum 7 days of absolute silence before ANY flag — a daily buyer
      // who's quiet for 2 days is normal life, not going cold (verified
      // against live OF data 2026-07-04: Vito replied same-day while flagged).
      let tier = null
      let gapRatio = null
      if (medianGap && dates.length >= 3) {
        gapRatio = +(currentGap / Math.max(medianGap, 1)).toFixed(1)
        if (currentGap < 7) tier = null
        else if (gapRatio >= 8 || currentGap >= 120) tier = 'dead'
        else if (gapRatio >= 5) tier = 'critical'
        else if (gapRatio >= 3) tier = 'high'
        else if (gapRatio >= 2) tier = 'warning'
      } else if (currentGap >= 90) {
        tier = 'dead'
      }

      results.push({
        fanId: f.fanId || null,
        ofUsername: f.username || '',
        fanName: f.name || f.username || 'unknown fan',
        lifetime: +f.lifetime.toFixed(2),
        purchases: dates.length,
        medianGap,
        currentGap,
        gapRatio,
        rolling30: +rolling30.toFixed(2),
        monthlyAvg90: +monthlyAvg90.toFixed(2),
        lastPurchaseDate: lastDate,
        tier,
      })
    }
    results.sort((a, b) => b.lifetime - a.lifetime)
    const triggered = results.filter((r) => r.tier && r.tier !== 'dead')

    // Usernames come straight from the sheet (col G) — no API lookups needed.

    // ── 4) Upsert triggered fans into Fan Tracker ────────────────────────────
    // Linked-record filter caveat: can't formula-match the Creator link — fetch
    // and JS-match (see reference_airtable_linked_record_filter).
    const trackerRows = await fetchAirtableRecords(FAN_TRACKER, {
      fields: ['Fan Name', 'OF Username', 'Creator', 'Status', 'Lifetime Spend', 'Cadence'],
    })
    const mine = trackerRows.filter((r) => (r.fields?.Creator || []).includes(creatorRecordId))
    let created = 0, updated = 0
    for (const t of triggered) {
      // Cadence snapshot — structured copy of what the audit computed, so the
      // watchlist can show the SAME columns as the audit table (rhythm, silent
      // days, 30d spend) instead of just a lifetime number.
      const cadence = JSON.stringify({
        medianGap: t.medianGap, currentGap: t.currentGap, gapRatio: t.gapRatio,
        rolling30: t.rolling30, monthlyAvg90: t.monthlyAvg90,
        lastPurchaseDate: t.lastPurchaseDate, tier: t.tier, at: new Date().toISOString(),
      })
      const existing = mine.find((r) =>
        (t.ofUsername && (r.fields?.['OF Username'] || '').toLowerCase() === t.ofUsername.toLowerCase()) ||
        ((r.fields?.['Fan Name'] || '').toLowerCase() === t.fanName.toLowerCase())
      )
      if (existing) {
        const patch = { 'Cadence': cadence }
        if ((existing.fields?.['Lifetime Spend'] || 0) < t.lifetime) patch['Lifetime Spend'] = t.lifetime
        if (t.ofUsername && !existing.fields?.['OF Username']) patch['OF Username'] = t.ofUsername
        // Status reflects the fan's CURRENT state — sending an alert doesn't
        // change that they're going cold (the alert lives in Last Alert Sent).
        // Only statuses that mean "no longer cold" are preserved.
        const st = existing.fields?.Status
        if (!st || ['Monitoring', 'Alert Sent', 'Going Cold'].includes(st)) patch['Status'] = 'Going Cold'
        await patchAirtableRecord(FAN_TRACKER, existing.id, patch, { typecast: true }); updated++
      } else {
        await createAirtableRecord(FAN_TRACKER, {
          'Fan Name': t.fanName,
          ...(t.ofUsername ? { 'OF Username': t.ofUsername } : {}),
          'Creator': [creatorRecordId],
          'Status': 'Going Cold',
          'First Flagged': new Date().toISOString(),
          'Lifetime Spend': t.lifetime,
          'Cadence': cadence,
          'Notes': `Auto-flagged by OF API audit — ${t.tier}: ${t.currentGap}d silent vs ${t.medianGap}d rhythm (${t.gapRatio}×), $${t.rolling30}/30d vs $${Math.round(t.monthlyAvg90)}/mo avg`,
        }, { typecast: true })
        created++
      }
    }

    // Refresh Cadence on EVERY existing tracker row we have sheet data for —
    // not just newly-triggered fans. Otherwise dead/legacy rows (e.g. fans
    // flagged in the manual era, or ones that slid past 'dead') sit in the
    // watchlist with blank rhythm columns forever.
    const cadenceKey = (t) => JSON.stringify({
      medianGap: t.medianGap, currentGap: t.currentGap, gapRatio: t.gapRatio,
      rolling30: t.rolling30, monthlyAvg90: t.monthlyAvg90,
      lastPurchaseDate: t.lastPurchaseDate, tier: t.tier, at: new Date().toISOString(),
    })
    const triggeredKeys = new Set(triggered.map((t) => (t.ofUsername || t.fanName).toLowerCase()))
    let cadenceRefreshed = 0
    for (const r of mine) {
      const uname = (r.fields?.['OF Username'] || '').toLowerCase()
      const fname = (r.fields?.['Fan Name'] || '').toLowerCase()
      if ((uname && triggeredKeys.has(uname)) || triggeredKeys.has(fname)) continue // already written above
      const res = results.find((t) =>
        (uname && t.ofUsername && t.ofUsername.toLowerCase() === uname) ||
        (fname && t.fanName.toLowerCase() === fname)
      )
      if (!res) continue
      try { await patchAirtableRecord(FAN_TRACKER, r.id, { 'Cadence': cadenceKey(res) }); cadenceRefreshed++ } catch {}
    }

    await stampWhaleRun(creatorRecordId, 'audit')
    return NextResponse.json({
      ok: true,
      creator: cf.AKA || cf.Creator,
      window: `${days}d`,
      transactions: txns.length,
      fansWithSpend: Object.keys(byFan).length,
      fansOverMinimum: results.length,
      topSpenders: results.slice(0, 25),
      triggered,
      tracker: { created, updated, cadenceRefreshed },
      source: `sheet (${tabs.join(', ')})`,
    })
  } catch (err) {
    console.error('[whales/audit] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

