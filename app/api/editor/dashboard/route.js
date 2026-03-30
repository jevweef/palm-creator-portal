export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdminOrEditor, fetchAirtableRecords } from '@/lib/adminAuth'

function recordIdFormula(ids) {
  if (!ids.length) return 'FALSE()'
  return `OR(${ids.map(id => `RECORD_ID()='${id}'`).join(',')})`
}

// Airtable GET URLs 414 when filterByFormula is too long — batch into chunks
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
    // 1. Fetch creators assigned to editor (Social Media Editing = true)
    const creators = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: '{Social Media Editing}=1',
      fields: ['Creator', 'AKA', 'Weekly Reel Quota', 'Tasks', 'Assets'],
    })
    if (!creators.length) return NextResponse.json({ creators: [] })

    // 2. Collect all linked task IDs from creator records
    const allTaskIds = [...new Set(creators.flatMap(c => c.fields?.Tasks || []))]
    const creatorIdSet = new Set(creators.map(c => c.id))

    // 3. Fetch tasks + all uploaded library assets in parallel
    // Library assets: fetch all Uploaded non-inspo assets, filter by creator in memory
    // (FIND+ARRAYJOIN on linked record fields matches display names not IDs — can't use in formula)
    const [tasks, libraryAssets] = await Promise.all([
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
    ])

    // 4. Filter tasks to relevant statuses only
    const todayStr = new Date().toISOString().split('T')[0]
    const now = new Date()
    const dayOfWeek = now.getDay() // 0=Sun, 1=Mon...
    const monday = new Date(now)
    monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7))
    monday.setHours(0, 0, 0, 0)
    const weekStartStr = monday.toISOString().split('T')[0]

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

    // 5. Collect linked record IDs from tasks
    const taskAssetIds = [...new Set(activeTasks.flatMap(t => t.fields?.Asset || []))]
    const inspoIds = [...new Set(activeTasks.flatMap(t => t.fields?.Inspiration || []))]

    // 6. Batch fetch task assets + inspo records
    const [taskAssets, inspoRecords] = await Promise.all([
      fetchByIds('Assets', taskAssetIds, {
        fields: [
          'Asset Name', 'Pipeline Status', 'Dropbox Shared Link',
          'Dropbox Path (Current)', 'Creator Notes', 'Thumbnail', 'Edited File Link',
        ],
      }),
      fetchByIds('Inspiration', inspoIds, {
        fields: [
          'Title', 'Notes', 'Tags', 'Film Format', 'Content link',
          'Thumbnail', 'Username', 'DB Share Link', 'On-Screen Text',
        ],
      }),
    ])

    const assetMap = Object.fromEntries(taskAssets.map(r => [r.id, r.fields]))
    const inspoMap = Object.fromEntries(inspoRecords.map(r => [r.id, r.fields]))

    // 7. Group tasks by creator
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

    // 8. Group library assets by creator, sorted newest first
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

    // 9. Assemble per-creator response
    const result = creators.map(c => {
      const f = c.fields || {}
      const ctasks = tasksByCreator[c.id] || []
      const library = libraryByCreator[c.id] || []

      const doneThisWeek = ctasks.filter(t =>
        t.status === 'Done' &&
        (t.completedAt || '') >= weekStartStr &&
        t.adminReviewStatus !== 'Needs Revision'
      ).length

      return {
        id: c.id,
        name: f.AKA || f.Creator || '',
        quota: f['Weekly Reel Quota'] || 2,
        doneToday: doneThisWeek,
        needsRevision: ctasks.filter(t => t.adminReviewStatus === 'Needs Revision'),
        queue: ctasks.filter(t => t.status === 'To Do'),
        inProgress: ctasks.filter(t => t.status === 'In Progress'),
        inReview: ctasks.filter(t => t.status === 'Done' && t.adminReviewStatus === 'Pending Review'),
        library,
      }
    })

    return NextResponse.json({ creators: result })
  } catch (err) {
    console.error('[Editor Dashboard] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
