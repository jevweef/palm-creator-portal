export const dynamic = 'force-dynamic'
// Each cron tick processes up to 2 queued posts. A heavy compress can take
// 90s+, plus 6s spacing, so 2 × 95s + 6s = ~196s wall-clock — well inside
// 300s. Picking 1-per-tick would be safer but slower (1/min throughput);
// 2-per-tick gives 120/hour which respects Telegram's 10 reels/min cap and
// finishes a typical 12-post bulk in 6 minutes.
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { fetchAirtableRecords, patchAirtableRecord, requireAdminOrSocialMedia } from '@/lib/adminAuth'

// IMPORTANT: never use VERCEL_URL here. That's the per-deployment hash
// URL (palm-creator-portal-abc123.vercel.app) which has Deployment
// Protection enabled — the cron's internal POST gets bounced with no
// useful error, posts silently fail. Always use the production alias
// (app.palm-mgmt.com) which is publicly addressable.
//
// On preview/dev this falls back to the branch alias which IS protected,
// but the dev flow uses the client-driven drain instead so it doesn't
// matter. Production cron always hits the prod alias.
const OPS_BASE_HOST = process.env.VERCEL_ENV === 'production'
  ? 'app.palm-mgmt.com'
  : (process.env.VERCEL_BRANCH_URL || 'palm-creator-portal-git-dev-evan-5378s-projects.vercel.app')

const POSTS_PER_TICK = 2
const GAP_BETWEEN_POSTS_MS = 6000

// Look up a Post + its linked Creator/Account/Asset, then fire the existing
// /api/telegram/send pipeline. We call the route internally rather than
// importing its logic so each send runs in its OWN Vercel function with
// its own 300s budget — heavy compress on one post can't kill the cron.
async function processOnePost(postId) {
  // Need Creator (for telegramThreadId), Account (for smmTopicId),
  // Asset (for editedFileLink) — same fields the client passes when it
  // clicks Send to Telegram. Fetch fresh so any caption/hashtag edits made
  // in Post Prep land in this send.
  const postList = await fetchAirtableRecords('Posts', {
    filterByFormula: `RECORD_ID()='${postId}'`,
    fields: [
      'Post Name', 'Status', 'Caption', 'Hashtags', 'Platform',
      'Thumbnail', 'Scheduled Date', 'Creator', 'Account', 'Asset',
    ],
  })
  const post = postList[0]
  if (!post) throw new Error('Post not found')
  const f = post.fields || {}

  // Status guard — if a human flipped it back to Prepping mid-cron, skip.
  if (f.Status !== 'Queued for Telegram') {
    return { skipped: true, reason: `status=${f.Status}` }
  }

  const creatorId = (f.Creator || [])[0]
  const assetId = (f.Asset || [])[0]
  const accountId = (f.Account || [])[0]
  if (!assetId) throw new Error('Post has no Asset link')

  const [creatorList, assetList, accountList] = await Promise.all([
    creatorId ? fetchAirtableRecords('Palm Creators', {
      filterByFormula: `RECORD_ID()='${creatorId}'`,
      fields: ['Creator', 'AKA', 'Telegram Thread ID'],
    }) : [],
    fetchAirtableRecords('Assets', {
      filterByFormula: `RECORD_ID()='${assetId}'`,
      fields: ['Asset Name', 'Edited File Link', 'Dropbox Shared Link', 'Stream Edit ID', 'Stream Raw ID'],
    }),
    accountId ? fetchAirtableRecords('Creator Platform Directory', {
      filterByFormula: `RECORD_ID()='${accountId}'`,
      fields: ['Telegram Topic ID', 'Account Name'],
    }) : [],
  ])

  const creator = creatorList[0]?.fields || {}
  const asset = assetList[0]?.fields || {}
  const account = accountList[0]?.fields || {}

  const editedFileLink = asset['Edited File Link'] || asset['Dropbox Shared Link']
  if (!editedFileLink) throw new Error('Asset has no file link')

  const thumbAttachment = (f.Thumbnail || [])[0]
  const thumbnailUrl = thumbAttachment?.url || ''

  // Call /api/telegram/send with wait=true so we know if it succeeded
  // before marking the Post. wait=false would let us return immediately
  // but then the cron has no way to detect failure → status stays Queued
  // forever and the post gets re-tried on every tick = infinite loop.
  const sendUrl = `https://${OPS_BASE_HOST}/api/telegram/send`
  const cronSecret = process.env.CRON_SECRET || ''
  const res = await fetch(sendUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Internal call — bypass admin auth via cron secret. The send route
      // doesn't honor this yet; we'll add it.
      'x-cron-secret': cronSecret,
    },
    body: JSON.stringify({
      postId,
      assetId,
      editedFileLink,
      thumbnailUrl,
      caption: f.Caption || '',
      hashtags: f.Hashtags || '',
      platform: f.Platform || ['Instagram Reel'],
      scheduledDate: f['Scheduled Date'] || null,
      creatorId,
      threadId: creator['Telegram Thread ID'] || null,
      smmTopicId: account['Telegram Topic ID'] || null,
      wait: true,
    }),
  })
  const text = await res.text()
  let data = {}
  try { data = JSON.parse(text) } catch { data = { error: text.slice(0, 300) } }
  if (!res.ok) throw new Error(data.error || `send failed (${res.status})`)
  return { sent: true }
}

export async function GET(request) {
  // Accept either Vercel cron auth (production) OR admin auth (so admins
  // can manually drain the queue from the UI on preview deployments,
  // where Vercel cron does NOT run — preview deploys never fire cron
  // jobs, only production does).
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  const actualAuth = request.headers.get('authorization')
  const isCronCall = expectedAuth && actualAuth === expectedAuth
  if (!isCronCall) {
    try { await requireAdminOrSocialMedia() } catch (e) { return e }
  }

  // Fetch oldest queued posts. Order by Scheduled Date ASC so reels go
  // out in calendar order — important when an account has Apr 27, 28, 29
  // queued and you don't want them landing 28, 27, 29.
  const queued = await fetchAirtableRecords('Posts', {
    filterByFormula: `{Status}='Queued for Telegram'`,
    fields: ['Scheduled Date'],
    sort: [{ field: 'Scheduled Date', direction: 'asc' }],
    maxRecords: POSTS_PER_TICK,
  })

  if (!queued.length) {
    return NextResponse.json({ ok: true, processed: 0, message: 'queue empty' })
  }

  const results = []
  for (let i = 0; i < queued.length; i++) {
    const post = queued[i]
    try {
      const r = await processOnePost(post.id)
      results.push({ postId: post.id, ...r })
      // Mark Sent only on actual success — processOnePost throws on failure.
      // The send route itself already patches Status='Sent to Telegram' on
      // success and stamps Telegram Sent At, so we don't double-write here.
    } catch (err) {
      results.push({ postId: post.id, error: err.message })
      // Mark Send Failed so the queue moves on instead of re-trying this
      // post forever. Operator can manually flip back to Queued to retry.
      try {
        await patchAirtableRecord('Posts', post.id, {
          'Status': 'Send Failed',
        }, { typecast: true })
      } catch (e) {
        console.warn('[telegram-queue] failed to mark Send Failed:', e.message)
      }
    }
    // Pacing between sends within a single cron tick. The send route's
    // own 6s spacing rule still applies if anything else is concurrently
    // firing — combined cap is enforced by Telegram (20 msg/min).
    if (i < queued.length - 1) {
      await new Promise(r => setTimeout(r, GAP_BETWEEN_POSTS_MS))
    }
  }

  return NextResponse.json({ ok: true, processed: queued.length, results })
}
