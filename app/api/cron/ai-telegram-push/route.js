export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { fetchAirtableRecords, patchAirtableRecord, requireAdminOrSocialMedia } from '@/lib/adminAuth'

// AI parallel of hourly-telegram-push: flip every AI reel that's staged in the
// AI grid to 'Queued for Telegram'. The existing per-minute telegram-queue drains
// them and routes each to the creator's AI topic by Source Type (no IG/FB channel
// needed for AI). The real hourly-push excludes Pipeline Target='AI', so the two
// pushes never overlap.
export async function GET(request) {
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  const isCronCall = expectedAuth && request.headers.get('authorization') === expectedAuth
  if (!isCronCall) {
    try { await requireAdminOrSocialMedia() } catch (e) { return e }
  }

  const ready = await fetchAirtableRecords('Posts', {
    filterByFormula: `AND({Status}='Staged', {Pipeline Target}='AI', {Telegram Sent At}='', {Posted At}='')`,
    fields: ['Post Name'],
    sort: [{ field: 'Scheduled Date', direction: 'asc' }],
  })

  if (!ready.length) {
    return NextResponse.json({ ok: true, queued: 0, message: 'nothing AI-staged to push' })
  }

  const results = await Promise.allSettled(
    ready.map((p) => patchAirtableRecord('Posts', p.id, { 'Status': 'Queued for Telegram' }, { typecast: true }))
  )
  const queued = results.filter((r) => r.status === 'fulfilled').length
  const failed = results
    .map((r, i) => (r.status === 'rejected' ? { postId: ready[i].id, error: r.reason?.message } : null))
    .filter(Boolean)

  return NextResponse.json({ ok: true, queued, ...(failed.length ? { failed } : {}) })
}
