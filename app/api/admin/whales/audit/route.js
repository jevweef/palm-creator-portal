import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord, createAirtableRecord } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'
import { sheetsClient, readTabRows, fetchRevenueAccountNames } from '@/lib/transactionsSheet'
import { ofApi } from '@/lib/onlyfansApi'
import { stampWhaleRun } from '@/lib/whaleRuns'
import { getDropboxAccessToken, getDropboxRootNamespaceId, downloadFromDropbox } from '@/lib/dropbox'

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
    // OF's own all-time totals per fan (from the Update Fan Data snapshot).
    // Ground truth for two things: vetoing bad nickname merges (a generic
    // 'Daniel' label inflated the wrong fan to $418 when OF says he's spent
    // $104 all-time), and floor-lifting lifetimes the 2y sheet window cuts.
    const trueNetByUsername = {}
    try {
      const dbxToken = await getDropboxAccessToken()
      const dbxNs = await getDropboxRootNamespaceId(dbxToken)
      const safeName = (cf.AKA || cf.Creator || '').replace(/[\\/:*?"<>|]/g, '_')
      const snapBuf = await downloadFromDropbox(dbxToken, dbxNs, `/Palm Ops/OF Archive/${safeName}/fans.json`)
      if (snapBuf) {
        for (const fn of (JSON.parse(snapBuf.toString('utf8')).fans || [])) {
          if (fn.username && fn.total > 0) {
            trueNetByUsername[fn.username.toLowerCase()] = Math.max(trueNetByUsername[fn.username.toLowerCase()] || 0, fn.total * 0.8)
          }
        }
      }
    } catch { /* no snapshot yet — sheet sums stand alone */ }

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

    // Merge rename-split buckets: manual-era rows carry only the chatter's
    // nickname (no username), while API-era rows for the SAME fan carry the
    // username + that nickname as display name. A label-keyed bucket whose
    // key exactly matches a username-bucket's display name is the same
    // person — fold it in so he shows once, WITH his @username (and Pull
    // works). Same exact-label rule as the 2026-07-07 ghost cleanup.
    {
      const byLabel = {}
      for (const [key, f] of Object.entries(byFan)) {
        if (f.username && f.name) {
          const lbl = f.name.trim().toLowerCase()
          if (!byLabel[lbl]) byLabel[lbl] = key
        }
      }
      for (const [key, f] of Object.entries(byFan)) {
        if (f.username) continue
        const target = byLabel[key.trim().toLowerCase()]
        if (!target || target === key) continue
        const t = byFan[target]
        // Veto: OF's all-time total caps what this fan can have spent. If the
        // merge would exceed it (15% + $50 slack for gross/net drift), the
        // label rows belong to a DIFFERENT fan with the same nickname.
        const trueNet = trueNetByUsername[(t.username || '').toLowerCase()]
        if (trueNet && (t.lifetime + f.lifetime) > trueNet * 1.15 + 50) continue
        t.lifetime += f.lifetime
        t.purchases.push(...f.purchases)
        if (!t.fanId && f.fanId) t.fanId = f.fanId
        delete byFan[key]
      }
    }

    const now = Date.now()
    const results = []
    for (const f of Object.values(byFan)) {
      const trueNet = trueNetByUsername[(f.username || '').toLowerCase()]
      if (trueNet && trueNet > f.lifetime) f.lifetime = Math.round(trueNet)
      if (f.lifetime < minLifetime) continue
      const dates = [...new Set(f.purchases.map((p) => p.date))].sort()
      if (!dates.length) continue
      const gaps = []
      for (let i = 1; i < dates.length; i++) {
        const d = Math.round((new Date(dates[i]) - new Date(dates[i - 1])) / 86400000)
        if (d > 0) gaps.push(d)
      }
      gaps.sort((a, b) => a - b)
      const medianGapLife = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null

      // CURRENT ERA: a 60d+ break ends an era — a fan's rhythm is his rhythm
      // SINCE his latest comeback, not a lifetime blend (Ray: cheap Sept week
      // + 218d gone + $2k comeback averaged to "every 5d", which was neither
      // era). Thin eras (<3 gaps) fall back to lifetime gaps.
      let eraDates = dates
      for (let i = dates.length - 1; i > 0; i--) {
        if (Math.round((new Date(dates[i]) - new Date(dates[i - 1])) / 86400000) >= 60) { eraDates = dates.slice(i); break }
      }
      let eraGaps = []
      for (let i = 1; i < eraDates.length; i++) {
        const d = Math.round((new Date(eraDates[i]) - new Date(eraDates[i - 1])) / 86400000)
        if (d > 0) eraGaps.push(d)
      }
      if (eraGaps.length < 3) eraGaps = gaps
      eraGaps = [...eraGaps].sort((a, b) => a - b)
      const medianGap = eraGaps.length ? eraGaps[Math.floor(eraGaps.length / 2)] : medianGapLife
      const gapP75 = eraGaps.length ? eraGaps[Math.min(eraGaps.length - 1, Math.floor(eraGaps.length * 0.75))] : null
      const gapP90 = eraGaps.length ? eraGaps[Math.min(eraGaps.length - 1, Math.floor(eraGaps.length * 0.9))] : null
      const gapMin = eraGaps.length ? eraGaps[0] : null
      const gapMax = eraGaps.length ? eraGaps[eraGaps.length - 1] : null
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
      // Grade against his own gap DISTRIBUTION (current era), not a single
      // median×ratio — a fan whose normal gaps swing 1-22d isn't "2.6× overdue"
      // at 13d, he's inside his own breathing room (Evan + Ray, 2026-07-09).
      // warning = past his p75, high = past his p90, critical = well past it.
      // Absolute floors keep fast buyers from tripping on a quiet week, and
      // 'dead' stays absolute time (120d).
      let tier = null
      let gapRatio = null
      if (medianGap && dates.length >= 3) {
        gapRatio = +(currentGap / Math.max(medianGap, 1)).toFixed(1)
        if (currentGap < 7) tier = null
        else if (currentGap >= 120) tier = 'dead'
        else if (currentGap > Math.max((gapP90 || medianGap) * 1.5, 14)) tier = 'critical'
        else if (currentGap > Math.max(gapP90 || medianGap * 2, 10)) tier = 'high'
        else if (currentGap > Math.max(gapP75 || medianGap * 1.5, 7)) tier = 'warning'
      } else if (currentGap >= 90) {
        tier = 'dead'
      }

      results.push({
        fanId: f.fanId || null,
        firstPurchaseDate: dates[0] || null,
        ofUsername: f.username || '',
        fanName: f.name || f.username || 'unknown fan',
        lifetime: +f.lifetime.toFixed(2),
        purchases: dates.length,
        medianGap,
        gapP75, gapP90, gapMin, gapMax,
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
    let mine = trackerRows.filter((r) => (r.fields?.Creator || []).includes(creatorRecordId))

    // ── Live enrichment (flagged fans only — ~1 credit each, bounded) ──────
    // One users/{username} call per flagged fan captures the signals the
    // sheet can't see: rebill off / sub set to expire, last reply (talking-
    // but-not-buying), and OF list memberships — is he on a whale/DNM list
    // (protected from mass blasts) or exposed?
    // Multi-account creators (Taby Free+VIP) store comma-separated ids — the
    // raw field in the URL 404'd EVERY lookup and mass-flagged her fans as
    // Deleted (58 false tombstones by 2026-07-09). Try each account; a fan is
    // deleted only when EVERY account 404s him.
    const accountIds = String(cf['OF API Account ID'] || '').split(',').map((x) => x.trim()).filter(Boolean)
    const liveByKey = {}
    const deletedKeys = new Set() // usernames whose OF account 404s = deleted
    if (accountIds.length) {
      // Check EVERY flagged fan (deadline-guarded) — Evan: deleted fans should
      // be caught HERE, in the sweep, never as a 404 when he presses a button.
      const liveDeadline = Date.now() + 200000
      const toCheck = [...triggered, ...dormantWhales].filter((t) => t.ofUsername).slice(0, 400)
      for (const t of toCheck) {
        if (Date.now() > liveDeadline) break
        let json = null, all404 = true
        for (const accountId of accountIds) {
          try {
            json = await ofApi(`/${accountId}/users/${encodeURIComponent(t.ofUsername)}`)
            all404 = false
            break
          } catch (e) {
            if (!/OF API 404/.test(e.message || '')) all404 = false
          }
        }
        if (json == null) {
          if (all404) deletedKeys.add(t.ofUsername.toLowerCase())
          continue
        }
        try {
          const d = json?.data ?? json ?? {}
          const so = d.subscribedOnData || {}
          const lists = (d.listsStates || []).filter((l) => l.hasUser)
          const protectedLists = lists.filter((l) => l.type === 'custom' && /whale|dnm|do.?not|vip/i.test(l.name || '')).map((l) => l.name)
          liveByKey[t.ofUsername.toLowerCase()] = {
            rebillOff: lists.some((l) => l.type === 'rebill_off') || so.status === 'Set to Expire',
            fanSince: (so.subscribeAt || '').slice(0, 10) || null,
            fanFor: so.duration || null,
            subStatus: so.status || (d.subscribedOn ? 'active' : 'not subscribed'),
            // OF stamps free-page subs with a far-future placeholder expiry
            // (Tassos: "expires Apr 15, 2036") — not a real date, and the
            // analyst screamed URGENT over it. Anything >2 years out is noise.
            subExpires: (() => {
              const e = (so.expiredAt || '').slice(0, 10) || null
              if (!e) return null
              const horizon = new Date(Date.now() + 2 * 365 * 86400000).toISOString().slice(0, 10)
              return e > horizon ? null : e
            })(),
            lastReplyAt: (d.lastReplyAt || '').slice(0, 10) || null,
            protectedLists,           // on a whale/DNM list → excluded from mass blasts
            exposed: protectedLists.length === 0,
            checkedAt: new Date().toISOString(),
          }
          await new Promise((r) => setTimeout(r, 120))
        } catch { /* shape surprise — leave the cadence standing */ }
      }
    }

    // No-username fans (whole history predates the API era): try to RECOVER
    // their real @username by searching OF's fan lists — active AND expired —
    // for their exact chatter nickname. Found → they become checkable/pullable
    // like everyone else. Found NOWHERE → deleted or renamed; either way
    // unactionable, so mark them Deleted and stop showing them (Evan: "I
    // don't want to waste my time on deleted accounts").
    const resolveDeadline = Date.now() + 60000
    const noUser = [...triggered, ...dormantWhales].filter((t) => !t.ofUsername && (t.fanName || '').trim())
    for (const t of noUser) {
      if (Date.now() > resolveDeadline) break
      let found = null
      for (const acc of accountIds) {
        for (const scope of ['all', 'expired']) {
          try {
            const json = await ofApi(`/${acc}/fans/${scope}?limit=20&query=${encodeURIComponent(t.fanName)}`)
            const list = json?.data?.list || json?.data || []
            const hit = (Array.isArray(list) ? list : []).find((u) => (u.name || '').trim().toLowerCase() === t.fanName.trim().toLowerCase())
            if (hit?.id) { found = hit; break }
          } catch { /* next scope */ }
        }
        if (found) break
      }
      if (found) {
        t.ofUsername = found.username || ''
        t.fanId = String(found.id)
      } else {
        t._unreachable = true
      }
      await new Promise((r) => setTimeout(r, 120))
    }
    const unreachable = noUser.filter((t) => t._unreachable)
    for (const t of unreachable) {
      const row = mine.find((r) => !(r.fields?.['OF Username']) && (r.fields?.['Fan Name'] || '').trim().toLowerCase() === (t.fanName || '').trim().toLowerCase())
      const note = `Not found on any OF fan list (active or expired) under this nickname — account deleted or renamed; unactionable. Auto-marked by audit ${new Date().toISOString().slice(0, 10)}.`
      if (row) await patchAirtableRecord(FAN_TRACKER, row.id, { Status: 'Deleted', Notes: note }).catch(() => {})
    }
    if (unreachable.length) {
      const gone = new Set(unreachable.map((t) => t.fanName))
      triggered = triggered.filter((t) => !gone.has(t.fanName) || t.ofUsername)
      dormantWhales = dormantWhales.filter((t) => !gone.has(t.fanName) || t.ofUsername)
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
        } else {
          // First-time flag AND deleted — leave a tombstone so the CRM knows
          // (otherwise he silently vanishes from audits but still shows as a
          // pullable fan in the CRM and the pull dead-ends confusingly).
          await createAirtableRecord(FAN_TRACKER, {
            'Fan Name': t.fanName, 'OF Username': t.ofUsername, 'Creator': [creatorRecordId],
            'Status': 'Deleted', 'Lifetime Spend': t.lifetime, 'First Flagged': new Date().toISOString(),
            'Notes': `OF account deleted (auto-detected by audit ${new Date().toISOString().slice(0, 10)})`,
          }, { typecast: true }).catch(() => {})
        }
      }
      const keep = (t) => !isDeleted(t)
      triggered = triggered.filter(keep)
      dormantWhales = dormantWhales.filter(keep)
    }

    // Re-fetch the tracker RIGHT before writing: the first fetch above is
    // minutes stale by now (live enrichment), and a second audit running in
    // parallel used that stale view to create all 18 of Kiki's fans twice
    // (2026-07-17). A fresh read shrinks the race window to seconds.
    mine = (await fetchAirtableRecords(FAN_TRACKER, {
      fields: ['Fan Name', 'OF Username', 'Creator', 'Status', 'Lifetime Spend', 'Cadence'],
    })).filter((r) => (r.fields?.Creator || []).includes(creatorRecordId))

    let created = 0, updated = 0
    for (const t of [...triggered, ...dormantWhales]) {
      const targetStatus = t.tier === 'dead' ? 'Dormant' : 'Going Cold'
      // Cadence snapshot — structured copy of what the audit computed, so the
      // watchlist can show the SAME columns as the audit table (rhythm, silent
      // days, 30d spend) instead of just a lifetime number.
      const cadence = JSON.stringify({
        medianGap: t.medianGap, gapP75: t.gapP75, gapP90: t.gapP90, gapMin: t.gapMin, gapMax: t.gapMax,
        currentGap: t.currentGap, gapRatio: t.gapRatio, firstPurchaseDate: t.firstPurchaseDate,
        rolling30: t.rolling30, monthlyAvg90: t.monthlyAvg90,
        peakMonth: t.peakMonth, peakMonthSpend: t.peakMonthSpend,
        best6moAvg: t.best6moAvg, monthsOver500: t.monthsOver500,
        lastPurchaseDate: t.lastPurchaseDate, tier: t.tier, fanId: t.fanId || null, at: new Date().toISOString(),
        live: liveByKey[(t.ofUsername || '').toLowerCase()] || null,
      })
      const existing = mine.find((r) =>
        (t.ofUsername && (r.fields?.['OF Username'] || '').toLowerCase() === t.ofUsername.toLowerCase()) ||
        ((r.fields?.['Fan Name'] || '').toLowerCase() === t.fanName.toLowerCase())
      )
      if (existing) {
        const patch = { 'Cadence': cadence }
        const exLt = existing.fields?.['Lifetime Spend'] || 0
        if (exLt < t.lifetime) patch['Lifetime Spend'] = t.lifetime
        // Correct corrupt legacy figures DOWN too: t.lifetime is already
        // OF-grounded (max of sheet sum and OF's own all-time total), so a
        // stored number 3x beyond it is a bad old import, not real spend
        // (a $3,344 fan sat at $149,444 for months because raises-only).
        else if (exLt > t.lifetime * 3 + 100) patch['Lifetime Spend'] = t.lifetime
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
      medianGap: t.medianGap, currentGap: t.currentGap, gapRatio: t.gapRatio, firstPurchaseDate: t.firstPurchaseDate,
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
      // Back on his rhythm (no tier) → he saved himself. Flip watch statuses
      // to Reactivated so he drops off the Save List instead of sitting there
      // as a stale FLAGGED row (Evan, 2026-07-07). Banned/Lost/Deleted stay.
      const status = typeof r.fields?.Status === 'string' ? r.fields.Status : r.fields?.Status?.name
      const patch = { 'Cadence': cadenceKey(res) }
      if (!res.tier && ['Going Cold', 'Dormant', 'Analyzed', 'Alert Sent', 'Monitoring', 'Recovering'].includes(status)) {
        patch['Status'] = 'Reactivated'
      }
      try { await patchAirtableRecord(FAN_TRACKER, r.id, patch, { typecast: true }); cadenceRefreshed++ } catch {}
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

