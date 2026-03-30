export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdminOrEditor, fetchAirtableRecords } from '@/lib/adminAuth'

// Batch fetch by IDs (max 20 per request to avoid 414)
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

export async function GET(request, { params }) {
  try { await requireAdminOrEditor() } catch (e) { return e }
  const { creatorId } = params

  try {
    const creators = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `RECORD_ID()='${creatorId}'`,
      fields: ['Creator', 'AKA', 'Weekly Reel Quota', 'Tasks', 'Telegram Thread ID'],
    })
    if (!creators.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const creator = creators[0]
    const f = creator.fields || {}

    const allTaskIds = f.Tasks || []

    const now = new Date()
    const dayOfWeek = now.getDay()
    const monday = new Date(now)
    monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7))
    monday.setHours(0, 0, 0, 0)
    const weekStartStr = monday.toISOString().split('T')[0]

    // Fetch tasks + assets for this creator in parallel
    const [tasks, allAssets] = await Promise.all([
      fetchByIds('Tasks', allTaskIds, {
        fields: [
          'Name', 'Status', 'Creator', 'Asset', 'Inspiration',
          'Creator Notes', 'Editor Notes', 'Completed At',
          'Admin Review Status', 'Admin Feedback', 'Admin Screenshots',
        ],
      }),
      fetchAirtableRecords('Assets', {
        filterByFormula: `AND({Pipeline Status}='Uploaded')`,
        fields: [
          'Asset Name', 'Pipeline Status', 'Source Type', 'Asset Type', 'Dropbox Shared Link',
          'Dropbox Path (Current)', 'Creator Notes', 'Thumbnail', 'Palm Creators',
          'Upload Week', 'On Screen Text', 'Captions',
        ],
      }).then(assets => assets.filter(a => (a.fields?.['Palm Creators'] || [])[0] === creatorId)),
    ])

    // Filter tasks to active ones
    const activeTasks = tasks.filter(t => {
      const s = t.fields?.Status
      const rev = t.fields?.['Admin Review Status']
      if (s === 'To Do' || s === 'In Progress') return true
      if (s === 'Done') {
        return (t.fields?.['Completed At'] || '') >= weekStartStr
          || rev === 'Pending Review'
          || rev === 'Needs Revision'
      }
      return false
    })

    // Fetch linked inspo + task assets
    const taskAssetIds = [...new Set(activeTasks.flatMap(t => t.fields?.Asset || []))]
    const inspoIds = [...new Set(activeTasks.flatMap(t => t.fields?.Inspiration || []))]

    const [taskAssets, inspoRecords] = await Promise.all([
      fetchByIds('Assets', taskAssetIds, {
        fields: ['Asset Name', 'Pipeline Status', 'Dropbox Shared Link', 'Dropbox Path (Current)', 'Creator Notes', 'Thumbnail', 'Edited File Link'],
      }),
      fetchByIds('Inspiration', inspoIds, {
        fields: ['Title', 'Notes', 'Tags', 'Film Format', 'Content link', 'Thumbnail', 'Username', 'DB Share Link', 'On-Screen Text'],
      }),
    ])

    const assetMap = Object.fromEntries(taskAssets.map(r => [r.id, r.fields]))
    const inspoMap = Object.fromEntries(inspoRecords.map(r => [r.id, r.fields]))

    // Build task objects
    const buildTask = (task) => {
      const assetId = (task.fields?.Asset || [])[0]
      const inspoId = (task.fields?.Inspiration || [])[0]
      const asset = assetId ? (assetMap[assetId] || {}) : {}
      const inspo = inspoId ? (inspoMap[inspoId] || {}) : {}
      const screenshots = (task.fields?.['Admin Screenshots'] || []).map(s => s.thumbnails?.large?.url || s.url)
      return {
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
      }
    }

    const doneThisWeek = activeTasks.filter(t =>
      t.fields?.Status === 'Done' &&
      (t.fields?.['Completed At'] || '') >= weekStartStr &&
      t.fields?.['Admin Review Status'] !== 'Needs Revision'
    ).length

    // Split library assets: inspo uploads vs file request
    const mapAsset = (a) => ({
      id: a.id,
      name: a.fields?.['Asset Name'] || '',
      sourceType: a.fields?.['Source Type'] || '',
      dropboxLink: a.fields?.['Dropbox Shared Link'] || '',
      dropboxLinks: (a.fields?.['Dropbox Shared Link'] || '').split('\n').filter(Boolean),
      dropboxPath: a.fields?.['Dropbox Path (Current)'] || '',
      creatorNotes: a.fields?.['Creator Notes'] || '',
      thumbnail: a.fields?.Thumbnail?.[0]?.thumbnails?.large?.url || a.fields?.Thumbnail?.[0]?.url || '',
      uploadWeek: a.fields?.['Upload Week'] || '',
      assetType: a.fields?.['Asset Type'] || '',
      onScreenText: a.fields?.['On Screen Text'] || '',
      captions: a.fields?.['Captions'] || '',
      createdTime: a.createdTime || '',
    })

    const inspoUploads = allAssets.filter(a => a.fields?.['Source Type'] === 'Inspo Upload').map(mapAsset)
    const libraryClips = allAssets.filter(a => a.fields?.['Source Type'] !== 'Inspo Upload').map(mapAsset)
    inspoUploads.sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime))
    libraryClips.sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime))

    return NextResponse.json({
      creator: {
        id: creator.id,
        name: f.AKA || f.Creator || '',
        quota: f['Weekly Reel Quota'] || 2,
        doneThisWeek,
        telegramThreadId: f['Telegram Thread ID'] || null,
      },
      needsRevision: activeTasks.filter(t => t.fields?.['Admin Review Status'] === 'Needs Revision').map(buildTask),
      queue: activeTasks.filter(t => t.fields?.Status === 'To Do').map(buildTask),
      inProgress: activeTasks.filter(t => t.fields?.Status === 'In Progress').map(buildTask),
      inReview: activeTasks.filter(t => t.fields?.Status === 'Done' && t.fields?.['Admin Review Status'] === 'Pending Review').map(buildTask),
      inspoUploads,
      libraryClips,
    })
  } catch (err) {
    console.error('[Creator Detail] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
