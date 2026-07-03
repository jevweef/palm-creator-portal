import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord, createAirtableRecord } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'
import { ofApi, createDataExport, waitForDataExport, downloadExportCsv } from '@/lib/onlyfansApi'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const FAN_TRACKER = 'Fan Tracker'

// POST — "Run audit" for one creator. Button-triggered (no cron, per Evan).
//
// Pulls the creator's transactions from the OF API (bulk export — the polite,
// cheap path: 1 credit / 20 rows), computes each fan's PERSONAL spending
// cadence, and flags fans falling off their own rhythm (not a fixed day-count).
// Upserts flagged fans into Fan Tracker so the existing whale flow (alerts,
// analyses, Wendy) picks them up.
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
    const accountId = cf['OF API Account ID']
    if (!accountId) {
      return NextResponse.json({ error: `${cf.AKA || 'This creator'} isn't connected to the OnlyFans API yet` }, { status: 400 })
    }

    // ── 1) Bulk-pull transactions ────────────────────────────────────────────
    const end = new Date()
    const start = new Date(end.getTime() - days * 86400000)
    const exp = await createDataExport({
      type: 'transactions',
      accountIds: [accountId],
      startDate: start.toISOString().slice(0, 10) + 'T00:00:00Z',
      endDate: end.toISOString().slice(0, 19) + 'Z',
    })
    const done = await waitForDataExport(exp.id)
    const csv = await downloadExportCsv(done)
    const txns = parseCsv(csv)

    // ── 2) Per-fan cadence ───────────────────────────────────────────────────
    // Real purchases only: completed, positive net. Subscriptions count toward
    // lifetime but NOT cadence (renewals are passive).
    const byFan = {}
    for (const t of txns) {
      const fanId = t.fan_id
      if (!fanId) continue
      const status = (t.status || '').toLowerCase()
      if (status && status !== 'done') continue
      const net = parseFloat(t.net_amount || '0') || 0
      if (net <= 0) continue
      const isSub = /subscription/i.test(t.type || '')
      const date = (t.onlyfans_created_at || '').slice(0, 10)
      if (!date) continue
      const f = (byFan[fanId] ||= { fanId, lifetime: 0, purchases: [], name: '' })
      f.lifetime += net
      if (!isSub) f.purchases.push({ date, net })
      const nameMatch = (t.description || '').match(/from\s+(?:<a[^>]*>)?([^<]+)/i)
      if (nameMatch && !f.name) f.name = nameMatch[1].trim()
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
      let tier = null
      let gapRatio = null
      if (medianGap && dates.length >= 3) {
        gapRatio = +(currentGap / Math.max(medianGap, 1)).toFixed(1)
        if (gapRatio >= 8 || currentGap >= 120) tier = 'dead'
        else if (gapRatio >= 5) tier = 'critical'
        else if (gapRatio >= 3) tier = 'high'
        else if (gapRatio >= 2) tier = 'warning'
      } else if (currentGap >= 90) {
        tier = 'dead'
      }

      results.push({
        fanId: f.fanId,
        fanName: f.name || `fan ${f.fanId}`,
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

    // ── 3) Resolve usernames for triggered fans (mass endpoint, 10/call) ────
    const idsToResolve = triggered.map((t) => t.fanId).slice(0, 50)
    const userMap = {}
    for (let i = 0; i < idsToResolve.length; i += 10) {
      try {
        const json = await ofApi(`/${accountId}/users/list?ids=${idsToResolve.slice(i, i + 10).join(',')}`)
        const users = json?.data ?? json ?? []
        for (const u of Array.isArray(users) ? users : Object.values(users)) {
          if (u?.id) userMap[String(u.id)] = { username: u.username || '', name: u.name || '' }
        }
      } catch { /* names stay as description-derived */ }
    }
    for (const t of triggered) {
      const u = userMap[String(t.fanId)]
      if (u) { t.ofUsername = u.username; if (u.name) t.fanName = u.name }
    }

    // ── 4) Upsert triggered fans into Fan Tracker ────────────────────────────
    // Linked-record filter caveat: can't formula-match the Creator link — fetch
    // and JS-match (see reference_airtable_linked_record_filter).
    const trackerRows = await fetchAirtableRecords(FAN_TRACKER, {
      fields: ['Fan Name', 'OF Username', 'Creator', 'Status', 'Lifetime Spend'],
    })
    const mine = trackerRows.filter((r) => (r.fields?.Creator || []).includes(creatorRecordId))
    let created = 0, updated = 0
    for (const t of triggered) {
      const existing = mine.find((r) =>
        (t.ofUsername && (r.fields?.['OF Username'] || '').toLowerCase() === t.ofUsername.toLowerCase()) ||
        ((r.fields?.['Fan Name'] || '').toLowerCase() === t.fanName.toLowerCase())
      )
      if (existing) {
        const patch = {}
        if ((existing.fields?.['Lifetime Spend'] || 0) < t.lifetime) patch['Lifetime Spend'] = t.lifetime
        if (t.ofUsername && !existing.fields?.['OF Username']) patch['OF Username'] = t.ofUsername
        // Don't clobber an in-flight status (Alert Sent / Recovering / …)
        if (!existing.fields?.Status || existing.fields?.Status === 'Monitoring') patch['Status'] = 'Going Cold'
        if (Object.keys(patch).length) { await patchAirtableRecord(FAN_TRACKER, existing.id, patch, { typecast: true }); updated++ }
      } else {
        await createAirtableRecord(FAN_TRACKER, {
          'Fan Name': t.fanName,
          ...(t.ofUsername ? { 'OF Username': t.ofUsername } : {}),
          'Creator': [creatorRecordId],
          'Status': 'Going Cold',
          'First Flagged': new Date().toISOString(),
          'Lifetime Spend': t.lifetime,
          'Notes': `Auto-flagged by OF API audit — ${t.tier}: ${t.currentGap}d silent vs ${t.medianGap}d rhythm (${t.gapRatio}×), $${t.rolling30}/30d vs $${Math.round(t.monthlyAvg90)}/mo avg`,
        }, { typecast: true })
        created++
      }
    }

    return NextResponse.json({
      ok: true,
      creator: cf.AKA || cf.Creator,
      window: `${days}d`,
      transactions: txns.length,
      fansWithSpend: Object.keys(byFan).length,
      fansOverMinimum: results.length,
      topSpenders: results.slice(0, 25),
      triggered,
      tracker: { created, updated },
      exportCredits: done.credit_cost ?? null,
    })
  } catch (err) {
    console.error('[whales/audit] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// Minimal CSV parser (quoted fields, commas inside quotes).
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return []
  const parseLine = (line) => {
    const out = []
    let cur = ''
    let q = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
        else if (c === '"') q = false
        else cur += c
      } else if (c === '"') q = true
      else if (c === ',') { out.push(cur); cur = '' }
      else cur += c
    }
    out.push(cur)
    return out
  }
  const headers = parseLine(lines[0])
  return lines.slice(1).map((l) => {
    const vals = parseLine(l)
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']))
  })
}
