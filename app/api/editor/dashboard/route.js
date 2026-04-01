export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdminOrEditor, fetchAirtableRecords } from '@/lib/adminAuth'

function recordIdFormula(ids) {
  if (!ids.length) return 'FALSE()'
  return `OR(${ids.map(id => `RECORD_ID()='${id}'`).join(',')})`
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
      fields: ['Creator', 'AKA', 'Weekly Reel Quota', 'Tasks', 'Assets'],
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

    // Fetch tasks + library assets + inspo-linked creator clips + future posts in parallel
    const [tasks, libraryAssets, inspoLinkedAssets, allPosts] = await Promise.all([
      fetchByIds('Tasks', allTaskIds, {
        fields: [
          'Name', 'Status', 'Creator', 'Asset', 'Inspiration',
          'Creator Notes', 'Editor Notes', 'Completed At',
          'Admin Review Status', 'Admin Feedback', 'Admin Screenshots',
        ],
      }),
      fetchAirtableRecords('Assets', {
        filterByFormula: `AND({Pipeline Status}='Uploaded',{Source Type}!='Inspo Upload')`,
        fields: [
          'Asset Name', 'Pipeline Status', 'Source Type', 'Dropbox Shared Link',
          'Dropbox Path (Current)', 'Creator Notes', 'Thumbnail', 'Palm Creators', 'Upload Week',
        ],
      }).then(assets => assets.filter(a => {
        const creatorId = (a.fields?.['Palm Creators'] || [])[0]
        return creatorId && creatorIdSet.has(creatorId)
      })),
      // Creator-uploaded clips tied to a specific inspo record (priority fills)
      fetchAirtableRecords('Assets', {
        filterByFormula: `AND({Pipeline Status}='Uploaded', NOT({Inspiration Source}=''))`,
        fields: [
          'Asset Name', 'Pipeline Status', 'Dropbox Shared Link', 'Dropbox Path (Current)',
          'Creator Notes', 'Thumbnail', 'Palm Creators', 'Upload Week', 'Inspiration Source',
        ],
      }).then(assets => assets.filter(a => {
        const creatorId = (a.fields?.['Palm Creators'] || [])[0]
        return creatorId && creatorIdSet.has(creatorId)
      })),
      // Posts from last 60 days + all future — drives buffer + calendar coloring
      fetchAirtableRecords('Posts', {
        filterByFormula: `IS_AFTER({Scheduled Date}, DATEADD(TODAY(), -60, 'days'))`,
        fields: ['Creator', 'Scheduled Date'],
      }),
    ])

    const activeTasks = tasks.filter(t => {
      const s = t.fields?.Status
      const rev = t.fields?.['Admin Review Status']
      if (s === 'To Do' || s === 'In Progress') return true
      if (s === 'Done') {
        const completedAt = t.fields?.['Completed At'] || ''
        return completedAt >= weekStartStr
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
          'Asset Name', 'Pipeline Status', 'Dropbox Shared Link',
          'Dropbox Path (Current)', 'Creator Notes', 'Thumbnail', 'Edited File Link',
        ],
      }),
      fetchByIds('Inspiration', allInspoIds, {
        fields: [
          'Title', 'Notes', 'Tags', 'Film Format', 'Content link',
          'Thumbnail', 'Username', 'DB Share Link', 'On-Screen Text',
        ],
      }),
    ])

    const assetMap = Object.fromEntries(taskAssets.map(r => [r.id, r.fields]))
    const inspoMap = Object.fromEntries(inspoRecords.map(r => [r.id, r.fields]))

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
        adminReviewStatus: task.fields?.['Admin Review Status'] || '',
        adminFeedback: task.fields?.['Admin Feedback'] || '',
        adminScreenshots: screenshots,
        creatorNotes: task.fields?.['Creator Notes'] || '',
        editorNotes: task.fields?.['Editor Notes'] || '',
        completedAt: task.fields?.['Completed At'] || null,
        asset: {
          id: assetId,
          name: asset['Asset Name'] || '',
          pipelineStatus: asset['Pipeline Status'] || '',
          dropboxLink: asset['Dropbox Shared Link'] || '',
          dropboxLinks: (asset['Dropbox Shared Link'] || '').split('\n').filter(Boolean),
          dropboxPath: asset['Dropbox Path (Current)'] || '',
          creatorNotes: asset['Creator Notes'] || '',
          thumbnail: asset.Thumbnail?.[0]?.thumbnails?.large?.url || asset.Thumbnail?.[0]?.url || '',
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
          username: inspo.Username || '',
          dbShareLink: inspo['DB Share Link'] || '',
          onScreenText: inspo['On-Screen Text'] || '',
        },
      })
    }

    // Group inspo-linked creator assets by creator
    const inspoClipsByCreator = {}
    for (const asset of inspoLinkedAssets) {
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
        uploadWeek: asset.fields?.['Upload Week'] || '',
        inspo: {
          id: inspoId,
          title: inspo.Title || '',
          thumbnail: inspo.Thumbnail?.[0]?.thumbnails?.large?.url || inspo.Thumbnail?.[0]?.url || '',
          username: inspo.Username || '',
          tags: inspo.Tags || [],
          notes: inspo.Notes || '',
          contentLink: inspo['Content link'] || '',
          onScreenText: inspo['On-Screen Text'] || '',
        },
      })
    }

    const libraryByCreator = {}
    for (const asset of libraryAssets) {
      const creatorId = (asset.fields?.['Palm Creators'] || [])[0]
      if (!creatorId) continue
      if (!libraryByCreator[creatorId]) libraryByCreator[creatorId] = []
      libraryByCreator[creatorId].push({
        id: asset.id,
        name: asset.fields?.['Asset Name'] || '',
        sourceType: asset.fields?.['Source Type'] || '',
        dropboxLink: asset.fields?.['Dropbox Shared Link'] || '',
        dropboxLinks: (asset.fields?.['Dropbox Shared Link'] || '').split('\n').filter(Boolean),
        dropboxPath: asset.fields?.['Dropbox Path (Current)'] || '',
        creatorNotes: asset.fields?.['Creator Notes'] || '',
        thumbnail: asset.fields?.Thumbnail?.[0]?.thumbnails?.large?.url || asset.fields?.Thumbnail?.[0]?.url || '',
        uploadWeek: asset.fields?.['Upload Week'] || '',
        createdTime: asset.createdTime || '',
      })
    }
    for (const id of Object.keys(libraryByCreator)) {
      libraryByCreator[id].sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime))
    }

    // Group posts by creator: total future count + per-date breakdown (past 60 days + future)
    const futurePostsByCreator = {}
    const postsByDateByCreator = {}
    for (const post of allPosts) {
      const creatorId = (post.fields?.Creator || [])[0]
      if (!creatorId) continue
      const date = (post.fields?.['Scheduled Date'] || '').split('T')[0]
      if (date) {
        if (!postsByDateByCreator[creatorId]) postsByDateByCreator[creatorId] = {}
        postsByDateByCreator[creatorId][date] = (postsByDateByCreator[creatorId][date] || 0) + 1
      }
      // Only count future posts toward buffer
      if (date && date > todayStr) {
        futurePostsByCreator[creatorId] = (futurePostsByCreator[creatorId] || 0) + 1
      }
    }

    const POSTS_PER_DAY = 2 // 12 PM and 9 PM slots

    const result = creators.map(c => {
      const f = c.fields || {}
      const ctasks = tasksByCreator[c.id] || []
      const library = libraryByCreator[c.id] || []
      const inspoClips = inspoClipsByCreator[c.id] || []
      const weeklyQuota = f['Weekly Reel Quota'] || 14
      const dailyQuota = Math.ceil(weeklyQuota / 7)
      const approvedBuffer = futurePostsByCreator[c.id] || 0
      const bufferDays = parseFloat((approvedBuffer / POSTS_PER_DAY).toFixed(1))

      const doneThisWeek = ctasks.filter(t =>
        t.status === 'Done' &&
        (t.completedAt || '') >= weekStartStr &&
        t.adminReviewStatus !== 'Needs Revision'
      ).length

      const doneTodayList = ctasks.filter(t =>
        t.status === 'Done' &&
        (t.completedAt || '').startsWith(todayStr) &&
        t.adminReviewStatus !== 'Needs Revision'
      )

      // All done tasks from the past 14 days for date navigation
      const recentDone = ctasks.filter(t =>
        t.status === 'Done' &&
        t.adminReviewStatus !== 'Needs Revision' &&
        (t.completedAt || '') >= twoWeeksAgoStr
      )

      return {
        id: c.id,
        name: f.AKA || f.Creator || '',
        quota: weeklyQuota,
        dailyQuota,
        doneToday: doneThisWeek,
        doneTodayList,
        recentDone,
        approvedBuffer,
        bufferDays,
        needsRevision: ctasks.filter(t => t.adminReviewStatus === 'Needs Revision'),
        queue: ctasks.filter(t => t.status === 'To Do'),
        inProgress: ctasks.filter(t => t.status === 'In Progress'),
        inReview: ctasks.filter(t => t.status === 'Done' && t.adminReviewStatus === 'Pending Review'),
        library,
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
