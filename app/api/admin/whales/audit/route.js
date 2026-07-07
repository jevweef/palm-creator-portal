import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord, createAirtableRecord } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'
import { sheetsClient, readTabRows, fetchRevenueAccountNames } from '@/lib/transactionsSheet'
import { ofApi } from '@/lib/onlyfansApi'
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
// Body: { creatorRecordId, days?=730, minLifetime?=100 }
// Tiers (personalized): gapRatio = daysSinceLastPurchase / medianGap
//   warning ≥ 2×   high ≥ 3×   critical ≥ 5×   dead ≥ 8× (or 120d+ silent)
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorRecordId, days = 730, minLifetime = 100 } = await request.json()
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

      // Fan-history shape: peak month, best 6-month stretch (avg/mo over his
      // hottest contiguous window), and how many $500+ months — separates the
      // consistent whale from the one-month big spender.
      const monthly = {}
      for (const p of f.purchases) { const mo = p.date.slice(0, 7); monthly[mo] = (monthly[mo] || 0) + p.net }
      const moKeys = Object.keys(monthly).sort()
      let peakMonth = null, peakMonthSpend = 0
      for (const k of moKeys) if (monthly[k] > peakMonthSpend) { peakMonthSpend = monthly[k]; peakMonth = k }
      const monthsOver500 = moKeys.filter((k) => monthly[k] >= 500).length
      let best6moAvg = 0
      if (moKeys.length) {
        const seq = []
        let [y, m] = moKeys[0].split('-').map(Number)
        const lastKey = moKeys[moKeys.length - 1]
        for (let guard = 0; guard < 600; guard++) {
          const k = `${y}-${String(m).padStart(2, '0')}`
          seq.push(monthly[k] || 0)
          if (k === lastKey) break
          m++; if (m > 12) { m = 1; y++ }
        }
        const win = Math.min(6, seq.length)
        for (let i = 0; i <= seq.length - win; i++) {
          const avg = seq.slice(i, i + win).reduce((a, b) => a + b, 0) / win
          if (avg > best6moAvg) best6moAvg = avg
        }
      }

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
        peakMonth, peakMonthSpend: +peakMonthSpend.toFixed(2),
        best6moAvg: +best6moAvg.toFixed(2), monthsOver500,
        lastPurchaseDate: lastDate,
        tier,
      })
    }
    results.sort((a, b) => b.lifetime - a.lifetime)
    let triggered = results.filter((r) => r.tier && r.tier !== 'dead')
    // Dormant whales — big lifetime, gone quiet 120d+. Not urgent, but real
    // revival targets; they get tracked with Status 'Dormant' instead of
    // being thrown away (Evan: "old whales that may have completely stopped").
    let dormantWhales = results.filter((r) => r.tier === 'dead' && r.lifetime >= 500)

    // Usernames come straight from the sheet (col G) — no API lookups needed.

    // ── 4) Upsert triggered fans into Fan Tracker ────────────────────────────
    // Linked-record filter caveat: can't formula-match the Creator link — fetch
    // and JS-match (see reference_airtable_linked_record_filter).
    const trackerRows = await fetchAirtableRecords(FAN_TRACKER, {
      fields: ['Fan Name', 'OF Username', 'Creator', 'Status', 'Lifetime Spend', 'Cadence'],
    })
    const mine = trackerRows.filter((r) => (r.fields?.Creator || []).includes(creatorRecordId))

    // ── Live enrichment (flagged fans only — ~1 credit each, bounded) ──────
    // One users/{username} call per flagged fan captures the signals the
    // sheet can't see: rebill off / sub set to expire, last reply (talking-
    // but-not-buying), and OF list memberships — is he on a whale/DNM list
    // (protected from mass blasts) or exposed?
    const accountId = cf['OF API Account ID']
    const liveByKey = {}
    const deletedKeys = new Set() // usernames whose OF account 404s = deleted
    if (accountId) {
      const toCheck = [...triggered, ...dormantWhales].filter((t) => t.ofUsername).slice(0, 40)
      for (const t of toCheck) {
        try {
          const json = await ofApi(`/${accountId}/users/${encodeURIComponent(t.ofUsername)}`)
          const d = json?.data ?? json ?? {}
          const so = d.subscribedOnData || {}
          const lists = (d.listsStates || []).filter((l) => l.hasUser)
          const protectedLists = lists.filter((l) => l.type === 'custom' && /whale|dnm|do.?not|vip/i.test(l.name || '')).map((l) => l.name)
          liveByKey[t.ofUsername.toLowerCase()] = {
            rebillOff: lists.some((l) => l.type === 'rebill_off') || so.status === 'Set to Expire',
            fanSince: (so.subscribeAt || '').slice(0, 10) || null,
            fanFor: so.duration || null,
            subStatus: so.status || (d.subscribedOn ? 'active' : 'not subscribed'),
            subExpires: (so.expiredAt || '').slice(0, 10) || null,
            lastReplyAt: (d.lastReplyAt || '').slice(0, 10) || null,
            protectedLists,           // on a whale/DNM list → excluded from mass blasts
            exposed: protectedLists.length === 0,
            checkedAt: new Date().toISOString(),
          }
          await new Promise((r) => setTimeout(r, 120))
        } catch (e) {
          // A hard 404 on the user = the fan DELETED his OF account. Mark his
          // tracker row so he stops occupying a save-list slot (Evan,
          // 2026-07-07 — Chris case); other errors leave the cadence standing.
          if (/OF API 404/.test(e.message || '')) deletedKeys.add(t.ofUsername.toLowerCase())
        }
      }
    }

    // Drop deleted accounts from this audit's output + flag them in the tracker.
    if (deletedKeys.size) {
      const isDeleted = (t) => t.ofUsername && deletedKeys.has(t.ofUsername.toLowerCase())
      for (const t of [...triggered, ...dormantWhales].filter(isDeleted)) {
        const row = mine.find((r) => (r.fields?.['OF Username'] || '').toLowerCase() === t.ofUsername.toLowerCase())
        if (row) {
          await patchAirtableRecord(FAN_TRACKER, row.id, {
            Status: 'Deleted',
            Notes: `OF account deleted (auto-detected by audit ${new Date().toISOString().slice(0, 10)})`,
          }).catch(() => {})
        }
      }
      const keep = (t) => !isDeleted(t)
      triggered = triggered.filter(keep)
      dormantWhales = dormantWhales.filter(keep)
    }

    let created = 0, updated = 0
    for (const t of [...triggered, ...dormantWhales]) {
      const targetStatus = t.tier === 'dead' ? 'Dormant' : 'Going Cold'
      // Cadence snapshot — structured copy of what the audit computed, so the
      // watchlist can show the SAME columns as the audit table (rhythm, silent
      // days, 30d spend) instead of just a lifetime number.
      const cadence = JSON.stringify({
        medianGap: t.medianGap, currentGap: t.currentGap, gapRatio: t.gapRatio,
        rolling30: t.rolling30, monthlyAvg90: t.monthlyAvg90,
        peakMonth: t.peakMonth, peakMonthSpend: t.peakMonthSpend,
        best6moAvg: t.best6moAvg, monthsOver500: t.monthsOver500,
        lastPurchaseDate: t.lastPurchaseDate, tier: t.tier, at: new Date().toISOString(),
        live: liveByKey[(t.ofUsername || '').toLowerCase()] || null,
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
        if (!st || ['Monitoring', 'Alert Sent', 'Going Cold', 'Dormant'].includes(st)) patch['Status'] = targetStatus
        await patchAirtableRecord(FAN_TRACKER, existing.id, patch, { typecast: true }); updated++
      } else {
        await createAirtableRecord(FAN_TRACKER, {
          'Fan Name': t.fanName,
          ...(t.ofUsername ? { 'OF Username': t.ofUsername } : {}),
          'Creator': [creatorRecordId],
          'Status': targetStatus,
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
    const triggeredKeys = new Set([...triggered, ...dormantWhales].map((t) => (t.ofUsername || t.fanName).toLowerCase()))
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
      dormantWhales: dormantWhales.length,
      tracker: { created, updated, cadenceRefreshed },
      source: `sheet (${tabs.join(', ')})`,
    })
  } catch (err) {
    console.error('[whales/audit] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

