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
  const slots = getQueueSlots(queue.length)
  const patches = []
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i]
    const desired = slots[i]
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
//   - No params: returns list of creators who have managed IG accounts
//   - ?creatorId=rec...: returns that creator's accounts + all their posts grouped by account
//
// Grid planner shows 1 creator at a time. Each creator has up to 4 IG accounts
// (Main + Palm IG 1/2/3). Posts with no Account field set show in an "Unassigned"
// bucket so the admin can drag them into an account grid.
export async function GET(request) {
  try { await requireAdminOrSocialMedia() } catch (e) { return e }

  try {
    const { searchParams } = new URL(request.url)
    const creatorId = searchParams.get('creatorId')

    // Fetch ALL managed creators (anyone with at least one active IG account in CPD)
    const allAccounts = await fetchAirtableRecords('Creator Platform Directory', {
      filterByFormula: `AND({Platform}='Instagram',{Managed by Palm}=1,{Status}!='Does Not Exist')`,
      fields: ['Account Name', 'Creator', 'Platform', 'Status', 'Handle/ Username', 'Handle Override', 'URL', 'Follower Count', 'Account Type', 'Telegram Topic ID'],
    })

    // Extract unique creator IDs + fetch their names
    const creatorIds = [...new Set(allAccounts.flatMap(a => a.fields?.Creator || []).filter(Boolean))]
    if (!creatorIds.length) {
      return NextResponse.json({ creators: [], selectedCreator: null, accounts: [], posts: [] })
    }

    // Only include creators we're actively doing social media + editing for.
    // Filter: Social Media Editing = 1 on Palm Creators. Any creator without
    // that flag (e.g. onboarding-only, churned, or DNA-only clients) is excluded
    // from the Grid Planner dropdown even if they still have IG accounts in CPD.
    const creatorRecs = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `AND(OR(${creatorIds.map(id => `RECORD_ID()='${id}'`).join(',')}), {Social Media Editing}=1)`,
      fields: ['Creator', 'AKA', 'Telegram Thread ID'],
    })
    const creatorMap = Object.fromEntries(creatorRecs.map(r => [r.id, r.fields?.AKA || r.fields?.Creator || '(unnamed)']))
    const creatorThreadMap = Object.fromEntries(creatorRecs.map(r => [r.id, r.fields?.['Telegram Thread ID'] || null]))

    // Count IG accounts per creator to flag which ones are actually editable
    const accountsPerCreator = {}
    for (const acc of allAccounts) {
      for (const cid of acc.fields?.Creator || []) {
        if (!accountsPerCreator[cid]) accountsPerCreator[cid] = 0
        accountsPerCreator[cid]++
      }
    }

    const creators = Object.entries(creatorMap)
      .map(([id, name]) => ({ id, name, accountCount: accountsPerCreator[id] || 0 }))
      .sort((a, b) => a.name.localeCompare(b.name))

    if (!creatorId) {
      return NextResponse.json({ creators })
    }

    // Fetch this creator's accounts + all their posts in parallel
    const creatorAccounts = allAccounts.filter(a => (a.fields?.Creator || []).includes(creatorId))

    // Fetch scraped feed data separately (bigger fields — multilineText JSON).
    // Small extra roundtrip is fine, keeps the main GET lean.
    const scrapedRecords = creatorAccounts.length
      ? await fetchAirtableRecords('Creator Platform Directory', {
          filterByFormula: `OR(${creatorAccounts.map(a => `RECORD_ID()='${a.id}'`).join(',')})`,
          fields: ['Scraped Feed', 'Scraped Feed Updated', 'Scraped Profile', 'Scraped Error'],
        })
      : []
    const scrapedMap = Object.fromEntries(scrapedRecords.map(r => {
      let feed = []
      let profile = null
      // Scraped Feed is authoritative for cached posts. Legacy: it used to
      // sometimes hold an error-shaped object — treat that as empty so we
      // don't leak old error data into the UI.
      try {
        const parsed = JSON.parse(r.fields?.['Scraped Feed'] || '[]')
        if (Array.isArray(parsed)) feed = parsed
      } catch {}
      try {
        const p = JSON.parse(r.fields?.['Scraped Profile'] || 'null')
        if (p && typeof p === 'object') profile = p
      } catch {}
      // Error is now a separate field — doesn't destroy cached posts.
      const scrapedError = (r.fields?.['Scraped Error'] || '').trim() || null
      return [r.id, { feed, updated: r.fields?.['Scraped Feed Updated'] || null, error: scrapedError, profile }]
    }))

    // Pull posts in window (last 60 days + future), filter to this creator in memory.
    // Can't filter by Creator record ID in Airtable formula — ARRAYJOIN returns
    // display names, not IDs. Fetch-then-filter is fine at this scale (tens of posts).
    const allRecentPosts = await fetchAirtableRecords('Posts', {
      filterByFormula: `IS_AFTER({Scheduled Date}, DATEADD(NOW(), -60, 'days'))`,
      fields: [
        'Post Name', 'Creator', 'Account', 'Asset', 'Task',
        'Status', 'Platform', 'Caption', 'Hashtags', 'Thumbnail',
        'Scheduled Date', 'Telegram Sent At', 'Posted At', 'Post Link',
        'SMM Scheduled', 'SMM Scheduled At',
      ],
    })
    const posts = allRecentPosts.filter(p => (p.fields?.Creator || []).includes(creatorId))

    // Queue normalization: for each managed account, sort unsent posts and
    // renumber their Scheduled Dates to the canonical "today AM, today PM,
    // tomorrow AM, ..." sequence. Yesterday's "today AM" becomes today's
    // "yesterday AM" and that post bumps to today AM automatically. Sent and
    // Live posts are immune.
    const normPatches = (await Promise.all(
      creatorAccounts.map(acc => normalizeAccountQueue(acc.id, posts))
    )).flat()
    if (normPatches.length) {
      await runThrottled(normPatches)
    }

    // Match scraped Live posts back to existing Sent Posts so the grid shows
    // ONE cell per reel instead of duplicates (Sent + scraped Live side-by-side
    // for the same content). Heuristic: per account, sort Sent-but-not-yet-live
    // Posts by Scheduled Date ASC and the scraped feed by Posted At ASC, match
    // oldest pairs. Only claim a scrape into a Post when the dates are within
    // 5 days of each other (avoids manually-posted IG content getting captured
    // into our pipeline records). Once Post Link is written, the existing
    // dedup at GridPlanner.PhoneFrame (`postLinks` Set) hides the scraped
    // duplicate. Idempotent — once matched, the Post has Post Link set, so
    // subsequent GETs skip it.
    const matchPatches = []
    // Map of post.id → live scrape (used as thumbnail fallback when the matched
    // Post's own Thumbnail attachment is missing/broken — without this, matched
    // LIVE cells render as blank black squares because dedup at the client
    // hides the scrape's rich thumbnail in favor of the now-matched Post.
    const scrapeFallback = {}
    // Also: any scrape whose URL appears on an already-matched Post (from a
    // prior run) — capture those too so old LIVE cells stay populated when the
    // scrape feed still has the data.
    for (const acc of creatorAccounts) {
      const feed = scrapedMap[acc.id]?.feed || []
      if (!feed.length) continue
      const feedByUrl = new Map(feed.map(s => [s.url, s]))
      for (const p of posts) {
        if (!(p.fields?.Account || []).includes(acc.id)) continue
        const link = p.fields?.['Post Link']
        if (link && feedByUrl.has(link)) {
          const s = feedByUrl.get(link)
          if (s.thumbnail) scrapeFallback[p.id] = s.thumbnail
        }
      }
      const unmatched = posts
        .filter(p =>
          (p.fields?.Account || []).includes(acc.id) &&
          p.fields?.['Telegram Sent At'] &&
          !p.fields?.['Post Link'] &&
          !p.fields?.['Posted At']
        )
        .sort((a, b) =>
          new Date(a.fields['Scheduled Date'] || 0) - new Date(b.fields['Scheduled Date'] || 0)
        )
      if (!unmatched.length) continue
      const scrapedAsc = [...feed]
        .filter(s => s.postedAt && s.url)
        .sort((a, b) => new Date(a.postedAt) - new Date(b.postedAt))
      const num = Math.min(unmatched.length, scrapedAsc.length)
      const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000
      for (let i = 0; i < num; i++) {
        const post = unmatched[i]
        const live = scrapedAsc[i]
        const drift = Math.abs(new Date(live.postedAt) - new Date(post.fields['Scheduled Date']))
        if (drift > FIVE_DAYS_MS) continue
        const postId = post.id
        const liveUrl = live.url
        const livePostedAt = live.postedAt
        matchPatches.push(() => patchAirtableRecord('Posts', postId, {
          'Post Link': liveUrl,
          'Posted At': livePostedAt,
        }))
        // Mutate in-place so this GET's response already reflects the match
        post.fields['Post Link'] = live.url
        post.fields['Posted At'] = live.postedAt
        if (live.thumbnail) scrapeFallback[post.id] = live.thumbnail
      }
    }
    if (matchPatches.length) {
      console.log(`[Grid Planner] Matched ${matchPatches.length} scraped post${matchPatches.length !== 1 ? 's' : ''} to existing Sent records`)
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

    // Normalize accounts
    const accounts = creatorAccounts.map(a => {
      const f = a.fields || {}
      const rawUrl = (f['URL'] || '').trim()
      // Handle Override wins if set (CPD's synced Handle/Username can be stale)
      const handle = ((f['Handle Override'] || '').trim() || (f['Handle/ Username'] || '').trim()).replace(/^@/, '')
      const scraped = scrapedMap[a.id] || { feed: [], updated: null }
      return {
        id: a.id,
        name: f['Account Name'] || '',
        handle,
        url: rawUrl.startsWith('http') ? rawUrl : (rawUrl ? `https://${rawUrl}` : (handle ? `https://instagram.com/${handle}` : '')),
        followers: f['Follower Count'] || null,
        accountType: f['Account Type'] || '',
        status: f['Status'] || '',
        scrapedFeed: scraped.feed,
        scrapedFeedUpdated: scraped.updated,
        scrapedError: scraped.error,
        scrapedProfile: scraped.profile,  // { followers, following, bio, fullName, profilePicUrl, isVerified, isPrivate, postCount }
        telegramTopicId: f['Telegram Topic ID'] || null,
      }
    }).sort((a, b) => {
      // Main first, then numbered Palm IGs in order
      const order = s => {
        if (s.accountType === 'Main') return 0
        const m = s.name.match(/Palm IG (\d+)/i)
        return m ? parseInt(m[1]) : 99
      }
      return order(a) - order(b)
    })

    // Normalize posts + bucket by account
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
      const thumb = cdnUrl ||
        (postImg?.thumbnails?.large?.url) || (postImg?.url) ||
        (assetImg?.thumbnails?.large?.url) || (assetImg?.url) ||
        // Last resort for matched LIVE cells: the IG scrape thumbnail. Without
        // this, posts whose Post.Thumbnail is missing/broken render as a blank
        // LIVE cell after the scrape→Sent dedup hides the scrape duplicate.
        scrapeFallback[p.id] || ''
      const hasBrokenThumb = !postImg && (f.Thumbnail || []).length > 0 && !scrapeFallback[p.id]
      const accountId = (f.Account || [])[0] || null
      return {
        id: p.id,
        name: f['Post Name'] || '',
        status: f.Status || '',
        accountId,
        taskId, // for grouping sibling instances in the Unassigned tray
        scheduledDate: f['Scheduled Date'] || null,
        telegramSentAt: f['Telegram Sent At'] || null,
        postedAt: f['Posted At'] || null,
        postLink: f['Post Link'] || '',
        thumbnail: thumb,
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

    // Build task instance groups: for each Task linked to at least one post,
    // count how many accounts still need this reel placed (N_accounts - already_placed).
    // This powers the Unassigned Tray's "3-2-1 badge" UX: one card per task group,
    // counter decrements as each instance gets dragged onto an account grid.
    const taskGroups = {}
    for (const p of normalized) {
      const key = p.taskId || `orphan-${p.id}` // orphan = post with no linked Task
      if (!taskGroups[key]) {
        taskGroups[key] = {
          taskId: p.taskId,
          samplePost: p, // use any post in group for caption/thumbnail preview
          allPosts: [],
          assignedAccountIds: new Set(),
          unassignedPostIds: [],
        }
      }
      taskGroups[key].allPosts.push(p)
      if (p.accountId) taskGroups[key].assignedAccountIds.add(p.accountId)
      else taskGroups[key].unassignedPostIds.push(p.id)
      // Prefer a post with a thumbnail as the sample
      if (p.thumbnail && !taskGroups[key].samplePost.thumbnail) taskGroups[key].samplePost = p
    }
    // Only show groups that (a) have at least one unplaced instance, AND
    // (b) are NOT already sent/posted everywhere (those graduate out of the tray)
    const accountIdsSet = new Set(accounts.map(a => a.id))
    const unassignedGroups = Object.values(taskGroups)
      .filter(g => {
        // Skip groups where every post is already sent or posted
        const allFinal = g.allPosts.every(p => p.telegramSentAt || p.postedAt || p.postLink)
        if (allFinal) return false
        // Remaining = accounts this reel still needs to hit
        const remaining = accounts.length - [...g.assignedAccountIds].filter(id => accountIdsSet.has(id)).length
        return remaining > 0
      })
      .map(g => ({
        taskId: g.taskId,
        samplePost: g.samplePost,
        remaining: accounts.length - [...g.assignedAccountIds].filter(id => accountIdsSet.has(id)).length,
        unassignedPostIds: g.unassignedPostIds,
        assignedAccountIds: [...g.assignedAccountIds].filter(id => accountIdsSet.has(id)),
      }))
      // Sort: needs-more-slots first, then by scheduled date
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

    if (action === 'assign') {
      const { postId, accountIds } = body
      if (!postId || !Array.isArray(accountIds)) {
        return NextResponse.json({ error: 'postId and accountIds[] required' }, { status: 400 })
      }
      await patchAirtableRecord('Posts', postId, { 'Account': accountIds })
      return NextResponse.json({ ok: true })
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
    // last) and assign each post the canonical slot date for its index.
    // Used by drag-drop within an account grid — client computes the new
    // queue order via insertion-shift, sends the full list, server writes.
    if (action === 'reorder') {
      const { accountId, postIds } = body
      if (!accountId || !Array.isArray(postIds) || !postIds.length) {
        return NextResponse.json({ error: 'accountId and postIds[] required' }, { status: 400 })
      }
      const slots = getQueueSlots(postIds.length)
      await Promise.all(postIds.map((pid, i) =>
        patchAirtableRecord('Posts', pid, { 'Scheduled Date': slots[i] })
      ))
      return NextResponse.json({ ok: true, slots })
    }

    // assignInstance: the "3-badge drag" action.
    // Body shape: { action: 'assignInstance', taskId, accountId, unassignedPostIds: [...] }
    //   - If unassignedPostIds has entries: re-use the first one, set Account + next-open-slot
    //   - If all task instances already placed but user wants another: clone from a sibling
    // Returns: { ok: true, postId: <assigned or created> }
    if (action === 'assignInstance') {
      const { taskId, accountId, unassignedPostIds = [] } = body
      if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 })

      // Append-to-end strategy. We don't try to fill gaps — normalize will
      // renumber every queue date to the canonical slot sequence after the
      // assign/clone, so the new post lands at slot N (queue length), and
      // any drift in existing dates gets cleaned up in the same call.
      const FAR_FUTURE = '2099-01-01T00:00:00.000Z'
      let assignedPostId = null

      if (unassignedPostIds.length) {
        // Case 1: reuse an unassigned instance in this task group
        const reuseId = unassignedPostIds[0]
        await patchAirtableRecord('Posts', reuseId, {
          'Account': [accountId],
          'Scheduled Date': FAR_FUTURE,
        })
        assignedPostId = reuseId
      } else {
        // Case 2: all instances already placed — clone from a sibling
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
          'Account': [accountId],
          'Status': 'Prepping',
          ...(src.Platform?.length ? { 'Platform': src.Platform } : {}),
          ...(src.Caption ? { 'Caption': src.Caption } : {}),
          ...(src.Hashtags ? { 'Hashtags': src.Hashtags } : {}),
          ...(thumbField ? { 'Thumbnail': thumbField } : {}),
          'Scheduled Date': FAR_FUTURE,
        }
        const created = await createAirtableRecord('Posts', fields)
        assignedPostId = created.id
      }

      // Re-fetch the account's posts now that we've appended one, then
      // normalize. This compacts the queue and gives the new post a real
      // slot date (slot N where N = queue length - 1).
      const accountPosts = await fetchAirtableRecords('Posts', {
        filterByFormula: `FIND('${accountId}', ARRAYJOIN({Account}))`,
        fields: ['Account', 'Scheduled Date', 'Telegram Sent At', 'Posted At'],
      })
      const patches = await normalizeAccountQueue(accountId, accountPosts)
      if (patches.length) await Promise.all(patches)

      const newPost = accountPosts.find(p => p.id === assignedPostId)
      const scheduledDate = newPost?.fields?.['Scheduled Date'] || null
      return NextResponse.json({
        ok: true,
        postId: assignedPostId,
        scheduledDate,
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

    // distributeQueue: for the given creator, place every queue item (each
    // unsent task group) onto every managed IG account it isn't already on.
    // Reuses unassigned-post instances first, clones siblings second. Each
    // landing gets the next open slot on the destination account.
    if (action === 'distributeQueue') {
      const { creatorId } = body
      if (!creatorId) return NextResponse.json({ error: 'creatorId required' }, { status: 400 })

      // Managed IG accounts for this creator
      const allAccounts = await fetchAirtableRecords('Creator Platform Directory', {
        filterByFormula: `AND({Platform}='Instagram',{Managed by Palm}=1,{Status}!='Does Not Exist')`,
        fields: ['Account Name', 'Creator'],
      })
      const managed = allAccounts.filter(a => (a.fields?.Creator || []).includes(creatorId))
      if (!managed.length) return NextResponse.json({ ok: true, distributed: 0, message: 'No managed accounts' })

      // All unsent posts for this creator
      const allRecent = await fetchAirtableRecords('Posts', {
        filterByFormula: `IS_AFTER({Scheduled Date}, DATEADD(NOW(), -60, 'days'))`,
        fields: ['Post Name', 'Creator', 'Account', 'Task', 'Asset', 'Platform', 'Caption', 'Hashtags', 'Thumbnail', 'Telegram Sent At', 'Posted At', 'Scheduled Date'],
      })
      const creatorPosts = allRecent.filter(p =>
        (p.fields?.Creator || []).includes(creatorId) &&
        !p.fields?.['Telegram Sent At'] &&
        !p.fields?.['Posted At']
      )

      // Group by Task ID
      const groups = {}
      for (const p of creatorPosts) {
        const taskId = (p.fields?.Task || [])[0] || `orphan-${p.id}`
        if (!groups[taskId]) groups[taskId] = { taskId, posts: [] }
        groups[taskId].posts.push(p)
      }

      // For each account, track existing slot ISOs so we can compute next-open per account.
      // We update in-memory as we add to avoid re-fetching after each add.
      const accountSlots = {}
      for (const acc of managed) {
        accountSlots[acc.id] = creatorPosts
          .filter(p => (p.fields?.Account || []).includes(acc.id))
          .map(p => p.fields?.['Scheduled Date'])
          .filter(Boolean)
      }

      let distributed = 0
      const updates = []

      for (const group of Object.values(groups)) {
        // Accounts already covered by this group
        const covered = new Set()
        for (const p of group.posts) {
          for (const accId of (p.fields?.Account || [])) covered.add(accId)
        }
        // Unassigned instances within this group (no Account set)
        const unassignedInGroup = group.posts.filter(p => !(p.fields?.Account || []).length)
        // Sample sibling for cloning
        const sibling = group.posts[0]
        const src = sibling?.fields || {}

        for (const acc of managed) {
          if (covered.has(acc.id)) continue
          const nextSlot = getNextOpenSlot(accountSlots[acc.id]).toISOString()

          if (unassignedInGroup.length) {
            // Reuse unassigned instance
            const reuse = unassignedInGroup.shift()
            await patchAirtableRecord('Posts', reuse.id, {
              'Account': [acc.id],
              'Scheduled Date': nextSlot,
            })
            updates.push({ postId: reuse.id, accountId: acc.id, scheduledDate: nextSlot, reused: true })
          } else {
            // Clone from sibling
            const thumbField = await buildClonedThumbnail((src.Asset || [])[0], src.Thumbnail)
            const fields = {
              'Post Name': src['Post Name'] || '',
              ...(src.Creator ? { 'Creator': src.Creator } : {}),
              ...(src.Asset ? { 'Asset': src.Asset } : {}),
              ...(group.taskId && !group.taskId.startsWith('orphan-') ? { 'Task': [group.taskId] } : {}),
              'Account': [acc.id],
              'Status': 'Prepping',
              ...(src.Platform?.length ? { 'Platform': src.Platform } : {}),
              ...(src.Caption ? { 'Caption': src.Caption } : {}),
              ...(src.Hashtags ? { 'Hashtags': src.Hashtags } : {}),
              ...(thumbField ? { 'Thumbnail': thumbField } : {}),
              'Scheduled Date': nextSlot,
            }
            const created = await createAirtableRecord('Posts', fields)
            updates.push({ postId: created.id, accountId: acc.id, scheduledDate: nextSlot, cloned: true })
          }

          accountSlots[acc.id].push(nextSlot)
          covered.add(acc.id)
          distributed++
        }
      }

      return NextResponse.json({ ok: true, distributed, accountCount: managed.length, updates })
    }

    if (action !== 'fanOut') {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }

    const { postId, accountIds } = body
    if (!postId || !Array.isArray(accountIds) || accountIds.length === 0) {
      return NextResponse.json({ error: 'postId and accountIds[] required' }, { status: 400 })
    }

    // Fetch the source post
    const sourceRecs = await fetchAirtableRecords('Posts', {
      filterByFormula: `RECORD_ID()='${postId}'`,
      fields: ['Post Name', 'Creator', 'Asset', 'Task', 'Status', 'Platform', 'Caption', 'Hashtags', 'Thumbnail', 'Scheduled Date'],
    })
    if (!sourceRecs.length) return NextResponse.json({ error: 'Source post not found' }, { status: 404 })
    const src = sourceRecs[0].fields || {}

    // Day-stagger: same time of day, +1 day for account 2, +2 days for account 3.
    // This keeps the feeds distinct across the three accounts — same reel, but
    // it hits each feed on a different day so the grids don't mirror each other.
    const baseDate = src['Scheduled Date'] ? new Date(src['Scheduled Date']) : new Date()
    const makeStaggered = (i) => {
      const d = new Date(baseDate)
      d.setDate(d.getDate() + i)
      return d.toISOString()
    }

    // 1. Assign the existing post to the FIRST account
    await patchAirtableRecord('Posts', postId, {
      'Account': [accountIds[0]],
      ...(src['Scheduled Date'] ? {} : { 'Scheduled Date': makeStaggered(0) }),
    })

    // 2. Clone the post for each remaining account with staggered times.
    // Pre-resolve the thumbnail field once so we don't re-fetch the Asset
    // record N times — bytes are stable, only the destination Account changes.
    const thumbField = await buildClonedThumbnail((src.Asset || [])[0], src.Thumbnail)
    const clones = []
    for (let i = 1; i < accountIds.length; i++) {
      const accId = accountIds[i]
      const fields = {
        'Post Name': src['Post Name'] || '',
        ...(src.Creator ? { 'Creator': src.Creator } : {}),
        ...(src.Asset ? { 'Asset': src.Asset } : {}),
        ...(src.Task ? { 'Task': src.Task } : {}),
        'Account': [accId],
        'Status': 'Prepping',
        ...(src.Platform?.length ? { 'Platform': src.Platform } : {}),
        ...(src.Caption ? { 'Caption': src.Caption } : {}),
        ...(src.Hashtags ? { 'Hashtags': src.Hashtags } : {}),
        ...(thumbField ? { 'Thumbnail': thumbField } : {}),
        'Scheduled Date': makeStaggered(i),
      }
      const created = await createAirtableRecord('Posts', fields)
      clones.push(created.id)
    }

    return NextResponse.json({ ok: true, assigned: postId, clones, accountCount: accountIds.length })
  } catch (err) {
    console.error('[Grid Planner] POST error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
