import { NextResponse } from 'next/server'
import { requireAdminOrEditor, fetchAirtableRecords, patchAirtableRecord, createAirtableRecord } from '@/lib/adminAuth'

// Status mapping: Task Status → Asset Pipeline Status
const TASK_TO_ASSET_STATUS = {
  'In Progress': 'In Editing',
  'Done': 'In Review',
}

// Admin review actions
const ADMIN_ACTIONS = ['approve', 'requestRevision']

// Build OR formula for batch record lookup by ID
function recordIdFormula(ids) {
  if (!ids.length) return ''
  return `OR(${ids.map(id => `RECORD_ID()='${id}'`).join(',')})`
}

// GET — fetch editor task queue with joined inspo + creator + asset data
export async function GET() {
  try {
    await requireAdminOrEditor()
  } catch (e) { return e }

  try {
    // 1. Fetch active tasks — now with proper linked record fields
    const tasks = await fetchAirtableRecords('Tasks', {
      filterByFormula: "OR({Status}='To Do',{Status}='In Progress')",
    })

    if (!tasks.length) {
      return NextResponse.json({ tasks: [], total: 0 })
    }

    // 2. Collect linked record IDs from tasks (proper linked records now)
    const assetIds = [...new Set(tasks.flatMap(t => t.fields?.Asset || []).filter(Boolean))]
    const creatorIds = [...new Set(tasks.flatMap(t => t.fields?.Creator || []).filter(Boolean))]
    const inspoIds = [...new Set(tasks.flatMap(t => t.fields?.Inspiration || []).filter(Boolean))]

    // 3. Batch-fetch all linked records in parallel
    const [assetRecords, creatorRecords, inspoRecords] = await Promise.all([
      assetIds.length ? fetchAirtableRecords('Assets', {
        filterByFormula: recordIdFormula(assetIds),
        fields: [
          'Asset Name', 'Pipeline Status', 'Dropbox Shared Link', 'Dropbox Path (Current)',
          'Creator Notes', 'Source Type', 'Thumbnail',
        ],
      }) : [],
      creatorIds.length ? fetchAirtableRecords('Palm Creators', {
        filterByFormula: recordIdFormula(creatorIds),
        fields: ['Creator', 'AKA'],
      }) : [],
      inspoIds.length ? fetchAirtableRecords('Inspiration', {
        filterByFormula: recordIdFormula(inspoIds),
        fields: [
          'Title', 'Notes', 'Tags', 'Film Format', 'Content link', 'Thumbnail',
          'Username', 'Audio Type', 'DB Share Link', 'Rating', 'On-Screen Text', 'Transcript',
        ],
      }) : [],
    ])

    // 4. Build lookup maps
    const assetMap = Object.fromEntries(assetRecords.map(r => [r.id, r.fields]))
    const creatorMap = Object.fromEntries(creatorRecords.map(r => [r.id, r.fields]))
    const inspoMap = Object.fromEntries(inspoRecords.map(r => [r.id, r.fields]))

    // 5. Assemble joined response
    const joinedTasks = tasks.map(t => {
      const f = t.fields || {}
      const assetId = (f.Asset || [])[0] || null
      const creatorId = (f.Creator || [])[0] || null
      const inspoId = (f.Inspiration || [])[0] || null
      const asset = assetId ? (assetMap[assetId] || {}) : {}
      const creator = creatorId ? (creatorMap[creatorId] || {}) : {}
      const inspo = inspoId ? (inspoMap[inspoId] || {}) : {}

      return {
        id: t.id,
        name: f.Name || '',
        status: f.Status || 'To Do',
        creatorNotes: f['Creator Notes'] || '',
        editorNotes: f['Editor Notes'] || '',
        creator: {
          id: creatorId,
          name: creator.AKA || creator.Creator || '',
        },
        asset: {
          id: assetId,
          name: asset['Asset Name'] || '',
          pipelineStatus: asset['Pipeline Status'] || '',
          dropboxLink: asset['Dropbox Shared Link'] || '',
          dropboxLinks: (asset['Dropbox Shared Link'] || '').split('\n').filter(Boolean),
          dropboxPath: asset['Dropbox Path (Current)'] || '',
          creatorNotes: asset['Creator Notes'] || '',
          sourceType: asset['Source Type'] || '',
          thumbnail: asset.Thumbnail?.[0]?.thumbnails?.large?.url || asset.Thumbnail?.[0]?.url || '',
          dropboxPath: asset['Dropbox Path (Current)'] || '',
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
          audioType: inspo['Audio Type'] || '',
          dbShareLink: inspo['DB Share Link'] || '',
          rating: inspo.Rating || null,
          onScreenText: inspo['On-Screen Text'] || '',
          transcript: inspo.Transcript || '',
        },
      }
    })

    // Sort: In Progress first, then To Do
    joinedTasks.sort((a, b) => {
      const order = { 'In Progress': 0, 'To Do': 1 }
      return (order[a.status] ?? 2) - (order[b.status] ?? 2)
    })

    return NextResponse.json({ tasks: joinedTasks, total: joinedTasks.length })
  } catch (err) {
    console.error('[Editor] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH — update task + asset status, or admin review actions
export async function PATCH(request) {
  try {
    await requireAdminOrEditor()
  } catch (e) { return e }

  try {
    const body = await request.json()
    const { taskId, newStatus, editedFileLink, editedFilePath, editorNotes, isRevision, action, adminFeedback, adminScreenshotUrls } = body

    if (!taskId) {
      return NextResponse.json({ error: 'taskId required' }, { status: 400 })
    }

    // Fetch the task to get linked Asset ID
    const tasks = await fetchAirtableRecords('Tasks', {
      filterByFormula: `RECORD_ID()='${taskId}'`,
    })
    if (!tasks.length) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    const assetId = (tasks[0].fields?.Asset || [])[0] || null

    // ── Admin: Approve ──────────────────────────────────────────────────────────
    if (action === 'approve') {
      await patchAirtableRecord('Tasks', taskId, { 'Admin Review Status': 'Approved' })

      // Auto-create a Post record for prep
      try {
        const task = tasks[0]
        const creatorId = (task.fields?.Creator || [])[0] || null
        const taskName = task.fields?.Name || ''
        const assetName = taskName.replace(/^Edit:\s*/i, '')

        // Fetch creator AKA for post name
        let creatorAKA = ''
        if (creatorId) {
          const creators = await fetchAirtableRecords('Palm Creators', {
            filterByFormula: `RECORD_ID()='${creatorId}'`,
            fields: ['AKA', 'Creator'],
          })
          creatorAKA = creators[0]?.fields?.AKA || creators[0]?.fields?.Creator || ''
        }

        const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        const postName = [creatorAKA, assetName || dateStr].filter(Boolean).join(' – ')

        await createAirtableRecord('Posts', {
          'Post Name': postName,
          ...(creatorId ? { 'Creator': [creatorId] } : {}),
          ...(assetId ? { 'Asset': [assetId] } : {}),
          'Task': [taskId],
          'Status': 'Prepping',
        })
        console.log(`[Editor] Post record created for task ${taskId}`)
      } catch (postErr) {
        console.error('[Editor] Failed to create Post record:', postErr.message)
        // Don't fail the approval if post creation fails
      }

      return NextResponse.json({ ok: true, action: 'approve' })
    }

    // ── Admin: Request Revision ─────────────────────────────────────────────────
    if (action === 'requestRevision') {
      const taskUpdate = {
        'Admin Review Status': 'Needs Revision',
        'Status': 'In Progress',
      }
      if (adminFeedback) taskUpdate['Admin Feedback'] = adminFeedback
      if (adminScreenshotUrls?.length) {
        taskUpdate['Admin Screenshots'] = adminScreenshotUrls.map(url => ({ url }))
      }
      await patchAirtableRecord('Tasks', taskId, taskUpdate)
      if (assetId) {
        await patchAirtableRecord('Assets', assetId, { 'Pipeline Status': 'In Editing' })
      }
      console.log(`[Editor] Task ${taskId} sent back for revision`)
      return NextResponse.json({ ok: true, action: 'requestRevision' })
    }

    // ── Editor: Start Editing / Submit ──────────────────────────────────────────
    if (!newStatus) {
      return NextResponse.json({ error: 'newStatus or action required' }, { status: 400 })
    }
    if (!TASK_TO_ASSET_STATUS[newStatus]) {
      return NextResponse.json({ error: `Invalid status: ${newStatus}` }, { status: 400 })
    }

    const taskUpdate = { Status: newStatus }
    if (newStatus === 'Done') {
      taskUpdate['Completed At'] = new Date().toISOString()
      taskUpdate['Admin Review Status'] = 'Pending Review'
      // Clear any previous revision feedback when resubmitting
      if (isRevision) taskUpdate['Admin Feedback'] = ''
    }
    if (editorNotes) taskUpdate['Editor Notes'] = editorNotes
    await patchAirtableRecord('Tasks', taskId, taskUpdate)

    if (assetId) {
      const assetUpdate = { 'Pipeline Status': TASK_TO_ASSET_STATUS[newStatus] }
      if (editedFileLink) assetUpdate['Edited File Link'] = editedFileLink
      if (editedFilePath) assetUpdate['Edited File Path'] = editedFilePath
      await patchAirtableRecord('Assets', assetId, assetUpdate)
    }

    console.log(`[Editor] Task ${taskId}: ${newStatus}, Asset ${assetId}: ${TASK_TO_ASSET_STATUS[newStatus]}`)
    return NextResponse.json({ ok: true, taskId, newStatus, assetPipelineStatus: TASK_TO_ASSET_STATUS[newStatus] })
  } catch (err) {
    console.error('[Editor] PATCH error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
