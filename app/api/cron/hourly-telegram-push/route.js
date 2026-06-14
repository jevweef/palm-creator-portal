export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { fetchAirtableRecords, patchAirtableRecord, requireAdminOrSocialMedia } from '@/lib/adminAuth'

// Hourly push: flip every reel that's staged + channeled in the grid to
// 'Queued for Telegram'. The existing /api/cron/telegram-queue worker (every
// minute, ONE post per tick, lock + stale-recovery) then drains them safely
// one at a time — so even a big batch never fires all at once or jams. Running
// hourly keeps the SMM's queue topped up instead of one daily dump.
//
// We only QUEUE here; we never call Telegram directly. Posts must have a
// Channel (IG/FB) so the send route can resolve a topic, and must not be AI
// (Pipeline Target='Publer' routes to Publer, never Telegram).
const strOf = (v) => (typeof v === 'string' ? v : (v?.name || ''))

export async function GET(request) {
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  const isCronCall = expectedAuth && request.headers.get('authorization') === expectedAuth
  if (!isCronCall) {
    try { await requireAdminOrSocialMedia() } catch (e) { return e }
  }

  // Staged, channeled, unsent, real-content posts = everything the operator has
  // (or Penny has) parked in the grid ready to go out.
  const ready = await fetchAirtableRecords('Posts', {
    filterByFormula: `AND({Status}='Staged', {Channel}!='', {Telegram Sent At}='', {Posted At}='', {Pipeline Target}!='Publer')`,
    fields: ['Post Name', 'Channel'],
    sort: [{ field: 'Scheduled Date', direction: 'asc' }],
  })

  if (!ready.length) {
    return NextResponse.json({ ok: true, queued: 0, message: 'nothing staged to push' })
  }

  // Flip to 'Queued for Telegram'. typecast:true in case the option is missing.
  const results = await Promise.allSettled(
    ready.map((p) => patchAirtableRecord('Posts', p.id, {
      'Status': 'Queued for Telegram',
    }, { typecast: true }))
  )
  const queued = results.filter((r) => r.status === 'fulfilled').length
  const failed = results
    .map((r, i) => (r.status === 'rejected' ? { postId: ready[i].id, error: r.reason?.message } : null))
    .filter(Boolean)

  return NextResponse.json({
    ok: true,
    queued,
    ...(failed.length ? { failed } : {}),
    posts: ready.map((p) => ({ postId: p.id, name: p.fields?.['Post Name'] || '', channel: strOf(p.fields?.Channel) })),
  })
}
