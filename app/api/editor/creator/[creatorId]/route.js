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

export async function GET(request, { params }) {
  try { await requireAdminOrEditor() } catch (e) { return e }

  const creatorId = params.creatorId

  try {
    // 1. Fetch creator record to get all task + asset IDs
    const creators = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `RECORD_ID()='${creatorId}'`,
      fields: ['Creator', 'AKA', 'Weekly Reel Quota', 'Tasks', 'Assets'],
    })
    if (!creators.length) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
    const creator = creators[0]
    const f = creator.fields || {}

    const allTaskIds = f.Tasks || []
    const creatorName = f.AKA || f.Creator || ''
    // Folder path used in Dropbox Parent Folder field for unreviewed library assets
    const unreviewedFolderPath = `/Palm Ops/Creators/${creatorName}/Social Media/10_UNREVIEWED_LIBRARY`

    // 2. Fetch in parallel: all tasks, library assets (by folder path), inspo-linked assets, future posts
    const [tasks, libraryAssets, inspoLinkedAssets, futurePosts] = await Promise.all([
      fetchByIds('Tasks', allTaskIds, {
        fields: [
          'Name', 'Status', 'Creator', 'Asset', 'Inspiration',
          'Creator Notes', 'Editor Notes', 'Completed At',
          'Admin Review Status', 'Admin Feedback', 'Admin Screenshots',
        ],
      }),
      creatorName ? fetchAirtableRecords('Assets', {
        filterByFormula: `AND({Pipeline Status}='Uploaded',{Dropbox Parent Folder}='${unreviewedFolderPath}')`,
        fields: [
          'Asset Name', 'Pipeline Status', 'Source Type', 'Asset Type', 'Dropbox Shared Link',
          'Dropbox Path (Current)', 'Dropbox Parent Folder', 'Creator Notes', 'Thumbnail', 'CDN URL', 'Upload Week',
        ],
      }) : [],
      // Inspo-linked assets: fetch by Source Type, then filter in-memory by creator ID
      // (FIND+ARRAYJOIN on linked record fields returns names, not IDs — unreliable)
      fetchAirtableRecords('Assets', {
        filterByFormula: `AND({Pipeline Status}='Uploaded',{Source Type}='Inspo Upload',NOT({Inspiration Source}=''))`,
        fields: [
          'Asset Name', 'Pipeline Status', 'Asset Type', 'Dropbox Shared Link', 'Dropbox Path (Current)',
          'Creator Notes', 'Thumbnail', 'CDN URL', 'Upload Week', 'Inspiration Source', 'Palm Creators',
        ],
      }),
      fetchAirtableRecords('Posts', {
        filterByFormula: `IS_AFTER({Scheduled Date}, NOW())`,
        fields: ['Creator', 'Scheduled Date'],
      }),
    ])

    // 3. Collect linked IDs from tasks
    const assetIds = [...new Set(tasks.flatMap(t => t.fields?.Asset || []))]
    const inspoIds = [...new Set([
      ...tasks.flatMap(t => t.fields?.Inspiration || []),
      ...inspoLinkedAssets.flatMap(a => a.fields?.['Inspiration Source'] || []),
    ])]

    const [taskAssets, inspoRecords] = await Promise.all([
      fetchByIds('Assets', assetIds, {
        fields: [
          'Asset Name', 'Pipeline Status', 'Dropbox Shared Link',
          'Dropbox Path (Current)', 'Creator Notes', 'Thumbnail', 'CDN URL', 'Edited File Link',
          'Stream Edit ID', 'Stream Raw ID',
        ],
      }),
      fetchByIds('Inspiration', inspoIds, {
        fields: ['Title', 'Notes', 'Tags', 'Film Format', 'Content link', 'Thumbnail', 'CDN URL', 'Username', 'DB Share Link', 'On-Screen Text'],
      }),
    ])

    const assetMap = Object.fromEntries(taskAssets.map(r => [r.id, r.fields]))
    const inspoMap = Object.fromEntries(inspoRecords.map(r => [r.id, r.fields]))

    // 4. Build full task list
    const allTasks = tasks.map(t => {
      const tf = t.fields || {}
      const assetId = (tf.Asset || [])[0]
      const inspoId = (tf.Inspiration || [])[0]
      const asset = assetId ? (assetMap[assetId] || {}) : {}
      const inspo = inspoId ? (inspoMap[inspoId] || {}) : {}
      const screenshots = (tf['Admin Screenshots'] || []).map(s => s.thumbnails?.large?.url || s.url)

      return {
        id: t.id,
        name: tf.Name || '',
        status: tf.Status || '',
        adminReviewStatus: tf['Admin Review Status'] || '',
        adminFeedback: tf['Admin Feedback'] || '',
        adminScreenshots: screenshots,
        creatorNotes: tf['Creator Notes'] || '',
        editorNotes: tf['Editor Notes'] || '',
        completedAt: tf['Completed At'] || null,
        asset: {
          id: assetId || null,
          name: asset['Asset Name'] || '',
          pipelineStatus: asset['Pipeline Status'] || '',
          dropboxLink: asset['Dropbox Shared Link'] || '',
          dropboxLinks: (asset['Dropbox Shared Link'] || '').split('\n').filter(Boolean),
          thumbnail: asset.Thumbnail?.[0]?.thumbnails?.large?.url || asset.Thumbnail?.[0]?.url || '',
          cdnUrl: asset['CDN URL'] || null,
          editedFileLink: asset['Edited File Link'] || '',
          streamEditId: asset['Stream Edit ID'] || null,
          streamRawId: asset['Stream Raw ID'] || null,
        },
        inspo: {
          id: inspoId || null,
          title: inspo.Title || '',
          notes: inspo.Notes || '',
          tags: inspo.Tags || [],
          contentLink: inspo['Content link'] || '',
          dbShareLink: inspo['DB Share Link'] || '',
          thumbnail: inspo.Thumbnail?.[0]?.thumbnails?.large?.url || inspo.Thumbnail?.[0]?.url || '',
          cdnUrl: inspo['CDN URL'] || null,
          username: inspo.Username || '',
          onScreenText: inspo['On-Screen Text'] || '',
        },
      }
    })

    // 5. Bucket tasks by status
    const needsRevision = allTasks.filter(t => t.adminReviewStatus === 'Needs Revision')
    const inProgress = allTasks.filter(t => t.status === 'In Progress' && t.adminReviewStatus !== 'Needs Revision')
    const queue = allTasks.filter(t => t.status === 'To Do')
    const inReview = allTasks.filter(t => t.status === 'Done' && t.adminReviewStatus === 'Pending Review')
    const approved = allTasks.filter(t => t.adminReviewStatus === 'Approved')
    const history = allTasks
      .filter(t => t.status === 'Done' && t.adminReviewStatus !== 'Pending Review' && t.adminReviewStatus !== 'Approved' && t.adminReviewStatus !== 'Needs Revision')
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))

    // 6. Inspo clips — filter to this creator only (in-memory, since ARRAYJOIN formula can't match record IDs)
    const inspoClips = inspoLinkedAssets
      .filter(a => (a.fields?.['Palm Creators'] || []).includes(creatorId))
      .map(a => {
      const inspoId = (a.fields?.['Inspiration Source'] || [])[0]
      const inspo = inspoId ? (inspoMap[inspoId] || {}) : {}
      return {
        id: a.id,
        name: a.fields?.['Asset Name'] || '',
        dropboxLink: a.fields?.['Dropbox Shared Link'] || '',
        dropboxLinks: (a.fields?.['Dropbox Shared Link'] || '').split('\n').filter(Boolean),
        thumbnail: a.fields?.Thumbnail?.[0]?.thumbnails?.large?.url || a.fields?.Thumbnail?.[0]?.url || '',
        cdnUrl: a.fields?.['CDN URL'] || null,
        creatorNotes: a.fields?.['Creator Notes'] || '',
        inspo: {
          id: inspoId || null,
          title: inspo.Title || '',
          thumbnail: inspo.Thumbnail?.[0]?.thumbnails?.large?.url || inspo.Thumbnail?.[0]?.url || '',
          cdnUrl: inspo['CDN URL'] || null,
          username: inspo.Username || '',
          contentLink: inspo['Content link'] || '',
          onScreenText: inspo['On-Screen Text'] || '',
        },
      }
    })

    // 7. Library assets, newest first — include assetType for Videos/Photos split
    const library = libraryAssets
      .sort((a, b) => new Date(b.createdTime || 0) - new Date(a.createdTime || 0))
      .map(a => ({
        id: a.id,
        name: a.fields?.['Asset Name'] || '',
        sourceType: a.fields?.['Source Type'] || '',
        assetType: a.fields?.['Asset Type'] || '',
        dropboxLink: a.fields?.['Dropbox Shared Link'] || '',
        dropboxLinks: (a.fields?.['Dropbox Shared Link'] || '').split('\n').filter(Boolean),
        thumbnail: a.fields?.Thumbnail?.[0]?.thumbnails?.large?.url || a.fields?.Thumbnail?.[0]?.url || '',
        cdnUrl: a.fields?.['CDN URL'] || null,
        creatorNotes: a.fields?.['Creator Notes'] || '',
        uploadWeek: a.fields?.['Upload Week'] || '',
        createdAt: a.createdTime || '',
      }))

    // 8. Buffer — runway divides by POSTING cadence (2/day, fixed), not by
    // editor production rate (Weekly Reel Quota / 7, which may be higher).
    const POSTS_PER_DAY = 2
    const approvedBuffer = futurePosts.filter(p => (p.fields?.Creator || []).includes(creatorId)).length
    const bufferDays = parseFloat((approvedBuffer / POSTS_PER_DAY).toFixed(1))

    const weeklyQuota = f['Weekly Reel Quota'] || 14

    return NextResponse.json({
      creator: {
        id: creator.id,
        name: f.AKA || f.Creator || '',
        quota: weeklyQuota,
        approvedBuffer,
        bufferDays,
      },
      tasks: { needsRevision, inProgress, queue, inReview, approved, history },
      inspoClips,
      library,
    })
  } catch (err) {
    console.error('[Editor Creator] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
