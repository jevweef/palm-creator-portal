export const dynamic = 'force-dynamic'
// Each reel costs ~45s (caption ~20s + thumbnail read ~15s + frame grab/upload
// ~10s). Cap the batch so we stay well under the function budget; the cron runs
// every 30 min so a backlog drains over a few ticks.
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { fetchAirtableRecords, requireAdminOrSocialMedia } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'
import { processOnePostPrep, assignChannels, fillBlankThumbnails } from '@/lib/penny'

// How many naked reels to process per tick. Keeps a single run under maxDuration.
const POSTS_PER_RUN = 5

export async function GET(request) {
  // Vercel cron bearer OR admin/social-media (manual drain on preview).
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  const isCronCall = expectedAuth && request.headers.get('authorization') === expectedAuth
  if (!isCronCall) {
    try { await requireAdminOrSocialMedia() } catch (e) { return e }
  }

  const { searchParams } = new URL(request.url)
  const dryRun = searchParams.get('dryRun') === '1'
  const limit = Math.max(1, Math.min(Number(searchParams.get('limit')) || POSTS_PER_RUN, 10))

  // Naked real-content reels sitting in Post-Prep: approved (Ready to Go), no
  // caption yet, not yet channeled. Exclude AI (Pipeline Target='Publer') — that
  // routes to Publer, never Telegram. Oldest first.
  const naked = await fetchAirtableRecords('Posts', {
    filterByFormula: `AND({Type}='Reel', {Status}='Ready to Go', {Caption}='', {Channel}='', {Pipeline Target}!='Publer')`,
    fields: ['Post Name', 'Creator', 'Asset', 'Caption', 'Channel'],
    sort: [{ field: 'Scheduled Date', direction: 'asc' }],
    maxRecords: limit,
  })

  if (!naked.length) {
    return NextResponse.json({ ok: true, processed: 0, message: 'no naked reels in post-prep' })
  }

  // Process each reel (sequential — keeps Gemini + ffmpeg load sane).
  const results = []
  const affectedCreators = new Set()
  for (const post of naked) {
    const r = await processOnePostPrep(post, { dryRun })
    results.push(r)
    if (r.staged && r.creatorId) affectedCreators.add(r.creatorId)
  }

  // Per affected creator: assign channels (IG/FB) then fill blank thumbnails
  // from the pool. Skipped entirely on a dry run.
  const creatorOps = []
  if (!dryRun) {
    for (const creatorId of affectedCreators) {
      const cRec = await fetchAirtableRecords('Palm Creators', {
        filterByFormula: `RECORD_ID() = ${quoteAirtableString(creatorId)}`,
        fields: ['Creator', 'Telegram IG Topic ID', 'Telegram FB Topic ID'],
      })
      const cf = cRec[0]?.fields || {}
      const channels = await assignChannels(creatorId, cf)
      const thumbs = await fillBlankThumbnails(creatorId)
      creatorOps.push({ creatorId, name: cf.Creator || '', ...channels, ...thumbs })
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    processed: results.filter((r) => r.staged || r.dryRun).length,
    errors: results.filter((r) => r.error).length,
    results,
    creatorOps,
  })
}
