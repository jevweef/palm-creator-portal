export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'

// Per-creator "content movement": how real content flowed through the pipeline
// (today + rolling 7 days) plus the live backlog sitting at each gate.
//
// Validated decisions (see scripts/agents/content_movement.py, the proof harness):
//   - REAL content only. AI-generated assets (Source Type = 'AI Generated') are
//     excluded from uploads, edits, and the For-Review backlog.
//   - Uploads come from Assets, split by Asset Type (Video vs Photo). Counted by
//     record Created Time, because the My Content upload path doesn't set
//     'Asset Created Date' (only the bulk ingestion does).
//   - Inspo = scraped REFERENCE reels (Inspiration table) — a direction layer,
//     not content moving toward posting. Shown separately. Counted by Created.
//   - Edits = completed editor Tasks; a revision does NOT create a new task, so
//     one task = one edit. Skip tasks whose asset is AI.
//   - Telegram = Posts with a Telegram Sent At (reel + thumbnail = one Post).
//   - Posted has no source yet (Posted At is never filled) → always 0 until the
//     page-scrape is wired.
//   - Backlog: For Review = Tasks 'Pending Review' (non-AI); Post Prep = Posts
//     'Staged'; Ready to Send = Posts 'Ready to Go'.

const dayOf = (s) => { try { return new Date(s).toISOString().slice(0, 10) } catch { return null } }
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }

export async function GET() {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const today = new Date().toISOString().slice(0, 10)
    const win = daysAgo(7)

    // Only creators we actively manage social media for ('Social Media Editing' on).
    // This is read live, so anyone toggled on/off appears/disappears automatically.
    const creators = await fetchAirtableRecords('Palm Creators', { fields: ['Creator', 'Status', 'Social Media Editing', 'Weekly Reel Quota'] })
    const name = {}, quota = {}, active = []
    for (const r of creators) {
      name[r.id] = (r.fields?.Creator || '').trim() || r.id.slice(0, 6)
      quota[r.id] = Number(r.fields?.['Weekly Reel Quota']) || 0
      if (r.fields?.Status === 'Active' && r.fields?.['Social Media Editing']) active.push(r.id)
    }
    active.sort((a, b) => name[a].toLowerCase().localeCompare(name[b].toLowerCase()))

    // AI-generated asset ids (excluded everywhere)
    const aiAssets = await fetchAirtableRecords('Assets', { filterByFormula: "{Source Type} = 'AI Generated'", fields: ['Asset Type'] })
    const aiIds = new Set(aiAssets.map(r => r.id))

    // Generic flow counter → { wk, td } keyed by creator id.
    async function flow(table, link, dateField, { useCreated = false, extra = null } = {}) {
      const base = useCreated ? `IS_AFTER(CREATED_TIME(), '${win}')` : `IS_AFTER({${dateField}}, '${win}')`
      const formula = extra ? `AND(${base}, ${extra})` : base
      const fields = useCreated ? [link] : [link, dateField]
      const rows = await fetchAirtableRecords(table, { filterByFormula: formula, fields })
      const wk = {}, td = {}
      for (const r of rows) {
        const d = dayOf(useCreated ? r.createdTime : r.fields?.[dateField])
        for (const cid of (r.fields?.[link] || [])) {
          wk[cid] = (wk[cid] || 0) + 1
          if (d === today) td[cid] = (td[cid] || 0) + 1
        }
      }
      return { wk, td }
    }

    // Uploads exclude AI AND inspo-clip uploads (those get their own column).
    const notAiNotInspo = "{Source Type} != 'AI Generated', {Source Type} != 'Inspo Upload'"
    const vids   = await flow('Assets', 'Palm Creators', null, { useCreated: true, extra: `AND(${notAiNotInspo}, {Asset Type} = 'Video')` })
    const photos = await flow('Assets', 'Palm Creators', null, { useCreated: true, extra: `AND(${notAiNotInspo}, {Asset Type} = 'Photo')` })
    // "Inspo" = clips the creator filmed INTO a saved inspo record (My Content upload).
    const inspo  = await flow('Assets', 'Palm Creators', null, { useCreated: true, extra: "{Source Type} = 'Inspo Upload'" })
    const tg     = await flow('Posts', 'Creator', 'Telegram Sent At')
    const posted = await flow('Posts', 'Creator', 'Posted At')

    // Edits = completed tasks, excluding AI-asset tasks.
    const taskRows = await fetchAirtableRecords('Tasks', { filterByFormula: `IS_AFTER({Completed At}, '${win}')`, fields: ['Creator', 'Completed At', 'Asset'] })
    const edW = {}, edT = {}
    for (const r of taskRows) {
      const a = r.fields?.Asset || []
      if (a.length && aiIds.has(a[0])) continue
      const d = dayOf(r.fields?.['Completed At'])
      for (const cid of (r.fields?.Creator || [])) {
        edW[cid] = (edW[cid] || 0) + 1
        if (d === today) edT[cid] = (edT[cid] || 0) + 1
      }
    }

    // Backlog
    const reviewRows = await fetchAirtableRecords('Tasks', { filterByFormula: "{Admin Review Status} = 'Pending Review'", fields: ['Creator', 'Asset'] })
    const review = {}
    for (const r of reviewRows) {
      const a = r.fields?.Asset || []
      if (a.length && aiIds.has(a[0])) continue
      for (const cid of (r.fields?.Creator || [])) review[cid] = (review[cid] || 0) + 1
    }
    const tally = (rows) => { const c = {}; for (const r of rows) for (const cid of (r.fields?.Creator || [])) c[cid] = (c[cid] || 0) + 1; return c }
    const prep  = tally(await fetchAirtableRecords('Posts', { filterByFormula: "{Status} = 'Staged'", fields: ['Creator'] }))
    const ready = tally(await fetchAirtableRecords('Posts', { filterByFormula: "{Status} = 'Ready to Go'", fields: ['Creator'] }))

    // Banked content = unposted real assets sitting in the unreviewed library → drives runway.
    const bankV = {}, bankP = {}
    for (const r of await fetchAirtableRecords('Assets', {
      filterByFormula: "AND({Source Type} != 'AI Generated', {First Posted At} = '', FIND('10_UNREVIEWED_LIBRARY', {Dropbox Path (Current)}))",
      fields: ['Palm Creators', 'Asset Type'],
    })) {
      const t = r.fields?.['Asset Type']
      for (const cid of (r.fields?.['Palm Creators'] || [])) {
        if (t === 'Video') bankV[cid] = (bankV[cid] || 0) + 1
        else if (t === 'Photo') bankP[cid] = (bankP[cid] || 0) + 1
      }
    }

    const g = (o, cid) => o[cid] || 0
    const cell = (o, cid) => ({ today: g(o.td, cid), week: g(o.wk, cid) })
    // Quota pace: reels sent to post (Telegram) in the last 7 days vs the weekly quota.
    const paceOf = (cid) => {
      const q = quota[cid]
      if (!q) return 'none'
      const got = g(tg.wk, cid)
      return got >= q ? 'good' : got >= q * 0.5 ? 'behind' : 'low'
    }
    // Runway (weeks) = banked reels ÷ the reels they actually post per week (fallback to quota).
    const runwayOf = (cid) => {
      const v = bankV[cid] || 0
      const rate = g(tg.wk, cid) || quota[cid]
      return rate ? Math.round((v / rate) * 10) / 10 : null
    }
    const rows = active.map(cid => ({
      id: cid,
      name: name[cid],
      quota: quota[cid],
      pace: paceOf(cid),
      bankedVideos: bankV[cid] || 0,
      bankedPhotos: bankP[cid] || 0,
      runway: runwayOf(cid),
      videos:   cell(vids, cid),
      photos:   cell(photos, cid),
      inspo:    cell(inspo, cid),
      edits:    { today: g(edT, cid), week: g(edW, cid) },
      telegram: cell(tg, cid),
      posted:   cell(posted, cid),
      review:   g(review, cid),
      prep:     g(prep, cid),
      ready:    g(ready, cid),
    }))

    return NextResponse.json({ generatedAt: new Date().toISOString(), today, rows })
  } catch (err) {
    console.error('[content-movement]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
