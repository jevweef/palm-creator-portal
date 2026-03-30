import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'

// Status mapping: Task Status → Asset Pipeline Status
const TASK_TO_ASSET_STATUS = {
  'In Progress': 'In Editing',
  'Done': 'In Review',
}

// Build OR formula for batch record lookup by ID
function recordIdFormula(ids) {
  if (!ids.length) return ''
  return `OR(${ids.map(id => `RECORD_ID()='${id}'`).join(',')})`
}

// GET — fetch editor task queue with joined inspo + creator + asset data
export async function GET() {
  try {
    await requireAdmin()
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
          'Creator Notes', 'Source Type',
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
          'Username', 'Audio Type', 'DB Share Link', 'Rating',
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
          dropboxPath: asset['Dropbox Path (Current)'] || '',
          creatorNotes: asset['Creator Notes'] || '',
          sourceType: asset['Source Type'] || '',
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

// PATCH — update task + asset status
export async function PATCH(request) {
  try {
    await requireAdmin()
  } catch (e) { return e }

  try {
    const { taskId, newStatus } = await request.json()
    if (!taskId || !newStatus) {
      return NextResponse.json({ error: 'taskId and newStatus required' }, { status: 400 })
    }

    if (!TASK_TO_ASSET_STATUS[newStatus]) {
      return NextResponse.json({ error: `Invalid status: ${newStatus}` }, { status: 400 })
    }

    // Fetch the task to get linked Asset ID
    const tasks = await fetchAirtableRecords('Tasks', {
      filterByFormula: `RECORD_ID()='${taskId}'`,
    })
    if (!tasks.length) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const assetId = (tasks[0].fields?.Asset || [])[0] || null

    // Update Task status
    const taskUpdate = { Status: newStatus }
    if (newStatus === 'Done') {
      taskUpdate['Completed At'] = new Date().toISOString()
    }
    await patchAirtableRecord('Tasks', taskId, taskUpdate)

    // Update Asset Pipeline Status if we have an asset
    if (assetId) {
      await patchAirtableRecord('Assets', assetId, {
        'Pipeline Status': TASK_TO_ASSET_STATUS[newStatus],
      })
    }

    console.log(`[Editor] Task ${taskId}: ${newStatus}, Asset ${assetId}: ${TASK_TO_ASSET_STATUS[newStatus]}`)

    return NextResponse.json({ ok: true, taskId, newStatus, assetPipelineStatus: TASK_TO_ASSET_STATUS[newStatus] })
  } catch (err) {
    console.error('[Editor] PATCH error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
