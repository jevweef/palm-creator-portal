export const dynamic = 'force-dynamic'
// Each reel costs ~45s (caption ~20s + thumbnail read ~15s + frame grab/upload
// ~10s). Cap the batch so we stay well under the function budget; the cron runs
// every 30 min so a backlog drains over a few ticks.
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { fetchAirtableRecords, requireAdminOrSocialMedia } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'
import { processOnePostPrep, assignChannels, fillBlankThumbnails, linkedIds } from '@/lib/penny'

// How many naked reels to process per tick. Each reel is ~45s, but a large reel
// routed through Gemini's Files API can add ~60s, so 3/run keeps a worst-case
// tick comfortably under the 300s budget. A backlog drains over a few ticks.
const POSTS_PER_RUN = 3

export async function GET(request) {
  // Vercel cron bearer OR admin/social-media (manual drain on preview).
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  const isCronCall = expectedAuth && request.headers.get('authorization') === expectedAuth
  if (!isCronCall) {
    try { await requireAdminOrSocialMedia() } catch (e) { return e }
  }

  const { searchParams } = new URL(request.url)
  const dryRun = searchParams.get('dryRun') === '1'
  // Clamp the manual override to a budget-safe max (5 × worst-case < 300s); the
  // scheduled run always uses POSTS_PER_RUN.
  const limit = Math.max(1, Math.min(Number(searchParams.get('limit')) || POSTS_PER_RUN, 5))

  // Naked real-content reels sitting in Post-Prep: approved (Ready to Go), no
  // caption yet, not yet channeled. Exclude AI content — Publer-bound
  // (Pipeline Target='Publer') AND the AI parallel track (Pipeline Target='AI').
  // Oldest first.
  const naked = await fetchAirtableRecords('Posts', {
    filterByFormula: `AND({Type}='Reel', {Status}='Ready to Go', {Caption}='', {Channel}='', {Pipeline Target}!='Publer', {Pipeline Target}!='AI')`,
    fields: ['Post Name', 'Creator', 'Asset', 'Caption', 'Channel'],
    sort: [{ field: 'Scheduled Date', direction: 'asc' }],
    maxRecords: limit,
  })

  // 1) Process any naked reels → caption + thumbnail decision + Status='Staged'.
  const results = []
  for (const post of naked) {
    results.push(await processOnePostPrep(post, { dryRun }))
  }

  // 2) Channel + thumbnail-fill EVERY creator that currently has a staged-but-
  //    unchanneled real reel — NOT just the ones staged this tick. Driving this
  //    off a fresh "what's staged & unchanneled" query (instead of only the
  //    posts we touched) means nothing can strand:
  //    - a post a prior tick staged but failed to channel (missing topic IDs,
  //      Airtable hiccup) is recovered on a later tick;
  //    - the read-after-write window right after we set Status='Staged' self-heals
  //      next tick;
  //    - posts staged via the manual "Send to Grid" button get channeled too.
  //    Runs every tick (even with zero naked reels) so recovery never stalls.
  const creatorOps = []
  if (!dryRun) {
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
