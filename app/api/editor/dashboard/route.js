export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdminOrEditor, fetchAirtableRecords } from '@/lib/adminAuth'

function recordIdFormula(ids) {
  if (!ids.length) return 'FALSE()'
  return `OR(${ids.map(id => `RECORD_ID()='${id}'`).join(',')})`
}

// Convert a UTC ISO string to its Eastern Time calendar date (YYYY-MM-DD)
function toETDateStr(isoStr) {
  if (!isoStr) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
  }).format(new Date(isoStr))
}

async function fetchByIds(table, ids, params) {
  if (!ids.length) return []
  const CHUNK = 20
  const chunks = []
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK))
  const results = await Promise.all(
    chunks.map(chunk => fetchAirtableRecords(table, { ...params, filterByFormula: recordIdFormula(chunk) }))
  )
  return results.flat()
}

export async function GET() {
  try { await requireAdminOrEditor() } catch (e) { return e }

  try {
    const creators = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: '{Social Media Editing}=1',
      fields: ['Creator', 'AKA', 'Weekly Reel Quota', 'Tasks', 'Profile Summary', 'Music DNA Processed'],
    })
    if (!creators.length) return NextResponse.json({ creators: [] })

    const allTaskIds = [...new Set(creators.flatMap(c => c.fields?.Tasks || []))]
    const creatorIdSet = new Set(creators.map(c => c.id))

    const estNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const pad = n => String(n).padStart(2, '0')
    const estDateStr = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
    const todayStr = estDateStr(estNow)
    const twoWeeksAgo = new Date(estNow); twoWeeksAgo.setDate(estNow.getDate() - 14)
    const twoWeeksAgoStr = estDateStr(twoWeeksAgo)
    const dayOfWeek = estNow.getDay()
    const sunday = new Date(estNow)
    sunday.setDate(estNow.getDate() - dayOfWeek)
    const weekStartStr = estDateStr(sunday)

    // Fetch only what's needed for the main dashboard view:
    // Tasks, inspo-linked creator clips, and recent posts (14 days back + future)
    // Library assets and tag weights are lazy-loaded by their respective modals
    const [tasks, inspoLinkedAssets, allPosts] = await Promise.all([
      fetchByIds('Tasks', allTaskIds, {
        fields: [
          'Name', 'Status', 'Creator', 'Asset', 'Inspiration',
          'Creator Notes', 'Editor Notes', 'Completed At',
          'Admin Review Status', 'Admin Feedback', 'Admin Screenshots',
        ],
      }),
      // Creator-uploaded clips tied to a specific inspo record (priority fills)
      fetchAirtableRecords('Assets', {
        filterByFormula: `AND({Pipeline Status}='Uploaded', NOT({Inspiration Source}=''))`,
        fields: [
          'Asset Name', 'Pipeline Status', 'Dropbox Shared Link', 'Dropbox Path (Current)',
          'Creator Notes', 'Thumbnail', 'CDN URL', 'Palm Creators', 'Upload Week', 'Inspiration Source',
        ],
      }).then(assets => assets.filter(a => {
        const creatorId = (a.fields?.['Palm Creators'] || [])[0]
        return creatorId && creatorIdSet.has(creatorId)
      })),
      // Posts from last 14 days + all future — drives buffer + calendar coloring + telegram sent
      // Thumbnail is the frame admins pick during post-prep; we surface it on
      // the slot card so done-but-not-yet-on-CF video tasks have something
      // visible to render.
      fetchAirtableRecords('Posts', {
        filterByFormula: `IS_AFTER({Scheduled Date}, DATEADD(TODAY(), -14, 'days'))`,
        fields: ['Creator', 'Scheduled Date', 'Task', 'Asset', 'Telegram Sent At', 'Thumbnail'],
      }),
    ])

    const activeTasks = tasks.filter(t => {
      const s = t.fields?.Status
      const rev = t.fields?.['Admin Review Status']
      if (s === 'To Do' || s === 'In Progress') return true
      if (s === 'Done') {
        const completedAt = t.fields?.['Completed At'] || ''
        return completedAt >= twoWeeksAgoStr
          || rev === 'Pending Review'
          || rev === 'Needs Revision'
      }
      return false
    })

    const taskAssetIds = [...new Set(activeTasks.flatMap(t => t.fields?.Asset || []))]
    const inspoIds = [...new Set(activeTasks.flatMap(t => t.fields?.Inspiration || []))]

    // Collect inspo IDs from inspo-linked creator assets too
    const inspoLinkedInspoIds = [...new Set(
      inspoLinkedAssets.flatMap(a => a.fields?.['Inspiration Source'] || [])
    )]
    const allInspoIds = [...new Set([...inspoIds, ...inspoLinkedInspoIds])]

    const [taskAssets, inspoRecords] = await Promise.all([
      fetchByIds('Assets', taskAssetIds, {
        fields: [
          'Asset Name', 'Pipeline Status', 'Source Type', 'Dropbox Shared Link',
          'Dropbox Path (Current)', 'Creator Notes', 'Thumbnail', 'CDN URL', 'Edited File Link',
        ],
      }),
      fetchByIds('Inspiration', allInspoIds, {
        fields: [
          'Title', 'Notes', 'Tags', 'Film Format', 'Content link',
          'Thumbnail', 'CDN URL', 'Username', 'DB Share Link', 'On-Screen Text',
        ],
      }),
    ])

    const assetMap = Object.fromEntries(taskAssets.map(r => [r.id, r.fields]))
    const inspoMap = Object.fromEntries(inspoRecords.map(r => [r.id, r.fields]))

    // Build taskId → telegramSentAt / scheduledDate / postThumbnail maps from posts.
    // postThumbnail = first valid Airtable image attachment URL (the frame
    // admin picked during prep). Skip text/html attachments — Make.com URL
    // ingests sometimes land as broken HTML pages instead of bytes.
    const taskTelegramMap = {}
    const taskScheduledDateMap = {}
    const taskPostThumbnailMap = {}
    for (const post of allPosts) {
      const sentAt = post.fields?.['Telegram Sent At']
      const scheduledDate = post.fields?.['Scheduled Date']
      const taskId = (post.fields?.Task || [])[0]
      if (!taskId) continue
      if (sentAt) taskTelegramMap[taskId] = sentAt
      if (scheduledDate) taskScheduledDateMap[taskId] = scheduledDate
      if (!taskPostThumbnailMap[taskId]) {
        const attachments = post.fields?.Thumbnail || []
        const validImg = attachments.find(a => a?.type?.startsWith('image/'))
        const url = validImg?.thumbnails?.large?.url || validImg?.url
        if (url) taskPostThumbnailMap[taskId] = url
      }
    }

    const tasksByCreator = {}
    for (const task of activeTasks) {
      const creatorId = (task.fields?.Creator || [])[0]
      if (!creatorId) continue
      if (!tasksByCreator[creatorId]) tasksByCreator[creatorId] = []

      const assetId = (task.fields?.Asset || [])[0]
      const inspoId = (task.fields?.Inspiration || [])[0]
      const asset = assetId ? (assetMap[assetId] || {}) : {}
      const inspo = inspoId ? (inspoMap[inspoId] || {}) : {}
      const screenshots = (task.fields?.['Admin Screenshots'] || [])
        .map(s => s.thumbnails?.large?.url || s.url)

      tasksByCreator[creatorId].push({
        id: task.id,
        name: task.fields?.Name || '',
        status: task.fields?.Status || '',
        isInspoUpload: !!(inspoId && asset['Source Type'] === 'Inspo Upload'),
        adminReviewStatus: task.fields?.['Admin Review Status'] || '',
        adminFeedback: task.fields?.['Admin Feedback'] || '',
        adminScreenshots: screenshots,
        creatorNotes: task.fields?.['Creator Notes'] || '',
        editorNotes: task.fields?.['Editor Notes'] || '',
        completedAt: task.fields?.['Completed At'] || null,
        etCompletedDate: toETDateStr(task.fields?.['Completed At'] || ''),
        // Editor dashboard is the editor's WORK DAY view — tasks pin to the
        // day the editor actually finished them, not the day the resulting
        // post is scheduled to go out. (Post scheduled date can drift to
        // future days via auto-schedule; that's the Grid Planner's concern,
        // not the editor's daily-slot view.) The redistribute pass below
        // handles overflow: if 4 tasks complete on Apr 23 but quota is 3,
        // the 4th rolls forward to Apr 24's first open slot.
        etSlotDate: toETDateStr(task.fields?.['Completed At'] || ''),
        telegramSentAt: taskTelegramMap[task.id] || null,
        postScheduledDate: taskScheduledDateMap[task.id] || null,
        postThumbnail: taskPostThumbnailMap[task.id] || null,
        asset: {
          id: assetId,
          name: asset['Asset Name'] || '',
          pipelineStatus: asset['Pipeline Status'] || '',
          dropboxLink: asset['Dropbox Shared Link'] || '',
          dropboxLinks: (asset['Dropbox Shared Link'] || '').split('\n').filter(Boolean),
          dropboxPath: asset['Dropbox Path (Current)'] || '',
          creatorNotes: asset['Creator Notes'] || '',
          thumbnail: asset.Thumbnail?.[0]?.thumbnails?.large?.url || asset.Thumbnail?.[0]?.url || '',
          cdnUrl: asset['CDN URL'] || null,
          editedFileLink: asset['Edited File Link'] || '',
        },
        inspo: {
          id: inspoId,
          title: inspo.Title || '',
          notes: inspo.Notes || '',
          tags: inspo.Tags || [],
          filmFormat: inspo['Film Format'] || [],
          contentLink: inspo['Content link'] || '',
          thumbnail: inspo.Thumbnail?.[0]?.thumbnails?.large?.url || inspo.Thumbnail?.[0]?.url || '',
          cdnUrl: inspo['CDN URL'] || null,
          username: inspo.Username || '',
          dbShareLink: inspo['DB Share Link'] || '',
          onScreenText: inspo['On-Screen Text'] || '',
        },
      })
    }

    // Group inspo-linked creator assets by creator
    // Exclude assets that already have editing tasks (prevents duplicate cards)
    const taskAssetIdSet = new Set(taskAssetIds)
    const inspoClipsByCreator = {}
    for (const asset of inspoLinkedAssets) {
      if (taskAssetIdSet.has(asset.id)) continue // already shown as a task card
      const creatorId = (asset.fields?.['Palm Creators'] || [])[0]
      if (!creatorId) continue
      if (!inspoClipsByCreator[creatorId]) inspoClipsByCreator[creatorId] = []
      const inspoId = (asset.fields?.['Inspiration Source'] || [])[0]
      const inspo = inspoId ? (inspoMap[inspoId] || {}) : {}
      inspoClipsByCreator[creatorId].push({
        id: asset.id,
        name: asset.fields?.['Asset Name'] || '',
        dropboxLink: asset.fields?.['Dropbox Shared Link'] || '',
        dropboxLinks: (asset.fields?.['Dropbox Shared Link'] || '').split('\n').filter(Boolean),
        dropboxPath: asset.fields?.['Dropbox Path (Current)'] || '',
        creatorNotes: asset.fields?.['Creator Notes'] || '',
        thumbnail: asset.fields?.Thumbnail?.[0]?.thumbnails?.large?.url || asset.fields?.Thumbnail?.[0]?.url || '',
        cdnUrl: asset.fields?.['CDN URL'] || null,
        uploadWeek: asset.fields?.['Upload Week'] || '',
        inspo: {
          id: inspoId,
          title: inspo.Title || '',
          thumbnail: inspo.Thumbnail?.[0]?.thumbnails?.large?.url || inspo.Thumbnail?.[0]?.url || '',
          cdnUrl: inspo['CDN URL'] || null,
          username: inspo.Username || '',
          tags: inspo.Tags || [],
          notes: inspo.Notes || '',
          contentLink: inspo['Content link'] || '',
          onScreenText: inspo['On-Screen Text'] || '',
        },
      })
    }

    // Group posts by creator: total future count + per-date breakdown
    // Use ET date for all grouping so evening posts (23:00 UTC = 7 PM ET) land on the correct day
    //
    // Runway = how many unique reels are scheduled, not how many Post records.
    // A creator with N IG accounts produces N sibling Posts per reel (one per
    // account), so counting raw Posts overstates buffer Nx. Dedupe by Asset ID.
    const futureAssetsByCreator = {}  // { creatorId: Set<assetId> }
    const postsByDateByCreator = {}
    for (const post of allPosts) {
      const creatorId = (post.fields?.Creator || [])[0]
      if (!creatorId) continue
      const date = toETDateStr(post.fields?.['Scheduled Date'] || '')
      if (date) {
        if (!postsByDateByCreator[creatorId]) postsByDateByCreator[creatorId] = {}
        postsByDateByCreator[creatorId][date] = (postsByDateByCreator[creatorId][date] || 0) + 1
      }
      // Only count future posts toward buffer, deduped by Asset
      if (date && date > todayStr) {
        const assetId = (post.fields?.Asset || [])[0]
        if (!assetId) continue
        if (!futureAssetsByCreator[creatorId]) futureAssetsByCreator[creatorId] = new Set()
        futureAssetsByCreator[creatorId].add(assetId)
      }
    }

    // Editor may work at a DIFFERENT cadence than posting. Weekly Reel Quota
    // sets how many edits the editor should produce per day (e.g. 3/day to
    // build a buffer). Posting cadence is fixed at 2/day — that's what the
    // Grid Planner schedules into, so runway is measured against 2, not the
    // editor's production rate.
    const POSTS_PER_DAY = 2

    const result = creators.map(c => {
      const f = c.fields || {}
      const ctasks = tasksByCreator[c.id] || []
      const inspoClips = inspoClipsByCreator[c.id] || []
      const weeklyQuota = f['Weekly Reel Quota'] || 14
      const dailyQuota = Math.ceil(weeklyQuota / 7)
      const approvedBuffer = futureAssetsByCreator[c.id]?.size || 0
      const bufferDays = parseFloat((approvedBuffer / POSTS_PER_DAY).toFixed(1))

      // Redistribute ALL submitted tasks (approved + in-review + needs-revision)
      // so each day stays at dailyQuota. A revision is still a real edit the
      // editor produced on its original day — it should stay pinned to that
      // day's slot rather than floating forward into today's queue. Without
      // this, sending back a revision empties yesterday's slot retroactively
      // and double-counts against today.
      // Everyone pins to their completion date first; if that day is full, the
      // task rolls forward to the next day's first open slot. Sort by
      // completion time so earlier tasks get first pick of same-day slots —
      // overshoots (the 4th edit of a 3-slot day) roll to tomorrow.
      const isPinnedTask = t => t.completedAt && (
        t.status === 'Done' || t.adminReviewStatus === 'Needs Revision'
      )
      const doneTasksForRedist = ctasks.filter(isPinnedTask)
      const sortedDone = [...doneTasksForRedist].sort(
        (a, b) => new Date(a.completedAt || 0) - new Date(b.completedAt || 0)
      )
      const nextDay = (ds) => {
        const dt = new Date(ds + 'T12:00:00')
        dt.setDate(dt.getDate() + 1)
        return dt.toISOString().split('T')[0]
      }
      const slotsUsedByDate = {}
      for (const t of sortedDone) {
        let candidate = t.etCompletedDate || todayStr
        while ((slotsUsedByDate[candidate] || 0) >= dailyQuota) {
          candidate = nextDay(candidate)
        }
        t.etSlotDate = candidate
        slotsUsedByDate[candidate] = (slotsUsedByDate[candidate] || 0) + 1
      }

      // doneThisWeek counts the editor's productivity — revisions still count
      // as work they did this week (the rework is ahead of them, but the
      // original edit is in the books).
      const doneThisWeek = ctasks.filter(t =>
        isPinnedTask(t) && t.etCompletedDate >= weekStartStr
      ).length

      const doneTodayList = ctasks.filter(t =>
        isPinnedTask(t) && t.etSlotDate === todayStr
      )

      // All pinned tasks from the past 14 days for date navigation. Includes
      // revisions so they render in the slot they were originally submitted.
      const recentDone = ctasks.filter(t =>
        isPinnedTask(t) && t.etSlotDate >= twoWeeksAgoStr
      )

      return {
        id: c.id,
        name: f.AKA || f.Creator || '',
        hasProfile: !!(f['Profile Summary']),
        hasPlaylist: !!(f['Music DNA Processed']),
        quota: weeklyQuota,
        dailyQuota,
        doneToday: doneThisWeek,
        doneTodayList,
        recentDone,
        approvedBuffer,
        bufferDays,
        needsRevision: ctasks.filter(t => t.adminReviewStatus === 'Needs Revision'),
        queue: ctasks.filter(t => t.status === 'To Do'),
        // In-progress tasks that have NEVER been submitted (no completedAt)
        // float forward from today as queue items. Revisions are also In
        // Progress but they're pinned to their original submission day above,
        // so exclude them here to avoid double-rendering.
        inProgress: ctasks.filter(t => t.status === 'In Progress' && !t.completedAt),
        inReview: ctasks.filter(t => t.status === 'Done' && t.adminReviewStatus === 'Pending Review'),
        approved: ctasks.filter(t => t.status === 'Done' && t.adminReviewStatus === 'Approved' && (t.completedAt || '') >= weekStartStr),
        inspoClips,
        postsByDate: postsByDateByCreator[c.id] || {},
      }
    })

    return NextResponse.json({ creators: result })
  } catch (err) {
    console.error('[Editor Dashboard] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
