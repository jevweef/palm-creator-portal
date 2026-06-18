export const dynamic = 'force-dynamic'
// Bumped from 60s: this now also runs the per-creator recovery sweep (moved off
// penny-postprep so caption work can't time that run out). The sweep is light
// (Airtable queries + patches, no Gemini), but give it room.
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { fetchAirtableRecords, patchAirtableRecord, requireAdminOrSocialMedia } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'
import { assignChannels, fillBlankThumbnails, linkedIds } from '@/lib/penny'

// Runs every 15 min. Two phases, both cheap (no Gemini):
//   1) RECOVERY SWEEP — for every creator with a staged-but-unchanneled real reel
//      (Penny stages with no channel), round-robin assign IG/FB + fill blank
//      thumbnails from the creator's pool. Recovers strands + channels this
//      tick's freshly-staged reels.
//   2) PUSH — flip every staged + channeled real reel to 'Queued for Telegram'.
//      The per-minute telegram-queue drains them one-at-a-time → Telegram.
// Because (1) runs before (2) in the same tick, a reel staged by Penny gets
// channeled AND queued within one 15-min cycle.
const strOf = (v) => (typeof v === 'string' ? v : (v?.name || ''))

export async function GET(request) {
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  const isCronCall = expectedAuth && request.headers.get('authorization') === expectedAuth
  if (!isCronCall) {
    try { await requireAdminOrSocialMedia() } catch (e) { return e }
  }

  // ── 1) Recovery sweep: channel + thumbnail-fill staged-unchanneled creators ──
  const creatorOps = []
  const pending = await fetchAirtableRecords('Posts', {
    filterByFormula: `AND({Status}='Staged', {Channel}='', {Telegram Sent At}='', {Posted At}='', {Pipeline Target}!='Publer', {Pipeline Target}!='AI')`,
    fields: ['Creator'],
  })
  const creatorSet = new Set()
  for (const p of pending) {
    const cid = linkedIds(p.fields?.Creator)[0]
    if (cid) creatorSet.add(cid)
  }
  for (const creatorId of creatorSet) {
    const cRec = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(creatorId)}`,
      fields: ['Creator', 'Telegram IG Topic ID', 'Telegram FB Topic ID'],
    })
    const cf = cRec[0]?.fields || {}
    const channels = await assignChannels(creatorId, cf)
    const thumbs = await fillBlankThumbnails(creatorId)
    creatorOps.push({ creatorId, name: cf.Creator || '', ...channels, ...thumbs })
  }

  // ── 2) Push: staged + channeled real reels → Queued for Telegram ──
  const ready = await fetchAirtableRecords('Posts', {
    filterByFormula: `AND({Status}='Staged', {Channel}!='', {Telegram Sent At}='', {Posted At}='', {Pipeline Target}!='Publer', {Pipeline Target}!='AI')`,
    fields: ['Post Name', 'Channel'],
    sort: [{ field: 'Scheduled Date', direction: 'asc' }],
  })

  if (!ready.length) {
    return NextResponse.json({ ok: true, queued: 0, creatorOps, message: 'nothing staged+channeled to push' })
  }

  const results = await Promise.allSettled(
    ready.map((p) => patchAirtableRecord('Posts', p.id, { 'Status': 'Queued for Telegram' }, { typecast: true }))
  )
  const queued = results.filter((r) => r.status === 'fulfilled').length
  const failed = results
    .map((r, i) => (r.status === 'rejected' ? { postId: ready[i].id, error: r.reason?.message } : null))
    .filter(Boolean)

  return NextResponse.json({
    ok: true,
    queued,
    creatorOps,
    ...(failed.length ? { failed } : {}),
    posts: ready.map((p) => ({ postId: p.id, name: p.fields?.['Post Name'] || '', channel: strOf(p.fields?.Channel) })),
  })
}
