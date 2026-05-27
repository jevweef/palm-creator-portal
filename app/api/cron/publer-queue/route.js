export const dynamic = 'force-dynamic'
// Same 300s budget as telegram-queue — though Publer submissions are much
// cheaper than the Telegram ffmpeg+upload path, keeping a wide margin lets
// the worker handle slow Publer responses (URL-import pulls a 100MB+ reel
// from Cloudflare to Publer's S3 — can take 20-60s).
export const maxDuration = 300

import { NextResponse } from 'next/server'
import {
  requireAdmin,
  fetchAirtableRecords,
  patchAirtableRecord,
} from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'
import { importMediaFromUrl, schedulePosts } from '@/lib/publer'

// Phase 2: DRAFT ONLY. The worker submits posts to Publer with state='draft'
// so we can verify the round-trip (Publer dashboard shows the draft, our
// Airtable reflects status correctly) without anything actually posting to
// IG/FB. Phase 3 will flip to state='scheduled' + jitter + hashtag rotation.

const POSTS_PER_TICK = 1   // mirror telegram-queue conservatism for now
const GAP_BETWEEN_POSTS_MS = 6000

// 200MB Publer hard cap on URL-import. The scoping doc treats >200MB as an
// upstream bug; we fail loud with MEDIA_OVERSIZE rather than try to chunk.
const PUBLER_MEDIA_MAX_BYTES = 200 * 1024 * 1024

// Stale-lock recovery threshold. Same logic as telegram-queue: a post stuck
// in 'Publer Sending' for >10min means the function died mid-submit. Reset
// it to 'Queued for Publer' so the next tick can retry.
const STALE_LOCK_MS = 10 * 60 * 1000

// Best-effort: HEAD the media URL to validate size before handing it to Publer.
// Some CDNs (Cloudflare R2, Dropbox dl) return Content-Length on HEAD; others
// don't. If we can't determine size, we proceed — Publer will 413 us and the
// per-account-failure flow takes over.
async function validateMediaSize(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' })
    if (!res.ok) {
      // 405 means HEAD unsupported — not a fatal sign about the URL itself.
      // Let Publer attempt the GET.
      if (res.status === 405) return { ok: true, knownSize: null }
      return { ok: false, error: `HEAD ${res.status} on media URL` }
    }
    const len = parseInt(res.headers.get('content-length') || '0', 10)
    if (!len) return { ok: true, knownSize: null }
    if (len > PUBLER_MEDIA_MAX_BYTES) {
      return { ok: false, error: 'MEDIA_OVERSIZE', sizeBytes: len }
    }
    return { ok: true, knownSize: len }
  } catch (e) {
    return { ok: true, knownSize: null, warn: `HEAD failed: ${e.message}` }
  }
}

// Map our internal Post.Type to Publer's IG networks.instagram.type +
// optional details.type for stories/reels.
// Post.Type values seen in code: 'Reel', 'Carousel', 'Photo', 'Story'.
function mapPostTypeForPubler(type) {
  switch (type) {
    case 'Reel': return { type: 'video', details: { type: 'reel', feed: true } }
    case 'Story': return { type: 'video', details: { type: 'story' } }
    case 'Carousel': return { type: 'carousel' }
    case 'Photo': return { type: 'photo' }
    default: return { type: 'photo' }  // safe default for legacy posts
  }
}

// Build the Publer schedule envelope for ONE post.
// state='draft' is hardcoded — Phase 3 will parametrize.
function buildEnvelope({ caption, hashtags, mediaIds, mediaKind, channel, publerAccountId, postType }) {
  const typeSpec = mapPostTypeForPubler(postType)
  const networkBranch = {
    type: typeSpec.type,
    text: caption || '',
    media: mediaIds.map(id => ({ id, type: mediaKind })),
  }
  if (typeSpec.details) networkBranch.details = typeSpec.details

  // First-comment for IG is the canonical hashtag-stuffing pattern. Skip
  // for FB — not idiomatic there.
  const firstComment = (hashtags || '').trim()
  const accountEntry = { id: publerAccountId }
  if (channel === 'IG' && firstComment) {
    accountEntry.comments = [firstComment]
  }

  const networks = {}
  if (channel === 'IG') networks.instagram = networkBranch
  else if (channel === 'FB') networks.facebook = networkBranch

  return {
    bulk: {
      state: 'draft',
      posts: [
        {
          networks,
          accounts: [accountEntry],
        },
      ],
    },
  }
}

async function processOnePost(postId) {
  // Fetch the Post + Creator (needed only for asset thumb fallback chain;
  // routing is by Creator+Channel via Publer Accounts) + Asset.
  const postList = await fetchAirtableRecords('Posts', {
    filterByFormula: `RECORD_ID() = ${quoteAirtableString(postId)}`,
    fields: [
      'Post Name', 'Status', 'Type', 'Caption', 'Hashtags', 'Channel',
      'Creator', 'Asset', 'Thumbnail', 'Publer Status',
    ],
  })
  const post = postList[0]
  if (!post) throw new Error('Post not found')
  const f = post.fields || {}

  // Status guard — if a human flipped it back to Prepping mid-cron, skip.
  if (f.Status !== 'Queued for Publer') {
    return { skipped: true, reason: `status=${f.Status}` }
  }

  const channel = typeof f.Channel === 'string' ? f.Channel : f.Channel?.name
  const creatorId = (f.Creator || [])[0]
  const postType = (typeof f.Type === 'string' ? f.Type : f.Type?.name) || 'Reel'
  const linkedAssetIds = f.Asset || []
  if (!channel) throw new Error('Post has no Channel set')
  if (!creatorId) throw new Error('Post has no Creator link')
  if (!linkedAssetIds.length) throw new Error('Post has no Asset link')

  // Lookup Publer Account ID by Creator+Channel+Active+AI.
  // (Same query the enqueue route runs; we duplicate here because the post
  //  could have been hand-routed to Publer via Airtable without going
  //  through enqueue — defense in depth.)
  const publerAccounts = await fetchAirtableRecords('Publer Accounts', {
    filterByFormula: `AND({Status}='Active', {Account Type}='AI')`,
    fields: ['Publer Account ID', 'Channel', 'Creator', 'Account Type'],
  })
  const acct = publerAccounts.find(a => {
    const af = a.fields || {}
    return (af.Creator || []).includes(creatorId)
      && af.Channel === channel
  })
  if (!acct) throw new Error(`No Active+AI Publer account for Creator+Channel=${channel}`)
  const publerAccountId = acct.fields['Publer Account ID']
  if (!publerAccountId) throw new Error('Mapped Publer Accounts row has empty Publer Account ID')

  // CRITICAL: claim the post BEFORE network I/O. Same pattern as
  // telegram-queue — without this, a 504 mid-submit could leave the post
  // 'Queued for Publer' and the next tick re-picks it → duplicate draft.
  try {
    await patchAirtableRecord('Posts', postId, {
      'Publer Status': 'Submitting',
      'Publer Sending Since': new Date().toISOString(),
    }, { typecast: true })
  } catch (lockErr) {
    throw new Error(`Failed to claim Publer send lock: ${lockErr.message}`)
  }

  // Resolve media. Carousel: every linked Asset's CDN URL. Reel/Photo/Story:
  // the first Asset's CDN URL or Edited File Link.
  const assetFilter = `OR(${linkedAssetIds.map(id => `RECORD_ID() = ${quoteAirtableString(id)}`).join(',')})`
  const assetList = await fetchAirtableRecords('Assets', {
    filterByFormula: assetFilter,
    fields: ['Asset Name', 'Asset Type', 'CDN URL', 'Edited File Link', 'Dropbox Shared Link', 'Compressed File Link'],
  })
  const assetById = Object.fromEntries(assetList.map(a => [a.id, a.fields || {}]))

  // Build an ordered media URL list. Prefer CDN URL (Cloudflare Images,
  // stable) over Edited File Link (Dropbox, can expire/refresh).
  const mediaSources = linkedAssetIds.map(aid => {
    const a = assetById[aid] || {}
    const url = a['CDN URL'] || a['Compressed File Link'] || a['Edited File Link'] || a['Dropbox Shared Link'] || ''
    return { aid, url, name: a['Asset Name'] || aid }
  }).filter(m => m.url)

  if (!mediaSources.length) {
    throw new Error('Post Assets have no usable media URL (CDN URL or Dropbox link)')
  }

  // Pre-validate every media URL's size to fail fast on MEDIA_OVERSIZE before
  // burning a Publer API call.
  for (const m of mediaSources) {
    const v = await validateMediaSize(m.url)
    if (!v.ok) throw new Error(`MEDIA_OVERSIZE: ${m.name} — ${v.error || ''}`)
  }

  // URL-import each media to Publer. Returns a Publer media_id per asset.
  // Carousel sends N media; reel sends 1. We submit one media import at a
  // time (Publer's /media/from-url accepts a batch but we serialize for
  // simpler error attribution).
  const importedMediaIds = []
  for (const m of mediaSources) {
    const res = await importMediaFromUrl({ url: m.url, name: m.name })
    // Publer's import response shape varies: single object vs array vs
    // wrapped { data: [...] }. Pull the first id we can find.
    const importedId =
      res?.id ||
      res?.data?.[0]?.id ||
      res?.media?.[0]?.id ||
      (Array.isArray(res) ? res[0]?.id : null)
    if (!importedId) {
      throw new Error(`Publer media import returned no id for ${m.name}: ${JSON.stringify(res).slice(0, 200)}`)
    }
    importedMediaIds.push(importedId)
  }

  // Stash the comma-joined media IDs on the Post for debugging. Single ID for
  // reels/photos/stories; multiple for carousels.
  await patchAirtableRecord('Posts', postId, {
    'Publer Media ID': importedMediaIds.join(','),
  }, { typecast: true }).catch(e => console.warn('[publer-queue] failed to stamp Publer Media ID:', e.message))

  // Determine the Publer media `type` field. Carousels and reels treat their
  // media as either 'image' or 'video' regardless; map from Asset Type if we
  // have it, otherwise infer from the Post.Type.
  const sampleAsset = assetById[linkedAssetIds[0]] || {}
  const sampleAssetType = sampleAsset['Asset Type'] || ''
  const mediaKind = postType === 'Carousel' || postType === 'Photo' ? 'image'
    : postType === 'Reel' || postType === 'Story' ? 'video'
    : (sampleAssetType.toLowerCase().includes('video') ? 'video' : 'image')

  // Build envelope + submit.
  const envelope = buildEnvelope({
    caption: f.Caption || '',
    hashtags: f.Hashtags || '',
    mediaIds: importedMediaIds,
    mediaKind,
    channel,
    publerAccountId,
    postType,
  })
  const submitRes = await schedulePosts(envelope)
  const jobId = submitRes?.job_id || submitRes?.data?.job_id || submitRes?.id
  if (!jobId) {
    throw new Error(`Publer schedule returned no job_id: ${JSON.stringify(submitRes).slice(0, 200)}`)
  }

  // Mark as Submitted with the job ID. Polling cron will flip to Scheduled
  // (or Failed) once Publer reports back.
  await patchAirtableRecord('Posts', postId, {
    'Publer Job ID': jobId,
    'Publer Status': 'Submitted',
    'Publer Last Error': '',
  }, { typecast: true })

  return { submitted: true, jobId }
}

export async function GET(request) {
  // Same auth pattern as telegram-queue: Vercel cron via Bearer CRON_SECRET,
  // OR admin in browser (so we can drain manually on preview deploys where
  // Vercel cron doesn't run).
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  const actualAuth = request.headers.get('authorization')
  const isCronCall = expectedAuth && actualAuth === expectedAuth
  if (!isCronCall) {
    try { await requireAdmin() } catch (e) { return e }
  }

  // Stale-lock recovery: any post stuck at Publer Status='Submitting' for
  // >10min means the function died mid-submit. Reset to 'Queued for Publer'
  // so it retries.
  const staleCutoff = new Date(Date.now() - STALE_LOCK_MS).toISOString()
  const stuck = await fetchAirtableRecords('Posts', {
    filterByFormula: `AND({Publer Status}='Submitting', OR({Publer Sending Since}=BLANK(), IS_BEFORE({Publer Sending Since}, '${staleCutoff}')))`,
    fields: ['Publer Status'],
    maxRecords: 10,
  }).catch(err => {
    console.warn('[publer-queue] stale-lock query failed:', err.message)
    return []
  })
  for (const s of stuck) {
    try {
      await patchAirtableRecord('Posts', s.id, {
        'Status': 'Queued for Publer',
        'Publer Status': 'Pending',
        'Publer Sending Since': null,
      }, { typecast: true })
      console.log(`[publer-queue] stale-lock reset on ${s.id}`)
    } catch (e) {
      console.warn(`[publer-queue] failed to reset stuck ${s.id}:`, e.message)
    }
  }

  // Fetch oldest queued posts. Same FIFO-by-Scheduled-Date ordering as
  // telegram-queue (Scheduled Date is an opaque ordering token here).
  const queued = await fetchAirtableRecords('Posts', {
    filterByFormula: `{Status}='Queued for Publer'`,
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
    } catch (err) {
      results.push({ postId: post.id, error: err.message })
      const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z'
      try {
        await patchAirtableRecord('Posts', post.id, {
          'Publer Status': 'Failed',
          'Publer Last Error': `[${stamp}] ${err.message}`.slice(0, 1000),
          // Drop back out of 'Queued for Publer' so we don't re-pick on the
          // next tick. Operator can manually re-enqueue after fixing.
          'Status': 'Publer Send Failed',
        }, { typecast: true })
      } catch (e) {
        console.warn('[publer-queue] failed to mark Failed:', e.message)
      }
    }
    if (i < queued.length - 1) {
      await new Promise(r => setTimeout(r, GAP_BETWEEN_POSTS_MS))
    }
  }

  return NextResponse.json({ ok: true, processed: queued.length, results })
}
