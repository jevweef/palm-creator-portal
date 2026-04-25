export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { NextResponse } from 'next/server'
import { requireAdmin, requireAdminOrSocialMedia, fetchAirtableRecords, patchAirtableRecord, createAirtableRecord } from '@/lib/adminAuth'

// Standard posting slots: 11 AM and 7 PM Eastern, matching the editor's
// auto-schedule in /api/admin/editor. Grid Planner uses these to pick the
// next open slot on an account when an instance gets dragged onto the grid.
const SLOT_HOURS_ET = [11, 19]

function etToUTC(etDateStr, etHour) {
  const [year, month, day] = etDateStr.split('-').map(Number)
  const noonUTC = new Date(Date.UTC(year, month - 1, day, 12))
  const etHourAtNoon = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }).format(noonUTC)
  )
  const offset = 12 - etHourAtNoon
  return new Date(Date.UTC(year, month - 1, day, etHour + offset))
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

    // Pull asset thumbnails (fallback when Post doesn't have its own thumb yet)
    const assetIds = [...new Set(posts.flatMap(p => p.fields?.Asset || []).filter(Boolean))]
    const assetMap = {}
    if (assetIds.length) {
      const assets = await fetchAirtableRecords('Assets', {
        filterByFormula: `OR(${assetIds.map(id => `RECORD_ID()='${id}'`).join(',')})`,
        fields: ['Asset Name', 'Thumbnail', 'Edited File Link', 'Dropbox Shared Link'],
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
      const thumb = (f.Thumbnail?.[0]?.thumbnails?.large?.url) || (f.Thumbnail?.[0]?.url) ||
        (asset.Thumbnail?.[0]?.thumbnails?.large?.url) || (asset.Thumbnail?.[0]?.url) || ''
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
        // Asset details needed when sending to Telegram from the grid
        asset: assetId ? {
          id: assetId,
          editedFileLink: asset['Edited File Link'] || '',
        } : null,
        // Thumbnail URL from the Post's attachment (not the .thumbnails.large
        // preview) — Telegram send expects the full Dropbox/Airtable URL
        thumbnailUrl: f.Thumbnail?.[0]?.url || '',
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
      await patchAirtableRecord('Posts', postId, { 'Status': status })
      return NextResponse.json({ ok: true })
    }

    // assignInstance: the "3-badge drag" action.
    // Body shape: { action: 'assignInstance', taskId, accountId, unassignedPostIds: [...] }
    //   - If unassignedPostIds has entries: re-use the first one, set Account + next-open-slot
    //   - If all task instances already placed but user wants another: clone from a sibling
    // Returns: { ok: true, postId: <assigned or created> }
    if (action === 'assignInstance') {
      const { taskId, accountId, unassignedPostIds = [] } = body
      if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 })

      // Compute next open slot on this account
      const accountPostsRes = await fetchAirtableRecords('Posts', {
        filterByFormula: `FIND('${accountId}', ARRAYJOIN({Account}))`,
        fields: ['Account', 'Scheduled Date'],
      })
      const existingSlotISOs = accountPostsRes
        .filter(p => (p.fields?.Account || []).includes(accountId))
        .map(p => p.fields?.['Scheduled Date'])
        .filter(Boolean)
      const nextSlot = getNextOpenSlot(existingSlotISOs)

      // Case 1: reuse an unassigned instance in this task group
      if (unassignedPostIds.length) {
        const reuseId = unassignedPostIds[0]
        await patchAirtableRecord('Posts', reuseId, {
          'Account': [accountId],
          'Scheduled Date': nextSlot.toISOString(),
        })
        return NextResponse.json({ ok: true, postId: reuseId, scheduledDate: nextSlot.toISOString(), reused: true })
      }

      // Case 2: all instances already placed — clone from a sibling in the same task group
      if (!taskId) return NextResponse.json({ error: 'taskId required when no unassigned instances' }, { status: 400 })
      const siblings = await fetchAirtableRecords('Posts', {
        filterByFormula: `FIND('${taskId}', ARRAYJOIN({Task}))`,
        fields: ['Post Name', 'Creator', 'Asset', 'Task', 'Platform', 'Caption', 'Hashtags', 'Thumbnail'],
      })
      const seed = siblings.find(s => (s.fields?.Task || []).includes(taskId))
      if (!seed) return NextResponse.json({ error: 'No sibling post found for task' }, { status: 404 })
      const src = seed.fields || {}
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
        ...(src.Thumbnail?.length ? { 'Thumbnail': src.Thumbnail.map(a => ({ url: a.url })) } : {}),
        'Scheduled Date': nextSlot.toISOString(),
      }
      const created = await createAirtableRecord('Posts', fields)
      return NextResponse.json({ ok: true, postId: created.id, scheduledDate: nextSlot.toISOString(), cloned: true })
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

    // 2. Clone the post for each remaining account with staggered times
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
        ...(src.Thumbnail?.length ? { 'Thumbnail': src.Thumbnail.map(a => ({ url: a.url })) } : {}),
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
