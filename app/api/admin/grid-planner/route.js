export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { NextResponse } from 'next/server'
import { requireAdmin, requireAdminOrSocialMedia, fetchAirtableRecords, patchAirtableRecord, createAirtableRecord } from '@/lib/adminAuth'

// Standard posting slots: 11 AM and 7 PM Eastern, matching the editor's
// auto-schedule in /api/admin/editor. Grid Planner uses these to pick the
// next open slot on an account when an instance gets dragged onto the grid.
const SLOT_HOURS_ET = [11, 19]

// Run an array of thunks at most N at a time with a small delay between
// batches. Airtable's REST API enforces 5 req/sec per base — bursting past
// that returns 429 RATE_LIMIT_REACHED and the user sees a red error banner.
// Used for normalization + scrape-match PATCHes which can fire 10–30 writes
// on a single grid GET when the queue rebalances.
async function runThrottled(thunks, batchSize = 4, gapMs = 1100) {
  const results = []
  for (let i = 0; i < thunks.length; i += batchSize) {
    const batch = thunks.slice(i, i + batchSize)
    results.push(...(await Promise.all(batch.map(t => t()))))
    if (i + batchSize < thunks.length) {
      await new Promise(r => setTimeout(r, gapMs))
    }
  }
  return results
}

// Build the Thumbnail field value for a cloned Post. Prefers Asset.Thumbnail
// (the original upload — bytes are stable, attachment isn't constantly
// re-cloned) over the source Post's Thumbnail (which is itself a clone whose
// signed URL can rotate or hit a flaky CDN node mid-fetch, producing broken
// bytes). Always passes filename:'thumbnail.jpg' so Airtable stores the
// attachment with a known content type — without an extension some browsers
// mis-handle the served bytes and the cell renders broken.
async function buildClonedThumbnail(assetId, srcThumbnail) {
  if (assetId) {
    try {
      const assetRecs = await fetchAirtableRecords('Assets', {
        filterByFormula: `RECORD_ID()='${assetId}'`,
        fields: ['Thumbnail'],
      })
      const assetThumb = assetRecs[0]?.fields?.Thumbnail
      if (assetThumb?.length) {
        return assetThumb.map(a => ({ url: a.url, filename: 'thumbnail.jpg' }))
      }
    } catch {}
  }
  if (srcThumbnail?.length) {
    return srcThumbnail.map(a => ({ url: a.url, filename: 'thumbnail.jpg' }))
  }
  return null
}

function etToUTC(etDateStr, etHour) {
  const [year, month, day] = etDateStr.split('-').map(Number)
  const noonUTC = new Date(Date.UTC(year, month - 1, day, 12))
  const etHourAtNoon = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }).format(noonUTC)
  )
  const offset = 12 - etHourAtNoon
  return new Date(Date.UTC(year, month - 1, day, etHour + offset))
}

// Build N consecutive slot ISOs starting from today AM going forward.
// Slot i = today AM, today PM, tomorrow AM, tomorrow PM, ...
// Used by the queue normalizer on GET to keep unsent post dates reactive
// to "today" — slot 0 is always today AM, slot 1 today PM, etc.
// Normalize a single account's queue: take all unsent posts on the account,
// sort by current Scheduled Date asc, rewrite each one's date to the canonical
// slot sequence (today AM, today PM, tomorrow AM, ...). Returns the list of
// PATCH promises (caller awaits). Cheap-diff first — only patches actual
// drifts. Posts with .fields mutated in place so callers can read the new
// dates without re-fetching.
async function normalizeAccountQueue(accountId, allPostsForCreator) {
  // Slots already occupied by Sent / Posted siblings on this account.
  // Queue items must NOT be assigned to these dates — that's how queue
  // items ended up sharing 5/2, 4/30, etc. with already-Scheduled cells
  // and stacking 4 reels on the same calendar slot.
  const occupied = new Set()
  for (const p of allPostsForCreator) {
    if (!(p.fields?.Account || []).includes(accountId)) continue
    if (!p.fields?.['Telegram Sent At'] && !p.fields?.['Posted At']) continue
    const sd = p.fields?.['Scheduled Date']
    if (sd) occupied.add(new Date(sd).toISOString())
  }

  const queue = allPostsForCreator
    .filter(p =>
      (p.fields?.Account || []).includes(accountId) &&
      !p.fields?.['Telegram Sent At'] &&
      !p.fields?.['Posted At']
    )
    .sort((a, b) =>
      new Date(a.fields?.['Scheduled Date'] || 0) - new Date(b.fields?.['Scheduled Date'] || 0)
    )
  if (!queue.length) return []

  // Generate enough candidate slots to fit ALL queue items even if many
  // collide with occupied dates. queue.length + occupied.size is a safe
  // upper bound — even if every occupied slot collides with a queue
  // candidate, we still have enough to skip them and assign cleanly.
  const candidates = getQueueSlots(queue.length + occupied.size)
  const freeSlots = candidates.filter(s => !occupied.has(s))

  const patches = []
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i]
    const desired = freeSlots[i]
    if (!desired) continue // shouldn't happen given the upper bound
    if (p.fields?.['Scheduled Date'] !== desired) {
      // Return as a thunk so the caller can throttle batches under
      // Airtable's 5 req/sec limit. Calling patchAirtableRecord eagerly
      // here fires the request immediately and bursts past the cap.
      const postId = p.id
      patches.push(() => patchAirtableRecord('Posts', postId, { 'Scheduled Date': desired }))
      p.fields['Scheduled Date'] = desired
    }
  }
  return patches
}

function getQueueSlots(count) {
  if (count <= 0) return []
  const now = new Date()
  const todayET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now)
  const [sy, sm, sd] = todayET.split('-').map(Number)
  const out = []
  for (let i = 0; i < count; i++) {
    const dayOffset = Math.floor(i / SLOT_HOURS_ET.length)
    const hourIdx = i % SLOT_HOURS_ET.length
    // Use noon UTC, not midnight UTC, when constructing the iterator. UTC
    // midnight on "today's ET date" formats back to *yesterday's* date in
    // ET because EDT/EST is 4-5 hours behind UTC. Noon UTC is safely
    // inside the same ET calendar date, so the format() round-trip is stable.
    const iter = new Date(Date.UTC(sy, sm - 1, sd + dayOffset, 12))
    const etDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(iter)
    out.push(etToUTC(etDateStr, SLOT_HOURS_ET[hourIdx]).toISOString())
  }
  return out
}

// Given the ISO timestamps of posts already scheduled on an account, find the
// first free slot (starting today, 2 slots/day) going forward.
function getNextOpenSlot(existingISOs) {
  const existingSet = new Set((existingISOs || []).map(s => new Date(s).toISOString()))
  const now = new Date()
  const todayET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now)
  const [sy, sm, sd] = todayET.split('-').map(Number)

  for (let dayOffset = 0; dayOffset <= 90; dayOffset++) {
    const iter = new Date(Date.UTC(sy, sm - 1, sd + dayOffset))
    const etDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(iter)
    for (const etHour of SLOT_HOURS_ET) {
      const candidate = etToUTC(etDateStr, etHour)
      // Never pick a past slot (except today's afternoon slot when it's still morning)
      if (candidate < now && dayOffset > 0) continue
      if (candidate < now) continue
      if (!existingSet.has(candidate.toISOString())) return candidate
    }
  }
  return new Date() // fallback: now
}

// GET /api/admin/grid-planner
//   - No params: returns list of creators who do Social Media Editing
//   - ?creatorId=rec...: returns that creator's 2 channel frames (IG, FB) + posts
//
// 2026-05 rewrite (post-calendar, channel-routed):
// - Creator dropdown sources from Palm Creators with Social Media Editing=1
//   (no longer CPD-derived — CPD is being phased out of this surface).
// - Each creator gets exactly 2 synthetic "accounts": IG and FB. They share
//   the same shape as legacy CPD account objects so the frontend doesn't
//   need to know about the model change.
// - Posts route to a frame by their Channel field (IG or FB). Posts with no
//   Channel set are unassigned and show in the queue tray.
// - Scheduled Date is now an opaque ordering token (cron-side FIFO), not a
//   calendar time. UI shouldn't render it as a date anymore.
export async function GET(request) {
  try { await requireAdminOrSocialMedia() } catch (e) { return e }

  try {
    const { searchParams } = new URL(request.url)
    const creatorId = searchParams.get('creatorId')

    // Creator dropdown: every active Palm Creator with Social Media Editing
    // checked, regardless of whether they still have legacy IG CPD accounts.
    // Topic IDs (per-channel) live on this record now.
    const creatorRecs = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `AND({Social Media Editing}=1, {Status}='Active')`,
      fields: [
        'Creator', 'AKA', 'Telegram Thread ID',
        'Telegram IG Topic ID', 'Telegram FB Topic ID',
      ],
    })
    const creatorMap = Object.fromEntries(creatorRecs.map(r => [r.id, r.fields?.AKA || r.fields?.Creator || '(unnamed)']))
    const creatorThreadMap = Object.fromEntries(creatorRecs.map(r => [r.id, r.fields?.['Telegram Thread ID'] || null]))
    const creatorById = Object.fromEntries(creatorRecs.map(r => [r.id, r.fields || {}]))

    // accountCount = 2 always (IG + FB) for any creator with Social Media
    // Editing on. Keeping the field for frontend back-compat — it used to
    // flag creators with zero managed IG accounts; that case is gone.
    const creators = Object.entries(creatorMap)
      .map(([id, name]) => ({ id, name, accountCount: 2 }))
      .sort((a, b) => a.name.localeCompare(b.name))

    if (!creatorId) {
      return NextResponse.json({ creators })
    }

    const cf = creatorById[creatorId] || {}
    const igTopicId = cf['Telegram IG Topic ID'] || null
    const fbTopicId = cf['Telegram FB Topic ID'] || null
    const creatorAka = creatorMap[creatorId] || ''

    // Best-effort: pull scraped IG feed data from the creator's legacy CPD
    // record(s) so the IG phone frame still shows their real Instagram grid.
    // If they have multiple CPD records (old fanout era), pick the one with
    // the freshest Scraped Feed Updated. FB has no scrape source — empty.
    const cpdRecs = await fetchAirtableRecords('Creator Platform Directory', {
      filterByFormula: `AND({Platform}='Instagram', {Managed by Palm}=1, {Status}!='Does Not Exist')`,
      fields: [
        'Account Name', 'Creator', 'Handle/ Username', 'Handle Override',
        'URL', 'Follower Count',
        'Scraped Feed', 'Scraped Feed Updated', 'Scraped Profile', 'Scraped Error',
      ],
    })
    const creatorCpdRecs = cpdRecs.filter(r => (r.fields?.Creator || []).includes(creatorId))
    let scrapedFeed = []
    let scrapedFeedUpdated = null
    let scrapedProfile = null
    let scrapedError = null
    let igHandle = ''
    let igFollowers = null
    let igUrl = ''
    // Sort newest scrape first
    creatorCpdRecs.sort((a, b) => {
      const ua = new Date(a.fields?.['Scraped Feed Updated'] || 0).getTime()
      const ub = new Date(b.fields?.['Scraped Feed Updated'] || 0).getTime()
      return ub - ua
    })
    for (const r of creatorCpdRecs) {
      const f = r.fields || {}
      // Use the first record as the canonical handle/follower source even if it has no scrape.
      if (!igHandle) {
        igHandle = ((f['Handle Override'] || '').trim() || (f['Handle/ Username'] || '').trim()).replace(/^@/, '')
        igFollowers = f['Follower Count'] || null
        const rawUrl = (f['URL'] || '').trim()
        igUrl = rawUrl.startsWith('http') ? rawUrl : (rawUrl ? `https://${rawUrl}` : (igHandle ? `https://instagram.com/${igHandle}` : ''))
      }
      // First record with an actual scrape wins for feed data.
      if (!scrapedFeedUpdated && f['Scraped Feed Updated']) {
        try {
          const parsed = JSON.parse(f['Scraped Feed'] || '[]')
          if (Array.isArray(parsed)) scrapedFeed = parsed
        } catch {}
        try {
          const p = JSON.parse(f['Scraped Profile'] || 'null')
          if (p && typeof p === 'object') scrapedProfile = p
        } catch {}
        scrapedFeedUpdated = f['Scraped Feed Updated']
        scrapedError = (f['Scraped Error'] || '').trim() || null
      }
    }

    // Pull posts in window (last 60 days + future), filter to this creator in memory.
    // Can't filter by Creator record ID in Airtable formula — ARRAYJOIN returns
    // display names, not IDs. Also include posts with no Scheduled Date so
    // newly-staged queue items (Channel not yet assigned, no date stamped)
    // still appear in the queue tray.
    const allRecentPosts = await fetchAirtableRecords('Posts', {
      filterByFormula: `OR(IS_AFTER({Scheduled Date}, DATEADD(NOW(), -60, 'days')), {Scheduled Date}=BLANK())`,
      fields: [
        'Post Name', 'Creator', 'Channel', 'Asset', 'Task',
        'Status', 'Platform', 'Caption', 'Hashtags', 'Thumbnail',
        'Scheduled Date', 'Telegram Sent At', 'Posted At', 'Post Link',
        'SMM Scheduled', 'SMM Scheduled At',
      ],
    })
    // Drop Prepping posts: those still belong to admin's Post Prep workflow,
    // not the Grid Planner queue. They show up here only after admin clicks
    // "Send to Grid" (which flips Status from Prepping → Staged). Also drop
    // Archived since those are off-pipeline.
    const statusName = (s) => typeof s === 'string' ? s : (s?.name || '')
    const HIDDEN = new Set(['Prepping', 'Archived'])
    const posts = allRecentPosts.filter(p => {
      if (!(p.fields?.Creator || []).includes(creatorId)) return false
      if (HIDDEN.has(statusName(p.fields?.Status))) return false
      return true
    })

    // Normalize Channel — singleSelect may come back as a string or {name:'IG'}.
    const channelOf = (p) => {
      const c = p.fields?.Channel
      return typeof c === 'string' ? c : (c?.name || null)
    }

    // Calendar/slot normalization (normalizeAccountQueue) and per-account
    // scrape-match-to-Sent dedupe are retired — slots are gone, accounts
    // are gone. Frontend renders posts in queue order (Scheduled Date as
    // an opaque ordering token) for the queue side; Sent posts render in
    // their post-time order.

    // Match scraped Live posts to existing Sent IG posts so the grid shows
    // ONE cell per reel instead of duplicates. New architecture: only the
    // IG synthetic frame has a scraped feed (FB has none), so we match
    // unmatched IG-Sent posts against the single scrapedFeed.
    const matchPatches = []
    const scrapeFallback = {}
    if (scrapedFeed.length) {
      const feedByUrl = new Map(scrapedFeed.map(s => [s.url, s]))
      for (const p of posts) {
        if (channelOf(p) !== 'IG') continue
        const link = p.fields?.['Post Link']
        if (link && feedByUrl.has(link)) {
          const s = feedByUrl.get(link)
          if (s.thumbnail) scrapeFallback[p.id] = s.thumbnail
        }
      }
      const unmatched = posts
        .filter(p =>
          channelOf(p) === 'IG' &&
          p.fields?.['Telegram Sent At'] &&
          !p.fields?.['Post Link'] &&
          !p.fields?.['Posted At']
        )
        .sort((a, b) => new Date(a.fields['Scheduled Date'] || 0) - new Date(b.fields['Scheduled Date'] || 0))
      const scrapedAsc = [...scrapedFeed]
        .filter(s => s.postedAt && s.url)
        .sort((a, b) => new Date(a.postedAt) - new Date(b.postedAt))
      const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000
      const num = Math.min(unmatched.length, scrapedAsc.length)
      for (let i = 0; i < num; i++) {
        const post = unmatched[i]
        const live = scrapedAsc[i]
        const drift = Math.abs(new Date(live.postedAt) - new Date(post.fields['Scheduled Date'] || 0))
        if (drift > FIVE_DAYS_MS) continue
        matchPatches.push(() => patchAirtableRecord('Posts', post.id, {
          'Post Link': live.url,
          'Posted At': live.postedAt,
        }))
        post.fields['Post Link'] = live.url
        post.fields['Posted At'] = live.postedAt
        if (live.thumbnail) scrapeFallback[post.id] = live.thumbnail
      }
    }
    if (matchPatches.length) {
      console.log(`[Grid Planner] Matched ${matchPatches.length} scraped IG post${matchPatches.length !== 1 ? 's' : ''} to Sent records`)
      await runThrottled(matchPatches)
    }

    // Pull asset thumbnails (fallback when Post doesn't have its own thumb yet)
    const assetIds = [...new Set(posts.flatMap(p => p.fields?.Asset || []).filter(Boolean))]
    const assetMap = {}
    if (assetIds.length) {
      const assets = await fetchAirtableRecords('Assets', {
        filterByFormula: `OR(${assetIds.map(id => `RECORD_ID()='${id}'`).join(',')})`,
        fields: ['Asset Name', 'Thumbnail', 'CDN URL', 'Edited File Link', 'Dropbox Shared Link', 'Stream Edit ID', 'Stream Raw ID'],
      })
      for (const a of assets) assetMap[a.id] = a.fields || {}
    }

    // Build the 2 synthetic "accounts" — one per channel. These have the
    // same shape as legacy CPD account objects so the frontend doesn't need
    // a model change. accountId pattern: `${creatorId}-IG` / `${creatorId}-FB`.
    const igAccountId = `${creatorId}-IG`
    const fbAccountId = `${creatorId}-FB`
    const accounts = [
      {
        id: igAccountId,
        channel: 'IG',
        name: `${creatorAka} Instagram`,
        handle: igHandle,
        url: igUrl,
        followers: igFollowers,
        accountType: 'Instagram',
        status: 'Active',
        scrapedFeed,
        scrapedFeedUpdated,
        scrapedError,
        scrapedProfile,
        telegramTopicId: igTopicId,
      },
      {
        id: fbAccountId,
        channel: 'FB',
        name: `${creatorAka} Facebook`,
        handle: igHandle ? `${igHandle} (FB)` : '',  // placeholder display
        url: '',
        followers: null,
        accountType: 'Facebook',
        status: 'Active',
        scrapedFeed: [],
        scrapedFeedUpdated: null,
        scrapedError: null,
        scrapedProfile: null,
        telegramTopicId: fbTopicId,
      },
    ]

    // Normalize posts + bucket by account
    // Build a sibling-thumbnail map BEFORE normalize. For each Task, collect
    // every sibling Post's Thumbnail URL. We use these as fallbacks across
    // siblings — when one Post's Thumbnail attachment got corrupted by the
    // clone-of-clone bug, the OTHER siblings' clones almost always render
    // fine. So if Palm IG 3's clone is broken bytes, falling back to Palm
    // IG 1's working clone fixes the blank cell instantly. Asset.Thumbnail
    // and cdnUrl are still in the chain for cases where ALL siblings broke.
    const pickImageEarly = (atts) => (atts || []).find(a =>
      a?.type?.startsWith('image/') ||
      (!a?.type && /\.(jpe?g|png|gif|webp)$/i.test(a?.filename || ''))
    )
    const siblingThumbsByTask = {}
    for (const p of posts) {
      const tid = (p.fields?.Task || [])[0]
      if (!tid) continue
      const img = pickImageEarly(p.fields?.Thumbnail)
      if (!img) continue
      const url = img.thumbnails?.large?.url || img.url
      if (!url) continue
      if (!siblingThumbsByTask[tid]) siblingThumbsByTask[tid] = []
      siblingThumbsByTask[tid].push({ postId: p.id, url })
    }

    const normalized = posts.map(p => {
      const f = p.fields || {}
      const assetId = (f.Asset || [])[0]
      const taskId = (f.Task || [])[0] || null
      const asset = assetId ? (assetMap[assetId] || {}) : {}
      // Pick the first attachment whose type is actually an image. Some Make.com
      // uploads land in Airtable with type=text/html (URL ingest returned HTML
      // instead of image bytes) — those serve broken icons in the browser. Skip
      // them and fall through to a valid one or to Asset.Thumbnail.
      // type=image/* is the happy path. But Airtable's URL-ingest is async:
      // immediately after PATCH the attachment exists but `type` is unset
      // until ingestion completes (often 5–30s). Fall back to filename
      // extension matching so freshly-replaced thumbnails render right
      // away instead of going blank during the ingest window.
      const pickImage = (atts) => (atts || []).find(a =>
        a?.type?.startsWith('image/') ||
        (!a?.type && /\.(jpe?g|png|gif|webp)$/i.test(a?.filename || ''))
      )
      const postImg = pickImage(f.Thumbnail)
      const assetImg = pickImage(asset.Thumbnail)
      // Prefer Cloudflare-mirrored asset photo (~50ms edge serve) over Airtable
      // attachment thumbnails, then fall back to whichever Airtable URL exists.
      // Only photos have CDN URLs — for video posts cdnUrl is null and the
      // Airtable-generated poster is used.
      const cdnUrl = asset['CDN URL'] || ''
      // Post.Thumbnail wins over cdnUrl. The CF mirror is keyed by Asset ID
      // and was uploaded ONCE when the asset was first created — it does
      // NOT auto-refresh when Asset.Thumbnail or Post.Thumbnail is replaced
      // via Replace Thumbnail. Preferring cdnUrl meant every thumbnail
      // replacement appeared to fail because Cloudflare kept serving the
      // original bytes. Use Post.Thumbnail (Airtable CDN, ~150ms) which
      // updates on every save, fall back to cdnUrl only for assets that
      // never had an explicit Thumbnail replacement.
      const primaryThumb =
        (postImg?.thumbnails?.large?.url) || (postImg?.url) ||
        (assetImg?.thumbnails?.large?.url) || (assetImg?.url) || ''
      // Fallback chain: if the primary thumbnail (Post.Thumbnail or
      // Asset.Thumbnail) fails to load in the browser — common for old
      // posts hit by the 2026-04 clone-of-clone broken-bytes bug —
      // CellThumb tries the cdnUrl next, then the scrape thumbnail.
      // Without this, my recent flip-cdn-to-last-resort change blanked
      // out a bunch of legacy SCHEDULED cells whose Post.Thumbnail
      // attachments had corrupt bytes but cdnUrl was still good.
      // Fallback chain order:
      //   1. Sibling Post.Thumbnails (other accounts' clones of the same
      //      reel) — the OTHER 2 siblings almost always have working clones
      //      when one breaks. This is the entire reason same-reel cells
      //      render fine on Palm IG 1+2 but blank on Palm IG 3.
      //   2. cdnUrl — Cloudflare mirror of the original asset photo
      //   3. scrapeFallback — IG scrape thumbnail for matched LIVE cells
      const siblingUrls = (taskId ? (siblingThumbsByTask[taskId] || []) : [])
        .filter(s => s.postId !== p.id) // don't include our own (already in primary)
        .map(s => s.url)
      const fallbackThumbs = [...siblingUrls, cdnUrl, scrapeFallback[p.id]].filter(Boolean)
      const thumb = primaryThumb || fallbackThumbs[0] || ''
      const hasBrokenThumb = !postImg && (f.Thumbnail || []).length > 0 && !cdnUrl && !scrapeFallback[p.id]
      // Map to one of the two synthetic accounts via Channel. Legacy
      // posts that still have a CPD Account link but no Channel show as
      // unassigned (accountId=null) and land in the queue tray — admin
      // can run distributeQueue to push them through.
      const ch = channelOf(p)
      const accountId = ch === 'IG' ? igAccountId : ch === 'FB' ? fbAccountId : null
      return {
        id: p.id,
        name: f['Post Name'] || '',
        status: statusName(f.Status),
        accountId,
        channel: ch,
        taskId, // for grouping sibling instances in the Unassigned tray
        scheduledDate: f['Scheduled Date'] || null,
        telegramSentAt: f['Telegram Sent At'] || null,
        postedAt: f['Posted At'] || null,
        postLink: f['Post Link'] || '',
        thumbnail: thumb,
        // List of alternate URLs to try if the primary thumbnail fails to
        // load. Client iterates through them on <img onError>. Covers the
        // legacy broken-bytes Post.Thumbnail case + scrape thumbnail.
        thumbnailFallbacks: fallbackThumbs,
        platform: f.Platform || [],
        caption: f.Caption || '',
        hashtags: f.Hashtags || '',
        // Asset details needed when sending to Telegram from the grid + the
        // CF Stream UIDs so the post detail modal can play from edge.
        asset: assetId ? {
          id: assetId,
          editedFileLink: asset['Edited File Link'] || '',
          streamEditId: asset['Stream Edit ID'] || null,
          streamRawId: asset['Stream Raw ID'] || null,
        } : null,
        // Thumbnail URL from the Post's attachment (not the .thumbnails.large
        // preview) — Telegram send expects the full Dropbox/Airtable URL.
        // Use the same image-only filter so a text/html attachment doesn't
        // flow through to Telegram and break sendMediaGroup.
        thumbnailUrl: postImg?.url || '',
        thumbnailBroken: hasBrokenThumb,
        smmScheduled: !!f['SMM Scheduled'],
        smmScheduledAt: f['SMM Scheduled At'] || null,
      }
    })

    // Build queue tray groups. Post-fanout world: each Task has ONE post,
    // so the "group" mostly exists for legacy posts that have multiple
    // unchanneled siblings still lingering. A group shows in the tray as
    // long as it has at least one Channel-less unsent post.
    //
    // `remaining` used to mean "N_accounts not yet placed" (3 → 2 → 1 → 0
    // as fanout filled). New meaning: count of unchanneled posts in this
    // group — usually 1, sometimes more for legacy cleanup. The frontend
    // only needs >0 to keep the tile in the tray.
    const taskGroups = {}
    for (const p of normalized) {
      const key = p.taskId || `orphan-${p.id}`
      if (!taskGroups[key]) {
        taskGroups[key] = {
          taskId: p.taskId,
          samplePost: p,
          allPosts: [],
          assignedAccountIds: new Set(),
          unassignedPostIds: [],
        }
      }
      taskGroups[key].allPosts.push(p)
      if (p.accountId) taskGroups[key].assignedAccountIds.add(p.accountId)
      else taskGroups[key].unassignedPostIds.push(p.id)
      if (p.thumbnail && !taskGroups[key].samplePost.thumbnail) taskGroups[key].samplePost = p
    }
    const unassignedGroups = Object.values(taskGroups)
      .filter(g => {
        const allFinal = g.allPosts.every(p => p.telegramSentAt || p.postedAt || p.postLink)
        if (allFinal) return false
        return g.unassignedPostIds.length > 0
      })
      .map(g => {
        // Override samplePost.thumbnail with Asset.Thumbnail when available.
        const assetId = g.samplePost.asset?.id
        const assetThumbObj = assetId ? assetMap[assetId] : null
        const pickImage = (atts) => (atts || []).find(a =>
          a?.type?.startsWith('image/') ||
          (!a?.type && /\.(jpe?g|png|gif|webp)$/i.test(a?.filename || ''))
        )
        const assetImg = assetThumbObj ? pickImage(assetThumbObj.Thumbnail) : null
        const assetCdn = assetThumbObj?.['CDN URL'] || ''
        const assetThumbUrl =
          assetImg?.thumbnails?.large?.url ||
          assetImg?.url ||
          assetCdn ||
          ''
        return {
          taskId: g.taskId,
          samplePost: assetThumbUrl
            ? { ...g.samplePost, thumbnail: assetThumbUrl }
            : g.samplePost,
          remaining: g.unassignedPostIds.length,
          unassignedPostIds: g.unassignedPostIds,
          assignedAccountIds: [...g.assignedAccountIds],
        }
      })
      .sort((a, b) => {
        if (b.remaining !== a.remaining) return b.remaining - a.remaining
        return new Date(a.samplePost.scheduledDate || 0) - new Date(b.samplePost.scheduledDate || 0)
      })

    return NextResponse.json({
      creators,
      selectedCreator: {
        id: creatorId,
        name: creatorMap[creatorId] || '',
        telegramThreadId: creatorThreadMap[creatorId] || null,
      },
      accounts,
      posts: normalized,
      unassignedGroups,
    })
  } catch (err) {
    console.error('[Grid Planner] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH /api/admin/grid-planner
//   body: { action: 'swap', postA: 'rec...', postB: 'rec...' }
//     → swaps the Scheduled Date between two posts
//
//   body: { action: 'assign', postId: 'rec...', accountIds: ['rec...'] }
//     → sets/replaces the Account field on one post
//
//   body: { action: 'setDate', postId: 'rec...', scheduledDate: 'ISO' }
//     → updates a single post's scheduled time directly
export async function PATCH(request) {
  try { await requireAdminOrSocialMedia() } catch (e) { return e }

  try {
    const body = await request.json()
    const { action } = body

    if (action === 'swap') {
      const { postA, postB } = body
      if (!postA || !postB) {
        return NextResponse.json({ error: 'postA and postB required' }, { status: 400 })
      }
      // Fetch both posts to get their current Scheduled Dates
      const posts = await fetchAirtableRecords('Posts', {
        filterByFormula: `OR(RECORD_ID()='${postA}', RECORD_ID()='${postB}')`,
        fields: ['Scheduled Date'],
      })
      const a = posts.find(p => p.id === postA)
      const b = posts.find(p => p.id === postB)
      if (!a || !b) return NextResponse.json({ error: 'One or both posts not found' }, { status: 404 })
      const dateA = a.fields?.['Scheduled Date'] || null
      const dateB = b.fields?.['Scheduled Date'] || null
      // Swap. Use null-safe patches — can't write undefined.
      await Promise.all([
        patchAirtableRecord('Posts', postA, { 'Scheduled Date': dateB }),
        patchAirtableRecord('Posts', postB, { 'Scheduled Date': dateA }),
      ])
      return NextResponse.json({ ok: true, swapped: { [postA]: dateB, [postB]: dateA } })
    }

    // assign: writes Channel (IG/FB) based on the synthetic account ID.
    // The frontend still calls this with `accountIds` for back-compat; in
    // the new model an accountId is `${creatorId}-IG` or `${creatorId}-FB`.
    // Passing an empty array clears the Channel (back to queue tray).
    if (action === 'assign') {
      const { postId, accountIds } = body
      if (!postId || !Array.isArray(accountIds)) {
        return NextResponse.json({ error: 'postId and accountIds[] required' }, { status: 400 })
      }
      const accountId = accountIds[0] || null
      let channel = null
      if (accountId) {
        if (accountId.endsWith('-IG')) channel = 'IG'
        else if (accountId.endsWith('-FB')) channel = 'FB'
        else return NextResponse.json({ error: `Unrecognized synthetic accountId: ${accountId}` }, { status: 400 })
      }
      // Stamp Scheduled Date as an ordering token so the new post lands at
      // the end of the channel's FIFO queue. Empty array → null Channel +
      // null Scheduled Date (back to tray).
      await patchAirtableRecord('Posts', postId, {
        'Channel': channel,
        'Scheduled Date': channel ? new Date().toISOString() : null,
      })
      return NextResponse.json({ ok: true, channel })
    }

    if (action === 'setDate') {
      const { postId, scheduledDate } = body
      if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })
      await patchAirtableRecord('Posts', postId, { 'Scheduled Date': scheduledDate || null })
      return NextResponse.json({ ok: true })
    }

    if (action === 'setStatus') {
      const { postId, status } = body
      if (!postId || !status) return NextResponse.json({ error: 'postId and status required' }, { status: 400 })
      // Fan out: a single Asset/Task fans out into N sibling Post records
      // (one per managed IG account). When the admin sends a post back to
      // Prepping (or any other status flip), all siblings should move
      // together — otherwise you end up with one Prepping + two Staged
      // copies of the same reel and the grid shows them as separate cards.
      let targetIds = [postId]
      try {
        const sourceList = await fetchAirtableRecords('Posts', {
          filterByFormula: `RECORD_ID()='${postId}'`,
          fields: ['Task'],
        })
        const taskId = (sourceList[0]?.fields?.Task || [])[0] || null
        if (taskId) {
          const siblings = await fetchAirtableRecords('Posts', {
            filterByFormula: `FIND('${taskId}', ARRAYJOIN({Task}))`,
            fields: ['Task', 'Telegram Sent At', 'Posted At'],
          })
          // Don't drag already-sent or already-live siblings backwards into
          // Prepping — once it's out, it's out. Only move pre-send siblings.
          const ids = siblings
            .filter(s => !s.fields?.['Telegram Sent At'] && !s.fields?.['Posted At'])
            .map(s => s.id)
            .filter(Boolean)
          if (ids.length) targetIds = Array.from(new Set([postId, ...ids]))
        }
      } catch (e) {
        console.warn('[setStatus] sibling lookup failed:', e.message)
      }
      await Promise.all(targetIds.map(id =>
        patchAirtableRecord('Posts', id, { 'Status': status })
      ))
      return NextResponse.json({ ok: true, updatedPostIds: targetIds })
    }

    // reorder: take an ordered list of post IDs (oldest at index 0, newest
    // last) and re-stamp Scheduled Date so they sort in that exact order
    // for the cron's FIFO drain. New model: Scheduled Date is an opaque
    // ordering token, not a slot date.
    if (action === 'reorder') {
      const { accountId, postIds } = body
      if (!accountId || !Array.isArray(postIds) || !postIds.length) {
        return NextResponse.json({ error: 'accountId and postIds[] required' }, { status: 400 })
      }
      const baseTs = Date.now()
      await Promise.all(postIds.map((pid, i) =>
        patchAirtableRecord('Posts', pid, {
          'Scheduled Date': new Date(baseTs + i * 1000).toISOString(),
        })
      ))
      return NextResponse.json({ ok: true })
    }

    // assignInstance: the queue-tray drag action.
    // Body: { action: 'assignInstance', taskId, accountId, unassignedPostIds: [...] }
    // New model: accountId is a synthetic `${creatorId}-IG/FB` — extract
    // channel, reuse the first unchanneled post (or clone from sibling if
    // somehow there are none), stamp Channel + ordering token.
    if (action === 'assignInstance') {
      const { taskId, accountId, unassignedPostIds = [] } = body
      if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 })
      let channel = null
      if (accountId.endsWith('-IG')) channel = 'IG'
      else if (accountId.endsWith('-FB')) channel = 'FB'
      else return NextResponse.json({ error: `Unrecognized synthetic accountId: ${accountId}` }, { status: 400 })

      const orderToken = new Date().toISOString()
      let assignedPostId = null

      if (unassignedPostIds.length) {
        // Reuse an unchanneled post in this task group
        const reuseId = unassignedPostIds[0]
        await patchAirtableRecord('Posts', reuseId, {
          'Channel': channel,
          'Scheduled Date': orderToken,
        })
        assignedPostId = reuseId
      } else {
        // No unchanneled posts left → clone from a sibling.
        // (Rare in the new world since fanout is dead, but keeps drag-drop
        // robust when an admin reassigns a sent reel back into the queue.)
        if (!taskId) return NextResponse.json({ error: 'taskId required when no unassigned instances' }, { status: 400 })
        const siblings = await fetchAirtableRecords('Posts', {
          filterByFormula: `FIND('${taskId}', ARRAYJOIN({Task}))`,
          fields: ['Post Name', 'Creator', 'Asset', 'Task', 'Platform', 'Caption', 'Hashtags', 'Thumbnail'],
        })
        const seed = siblings.find(s => (s.fields?.Task || []).includes(taskId))
        if (!seed) return NextResponse.json({ error: 'No sibling post found for task' }, { status: 404 })
        const src = seed.fields || {}
        const thumbField = await buildClonedThumbnail((src.Asset || [])[0], src.Thumbnail)
        const fields = {
          'Post Name': src['Post Name'] || '',
          ...(src.Creator ? { 'Creator': src.Creator } : {}),
          ...(src.Asset ? { 'Asset': src.Asset } : {}),
          'Task': [taskId],
          'Channel': channel,
          'Status': 'Staged',
          ...(src.Platform?.length ? { 'Platform': src.Platform } : {}),
          ...(src.Caption ? { 'Caption': src.Caption } : {}),
          ...(src.Hashtags ? { 'Hashtags': src.Hashtags } : {}),
          ...(thumbField ? { 'Thumbnail': thumbField } : {}),
          'Scheduled Date': orderToken,
        }
        const created = await createAirtableRecord('Posts', fields)
        assignedPostId = created.id
      }

      return NextResponse.json({
        ok: true,
        postId: assignedPostId,
        scheduledDate: orderToken,
        channel,
        ...(unassignedPostIds.length ? { reused: true } : { cloned: true }),
      })
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (err) {
    console.error('[Grid Planner] PATCH error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST /api/admin/grid-planner
//   body: { action: 'fanOut', postId: 'rec...', accountIds: ['recA', 'recB', 'recC'] }
//     → First account: assign the existing Post to it.
//     → Other accounts: clone the Post (same asset, caption, hashtags, platform, thumbnail)
//       and schedule each clone on a DIFFERENT DAY at the same time of day.
//
// Why day-staggering (not hour-staggering): every reel eventually posts to all
// three accounts, but the whole point of running three accounts is that the
// feeds don't look identical. So account 2 gets this reel one day after
// account 1, account 3 gets it two days after account 1. The admin can drag
// posts around in the grid to fine-tune, but the default gets you a
// not-identical-feed starting point for free.
export async function POST(request) {
  try { await requireAdminOrSocialMedia() } catch (e) { return e }

  try {
    const body = await request.json()
    const { action } = body

    // distributeQueue (2026-05 rewrite, post-calendar): assign every
    // unchanneled queue item for this creator to either IG or FB via
    // round-robin. ONE Post per source clip — no more fanout-cloning.
    //
    // No more calendar slots. SMM posts on their own cadence (~2x/day per
    // channel); we just hand them the next reel in order. To keep cron
    // ordering stable across a multi-post distribute, we still stamp
    // Scheduled Date as an opaque "queued at" timestamp — UI never shows
    // it as a date anymore, it's purely an ORDER token. Cron sorts by it
    // ASC, draining oldest first.
    //
    // Old behavior (retired May 2026):
    //  - Cloning one source Post per managed IG account (IG 1/2/3 fanout)
    //  - Stamping AM/PM slot grid times via getNextOpenSlot
    if (action === 'distributeQueue') {
      const { creatorId } = body
      if (!creatorId) return NextResponse.json({ error: 'creatorId required' }, { status: 400 })

      // Verify the creator has both topic IDs set — otherwise the send route
      // will error at Telegram time. Fail loud now instead of later.
      const creatorRecs = await fetchAirtableRecords('Palm Creators', {
        filterByFormula: `RECORD_ID()='${creatorId}'`,
        fields: ['Creator', 'AKA', 'Telegram IG Topic ID', 'Telegram FB Topic ID'],
      })
      if (!creatorRecs.length) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
      const cf = creatorRecs[0].fields || {}
      if (!cf['Telegram IG Topic ID'] || !cf['Telegram FB Topic ID']) {
        return NextResponse.json({
          error: `Creator missing Telegram IG Topic ID or Telegram FB Topic ID — set both on Palm Creators before distributing`,
        }, { status: 400 })
      }

      // All unsent posts for this creator. We need existing-channeled
      // posts to count current IG vs FB balance for round-robin seeding.
      const allRecent = await fetchAirtableRecords('Posts', {
        filterByFormula: `OR(IS_AFTER({Scheduled Date}, DATEADD(NOW(), -60, 'days')), {Scheduled Date}=BLANK())`,
        fields: ['Post Name', 'Creator', 'Channel', 'Asset', 'Telegram Sent At', 'Posted At', 'Scheduled Date'],
      })
      const creatorPosts = allRecent.filter(p =>
        (p.fields?.Creator || []).includes(creatorId) &&
        !p.fields?.['Telegram Sent At'] &&
        !p.fields?.['Posted At']
      )

      // Normalize Channel — Airtable can return it as a string or {name: '...'}
      // depending on read path.
      const channelOf = (p) => {
        const c = p.fields?.Channel
        return typeof c === 'string' ? c : (c?.name || null)
      }

      const queueItems = creatorPosts.filter(p => !channelOf(p))
      if (!queueItems.length) {
        return NextResponse.json({ ok: true, distributed: 0, message: 'Queue empty' })
      }

      // Count existing channel balance so a creator with 5 IG / 2 FB gets
      // the next 3 queue items pushed to FB first.
      const countByChannel = { IG: 0, FB: 0 }
      for (const p of creatorPosts) {
        const ch = channelOf(p)
        if (ch === 'IG' || ch === 'FB') countByChannel[ch]++
      }

      let distributed = 0
      const updates = []
      // Stamp ordering tokens spaced 1 second apart from a single baseline.
      // Within a single distributeQueue call this gives stable cron order.
      // Across calls, fresh `now()` ensures later batches sort after earlier ones.
      const baseTs = Date.now()

      for (let i = 0; i < queueItems.length; i++) {
        const p = queueItems[i]
        // Pick the channel with fewer current posts. Tie → IG.
        const ch = countByChannel.IG <= countByChannel.FB ? 'IG' : 'FB'
        const orderToken = new Date(baseTs + i * 1000).toISOString()

        await patchAirtableRecord('Posts', p.id, {
          'Channel': ch,
          'Scheduled Date': orderToken,
        })

        countByChannel[ch]++
        distributed++
        updates.push({ postId: p.id, channel: ch, orderToken })
      }

      return NextResponse.json({
        ok: true,
        distributed,
        finalBalance: { IG: countByChannel.IG, FB: countByChannel.FB },
        updates,
      })
    }

    // fanOut: retired May 2026. The whole point was fan-out cloning to
    // multiple IG accounts (IG 1/2/3) — that model is gone. UI should
    // call `assign` with a single synthetic accountId instead.
    if (action === 'fanOut') {
      return NextResponse.json({
        error: 'fanOut is retired — use action=assign with a single synthetic accountId (`${creatorId}-IG` or `-FB`), or distributeQueue to bulk-assign the entire queue.',
      }, { status: 410 })
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (err) {
    console.error('[Grid Planner] POST error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
