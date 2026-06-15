export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { fetchAirtableRecords, requireAdminOrSocialMedia } from '@/lib/adminAuth'
import { processOneAiPost } from '@/lib/aiPenny'

// "AI Penny" — the AI parallel of penny-postprep. For each naked AI reel
// (Pipeline Target='AI', Status='Ready to Go', no Caption): caption + a thumbnail
// from the creator's AI thumbnail queue, then Stage it. AI content has no IG/FB
// channel — it routes to the creator's single AI Telegram topic by Source Type.
const POSTS_PER_RUN = 3

export async function GET(request) {
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  const isCronCall = expectedAuth && request.headers.get('authorization') === expectedAuth
  if (!isCronCall) {
    try { await requireAdminOrSocialMedia() } catch (e) { return e }
  }

  const { searchParams } = new URL(request.url)
  const dryRun = searchParams.get('dryRun') === '1'
  const limit = Math.max(1, Math.min(Number(searchParams.get('limit')) || POSTS_PER_RUN, 5))

  const naked = await fetchAirtableRecords('Posts', {
    filterByFormula: `AND({Type}='Reel', {Status}='Ready to Go', {Caption}='', {Pipeline Target}='AI')`,
    fields: ['Post Name', 'Creator', 'Asset', 'Caption'],
    sort: [{ field: 'Scheduled Date', direction: 'asc' }],
    maxRecords: limit,
  })

  if (!naked.length) {
    return NextResponse.json({ ok: true, processed: 0, message: 'no naked AI reels in post-prep' })
  }

  const results = []
  for (const post of naked) {
    results.push(await processOneAiPost(post, { dryRun }))
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    processed: results.filter((r) => r.staged || r.dryRun).length,
    errors: results.filter((r) => r.error).length,
    results,
  })
}
