export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { requireAdminOrSocialMedia, patchAirtableRecord, fetchAirtableRecords } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'

// Bulk-mark posts as Queued for Telegram. Replaces the old client-driven
// serial loop that ran in the user's browser tab — closing the tab or
// hitting a Vercel 504 mid-loop killed the rest of the batch. Now the
// browser just enqueues and walks away; the /api/cron/telegram-queue
// worker fires every minute and processes 2 posts per tick in Scheduled
// Date order.
//
// typecast=true so Airtable auto-creates the 'Queued for Telegram' option
// the first time it's used, no manual schema setup needed.
export async function POST(request) {
  try { await requireAdminOrSocialMedia() } catch (e) { return e }

  try {
    const { postIds } = await request.json()
    if (!Array.isArray(postIds) || !postIds.length) {
      return NextResponse.json({ error: 'postIds[] required' }, { status: 400 })
    }

    // Symmetric guard (mirror of publer/enqueue): a Post whose Pipeline Target
    // is 'Publer' (AI content) must NOT be routed into the Telegram pipe —
    // that's the human-poster path for Real content. Reject up front so a
    // mis-click can't cross the streams. 'Telegram', 'Telegram (Warmup)', and
    // unset all pass through.
    const postFilter = `OR(${postIds.map(id => `RECORD_ID() = ${quoteAirtableString(id)}`).join(',')})`
    const postsForCheck = await fetchAirtableRecords('Posts', {
      filterByFormula: postFilter,
      fields: ['Pipeline Target'],
    })
    const targetOf = (p) => {
      const t = p.fields?.['Pipeline Target']
      return typeof t === 'string' ? t : (t?.name || null)
    }
    const invalidPostIds = postsForCheck.filter(p => targetOf(p) === 'Publer').map(p => p.id)
    if (invalidPostIds.length) {
      return NextResponse.json({
        error: "Posts with Pipeline Target='Publer' cannot be enqueued to Telegram — use the Publer enqueue for AI content",
        invalidPostIds,
      }, { status: 400 })
    }

    // Patch in parallel; small batches stay under Airtable's 5/sec cap.
    // For larger batches (>20), the request will be slow but won't burst —
    // we'll deal with that by chunking once it actually matters.
    const results = await Promise.allSettled(
      postIds.map(id => patchAirtableRecord('Posts', id, {
        'Status': 'Queued for Telegram',
      }, { typecast: true }))
    )

    const ok = results.filter(r => r.status === 'fulfilled').length
    const failed = results
      .map((r, i) => r.status === 'rejected' ? { postId: postIds[i], error: r.reason?.message } : null)
      .filter(Boolean)

    return NextResponse.json({ ok: true, queued: ok, failed })
  } catch (err) {
    console.error('[telegram/enqueue] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
