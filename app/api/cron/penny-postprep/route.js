export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { fetchAirtableRecords, requireAdminOrSocialMedia } from '@/lib/adminAuth'
import { processOnePostPrep } from '@/lib/penny'

// Penny PROCESSING only: caption + thumbnail decision + Status='Staged'.
// Channel assignment, thumbnail-fill, and queueing now live in
// /api/cron/hourly-telegram-push so a heavy recovery sweep can NEVER time this
// run out (the old combined version hit 504s — each reel's two Gemini video
// calls are ~60s, so 3 reels alone is ~180-200s; adding the per-creator sweep
// pushed it past the 300s budget and reels never finished staging).
//
// 2 reels/run keeps a worst-case tick (a large Files-API reel ~100s each) safely
// under 300s. A backlog drains over a few ticks; hourly-push channels + sends.
const POSTS_PER_RUN = 2

export async function GET(request) {
  // Vercel cron bearer OR admin/social-media (manual drain on preview).
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  const isCronCall = expectedAuth && request.headers.get('authorization') === expectedAuth
  if (!isCronCall) {
    try { await requireAdminOrSocialMedia() } catch (e) { return e }
  }

  const { searchParams } = new URL(request.url)
  const dryRun = searchParams.get('dryRun') === '1'
  // Manual override clamped to a budget-safe max (4 × worst-case < 300s).
  const limit = Math.max(1, Math.min(Number(searchParams.get('limit')) || POSTS_PER_RUN, 4))

  // Naked real-content reels in Post-Prep: approved (Ready to Go), no caption,
  // not yet channeled. Exclude AI (Pipeline Target 'Publer' / 'AI'). Oldest first.
  const naked = await fetchAirtableRecords('Posts', {
    filterByFormula: `AND({Type}='Reel', {Status}='Ready to Go', {Caption}='', {Channel}='', {Pipeline Target}!='Publer', {Pipeline Target}!='AI')`,
    fields: ['Post Name', 'Creator', 'Asset', 'Caption', 'Channel'],
    sort: [{ field: 'Scheduled Date', direction: 'asc' }],
    maxRecords: limit,
  })

  const results = []
  for (const post of naked) {
    results.push(await processOnePostPrep(post, { dryRun }))
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    processed: results.filter((r) => r.staged || r.dryRun).length,
    errors: results.filter((r) => r.error).length,
    results,
  })
}
