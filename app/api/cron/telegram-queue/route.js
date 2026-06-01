export const dynamic = 'force-dynamic'
// One post per tick. Each post can take up to ~280s when an asset hasn't
// been pre-compressed yet (download 15s + ffmpeg 200s + upload 10s + buffer).
// 2-per-tick blew past 300s and the cron itself timed out, which the client
// drain loop saw as a 504 / FUNCTION_INVOCATION_TIMEOUT. Better slow + works
// than fast + jammed: drain loop calls /api/cron/telegram-queue every minute
// from prod cron, plus the client drain loop also calls it during a Send
// All. Throughput = 60/hour worst case (uncompressed assets) but climbs to
// dozens/min once the precompress cron has caught up — at that point each
// send is just ~10s of "download small file → upload to Telegram".
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { fetchAirtableRecords, patchAirtableRecord, requireAdminOrSocialMedia } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'

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

const POSTS_PER_TICK = 1
const GAP_BETWEEN_POSTS_MS = 6000

// Look up a Post + its linked Creator/Account/Asset, then fire the existing
// /api/telegram/send pipeline. We call the route internally rather than
// importing its logic so each send runs in its OWN Vercel function with
// its own 300s budget — heavy compress on one post can't kill the cron.
async function processOnePost(postId) {
  // Need Creator (for telegramThreadId + per-channel topic IDs),
  // Asset (for editedFileLink), Channel (IG/FB — drives topic routing).
  // The legacy Account-based topic routing (one CPD record per
  // Instagram account, each with its own Telegram Topic ID) was
  // retired 2026-05 — posts now route to Telegram IG Topic ID or
  // Telegram FB Topic ID on the Palm Creator record based on
  // Post.Channel. Fetch fresh so any caption/hashtag edits made in
  // Post Prep land in this send.
  const postList = await fetchAirtableRecords('Posts', {
    filterByFormula: `RECORD_ID() = ${quoteAirtableString(postId)}`,
    fields: [
      'Post Name', 'Status', 'Type', 'Caption', 'Hashtags', 'Platform', 'Channel',
      'Thumbnail', 'Thumbnail Asset', 'Scheduled Date', 'Creator', 'Asset',
    ],
  })
  const post = postList[0]
  if (!post) throw new Error('Post not found')
  const f = post.fields || {}

  // Status guard — if a human flipped it back to Prepping mid-cron, skip.
  if (f.Status !== 'Queued for Telegram') {
    return { skipped: true, reason: `status=${f.Status}` }
  }

  // CRITICAL: claim the post by flipping Status to 'Sending' BEFORE we kick
  // off the actual Telegram upload. The cron's filterByFormula only picks
  // posts in 'Queued for Telegram' — once we're 'Sending', the next minute's
  // tick won't re-pick this same post.
  //
  // Fixes the duplicate-send bug: when the function 504s mid-upload (slow
  // compression, large file, network), Telegram has already received the
  // message but our 'Sent to Telegram' PATCH never landed. Without this
  // lock, the post stays 'Queued' → re-picked → duplicate in Telegram.
  // With this lock, the post stays stuck at 'Sending' (manual reset if
  // needed) — one stuck post is way better than infinite duplicates.
  // typecast:true creates the 'Sending' Status option if missing.
  try {
    await patchAirtableRecord('Posts', postId, {
      'Status': 'Sending',
      // Stamp the lock time so stale-lock recovery can find this post if
      // the send hangs / times out. Was relying on {Last Modified} which
      // never existed on this table — recovery silently no-op'd for weeks
      // and stuck posts piled up forever.
      'Sending Since': new Date().toISOString(),
    }, { typecast: true })
  } catch (lockErr) {
    // If we can't even claim the lock (Airtable rate limit / 429), don't
    // proceed — leaving status at 'Queued' means a future tick can retry,
    // and we haven't sent a duplicate.
    throw new Error(`Failed to claim send lock: ${lockErr.message}`)
  }

  const creatorId = (f.Creator || [])[0]
  const linkedAssetIds = f.Asset || []
  const assetId = linkedAssetIds[0]
  const channel = f.Channel  // 'IG' or 'FB' (singleSelect value)
  const postType = (typeof f.Type === 'string' ? f.Type : f.Type?.name) || 'Reel'
  const isCarousel = postType === 'Carousel'
  if (!linkedAssetIds.length) throw new Error('Post has no Asset link')
  if (!creatorId) throw new Error('Post has no Creator link')
  if (!channel) throw new Error('Post has no Channel set (expected IG or FB) — cannot resolve Telegram topic')

  // Carousel posts link N photo Assets; reels link one video Asset. Pull all
  // linked records in a single roundtrip and key the downstream branch on
  // postType so we send the right kind to Telegram.
  const assetFilter = `OR(${linkedAssetIds.map(id => `RECORD_ID() = ${quoteAirtableString(id)}`).join(',')})`
  const [creatorList, assetList] = await Promise.all([
    fetchAirtableRecords('Palm Creators', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(creatorId)}`,
      fields: ['Creator', 'AKA', 'Telegram Thread ID', 'Telegram IG Topic ID', 'Telegram FB Topic ID'],
    }),
    fetchAirtableRecords('Assets', {
      filterByFormula: assetFilter,
      fields: ['Asset Name', 'Asset Type', 'Edited File Link', 'Dropbox Shared Link', 'CDN URL', 'Stream Edit ID', 'Stream Raw ID', 'Compressed File Link', 'Compress Status'],
    }),
  ])

  const creator = creatorList[0]?.fields || {}
  const assetById = Object.fromEntries(assetList.map(a => [a.id, a.fields || {}]))
  const asset = assetById[assetId] || {}

  // Resolve the per-channel Telegram topic for this creator.
  // Channel='IG' → Telegram IG Topic ID, Channel='FB' → Telegram FB Topic ID.
  // Both live on Palm Creators (Ops base). If the topic ID is missing, fail
  // loud — we'd otherwise post into the group's General topic by accident.
  const channelTopicField = channel === 'IG' ? 'Telegram IG Topic ID' : 'Telegram FB Topic ID'
  const smmTopicId = creator[channelTopicField]
  if (!smmTopicId) {
    throw new Error(`Creator missing ${channelTopicField} for Channel=${channel} — set it on Palm Creators record`)
  }

  // For reels: prefer the pre-compressed file (compress-pending-assets cron),
  // fall back to raw Edited File Link, then Dropbox Shared Link. The send
  // route handles ffmpeg inline as a last resort but that's the slow path.
  // For carousels: build an ordered photos[] of {cdnUrl, dropboxLink, name}
  // — send route uses sendMediaGroup with all N photos.
  let editedFileLink = ''
  let photos = []
  if (isCarousel) {
    photos = linkedAssetIds
      .map(aid => {
        const a = assetById[aid]
        if (!a) return null
        return {
          id: aid,
          cdnUrl: a['CDN URL'] || '',
          dropboxLink: a['Dropbox Shared Link'] || '',
          name: a['Asset Name'] || '',
        }
      })
      .filter(p => p && (p.cdnUrl || p.dropboxLink))
    if (!photos.length) throw new Error('Carousel has no photos with a CDN URL or Dropbox link')
  } else {
    const compressedLink = asset['Compressed File Link']
    editedFileLink = compressedLink || asset['Edited File Link'] || asset['Dropbox Shared Link']
    if (!editedFileLink) throw new Error('Asset has no file link')
  }

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
      type: postType,
      // Reel fields — empty for carousels but harmless to include.
      assetId,
      editedFileLink,
      thumbnailUrl,
      // Exact source Asset of a pool-applied thumbnail (if any). Send
      // route uses this to deterministically flip Approved Thumbnail /
      // Used As Reel Thumbnail on the right asset post-send.
      thumbnailAssetId: f['Thumbnail Asset'] || null,
      // Carousel fields — ordered photos array (empty for reels).
      photos: isCarousel ? photos : undefined,
      caption: f.Caption || '',
      hashtags: f.Hashtags || '',
      platform: f.Platform || ['Instagram Reel'],
      scheduledDate: f['Scheduled Date'] || null,
      creatorId,
      threadId: creator['Telegram Thread ID'] || null,
      smmTopicId,
      wait: true,
    }),
  })
  const text = await res.text()
  let data = {}
  let parsedJson = false
  try { data = JSON.parse(text); parsedJson = true } catch { data = { error: text.slice(0, 300) } }
  if (!res.ok) {
    const e = new Error(data.error || `send failed (${res.status})`)
    // DEFINITIVE = the send route returned a JSON {error} body, i.e. a real
    // Telegram/app rejection (file too large, bad topic, etc.) → safe to mark
    // Send Failed. NON-DEFINITIVE = a non-JSON body (Vercel HTML error page /
    // FUNCTION_INVOCATION_TIMEOUT / "An error occurred with your deployment"):
    // the send route runs in its OWN 800s function and very likely kept going
    // and DELIVERED after our 300s call to it timed out. Those must NOT be
    // hard-failed — that's the "says FAILED but actually sent" bug.
    e.definitive = parsedJson && !!data.error
    e.httpStatus = res.status
    throw e
  }
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

  // STALE LOCK RECOVERY: any post stuck at Status='Sending' for >10 min
  // is a real crash mid-upload (Vercel function killed, network drop, etc).
  // Reset it to 'Queued for Telegram' so the next tick can retry.
  // 10 minutes is plenty — even our worst sends finish in <5 min including
  // ffmpeg compression, so anything older means the function genuinely died.
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  // Use {Sending Since} — stamped by the lock above. The old code used
  // {Last Modified}, a field that never existed on Posts, so this query
  // 422'd every tick, the .catch swallowed it, and NOTHING was ever
  // recovered. Stuck posts piled up for weeks. Also catch posts that
  // were stuck BEFORE this field existed: {Sending Since}=BLANK means
  // an old stuck lock with no timestamp — recover those too.
  const stuck = await fetchAirtableRecords('Posts', {
    filterByFormula: `AND({Status}='Sending', OR({Sending Since}=BLANK(), IS_BEFORE({Sending Since}, '${tenMinAgo}')))`,
    fields: ['Status'],
    maxRecords: 10,
  }).catch(err => {
    console.warn('[telegram-queue] stale-lock query failed:', err.message)
    return []
  })
  for (const s of stuck) {
    try {
      await patchAirtableRecord('Posts', s.id, {
        'Status': 'Queued for Telegram',
        'Sending Since': null,
      })
      console.log(`[telegram-queue] stale-lock reset on ${s.id}`)
    } catch (e) {
      console.warn(`[telegram-queue] failed to reset stuck ${s.id}:`, e.message)
    }
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
      const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z'

      // VERIFY BEFORE FAILING. The send route runs in its own 800s function and
      // may have delivered + stamped 'Sent to Telegram' even though our wait=true
      // call to it timed out at the cron's 300s budget. Re-fetch ground truth
      // before declaring failure — this is the direct fix for the dozens of
      // "Send Failed" rows that are actually Status='Sent to Telegram'.
      let alreadySent = false
      try {
        const check = await fetchAirtableRecords('Posts', {
          filterByFormula: `RECORD_ID() = ${quoteAirtableString(post.id)}`,
          fields: ['Status', 'Telegram Message ID'],
        })
        const cf = check[0]?.fields || {}
        const st = typeof cf.Status === 'string' ? cf.Status : (cf.Status?.name || '')
        alreadySent = st === 'Sent to Telegram' && !!cf['Telegram Message ID']
      } catch (checkErr) {
        console.warn('[telegram-queue] post-error status check failed:', checkErr.message)
      }

      if (alreadySent) {
        // False alarm — it landed. Don't overwrite a successful send.
        console.log(`[telegram-queue] ${post.id} reported "${err.message}" but is already Sent — treating as delivered (false timeout).`)
        results[results.length - 1] = { postId: post.id, sent: true, recovered: true }
        if (i < queued.length - 1) await new Promise(r => setTimeout(r, GAP_BETWEEN_POSTS_MS))
        continue
      }

      try {
        if (err.definitive) {
          // Real Telegram/app rejection — mark Send Failed so the operator acts.
          await patchAirtableRecord('Posts', post.id, {
            'Status': 'Send Failed',
            'Send Error': `[${stamp}] ${err.message}`,
          }, { typecast: true })
        } else {
          // Infrastructure timeout, NOT confirmed delivered. Leave the post at
          // 'Sending' (don't show a false FAILED). The stale-lock sweeper resets
          // it to 'Queued for Telegram' after 10 min so it retries on its own —
          // by which time any still-running send function will have stamped Sent
          // (caught by the alreadySent check above) and we won't double-send.
          await patchAirtableRecord('Posts', post.id, {
            'Send Error': `[${stamp}] transient (left for auto-retry): ${err.message}`,
          })
          console.log(`[telegram-queue] ${post.id} transient error — left at 'Sending' for stale-lock retry, not failed.`)
        }
      } catch (e) {
        console.warn('[telegram-queue] failed to record send outcome:', e.message)
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
