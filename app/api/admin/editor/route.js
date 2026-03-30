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
    // 1. Fetch active tasks
    const tasks = await fetchAirtableRecords('Tasks', {
      filterByFormula: "OR({Status}='To Do',{Status}='In Progress')",
    })

    if (!tasks.length) {
      return NextResponse.json({ tasks: [], total: 0 })
    }

    // 2. Collect Asset IDs (plain text field, not linked record)
    const assetIds = [...new Set(
      tasks.map(t => (t.fields?.Asset || '').trim()).filter(Boolean)
    )]

    // 3. Collect Creator IDs (plain text field)
    const creatorIds = [...new Set(
      tasks.map(t => (t.fields?.['Related Creator'] || '').trim()).filter(Boolean)
    )]

    // 4. Batch-fetch Assets + Creators in parallel
    const [assetRecords, creatorRecords] = await Promise.all([
      assetIds.length ? fetchAirtableRecords('Assets', {
        filterByFormula: recordIdFormula(assetIds),
        fields: [
          'Asset Name', 'Pipeline Status', 'Dropbox Shared Link', 'Dropbox Path (Current)',
          'Creator Notes', 'Inspiration Source', 'Source Type',
        ],
      }) : [],
      creatorIds.length ? fetchAirtableRecords('Palm Creators', {
        filterByFormula: recordIdFormula(creatorIds),
        fields: ['Creator', 'AKA'],
      }) : [],
    ])

    // 5. Build asset + creator maps
    const assetMap = {}
    for (const r of assetRecords) {
      assetMap[r.id] = r.fields
    }

    const creatorMap = {}
    for (const r of creatorRecords) {
      creatorMap[r.id] = r.fields
    }

    // 6. Collect Inspiration IDs from assets (proper linked records)
    const inspoIds = [...new Set(
      assetRecords.flatMap(r => {
        const src = r.fields?.['Inspiration Source'] || []
        return Array.isArray(src) ? src : [src]
      }).filter(Boolean)
    )]

    // 7. Batch-fetch Inspiration records
    const inspoRecords = inspoIds.length ? await fetchAirtableRecords('Inspiration', {
      filterByFormula: recordIdFormula(inspoIds),
      fields: [
        'Title', 'Notes', 'Tags', 'Film Format', 'Content link', 'Thumbnail',
        'Username', 'Audio Type', 'DB Share Link', 'Rating',
      ],
    }) : []

    const inspoMap = {}
    for (const r of inspoRecords) {
      inspoMap[r.id] = r.fields
    }

    // 8. Assemble joined response
    const joinedTasks = tasks.map(t => {
      const f = t.fields || {}
      const assetId = (f.Asset || '').trim()
      const creatorId = (f['Related Creator'] || '').trim()
      const asset = assetMap[assetId] || {}
      const creator = creatorMap[creatorId] || {}

      // Get first linked inspo record
      const inspoSrcIds = Array.isArray(asset['Inspiration Source']) ? asset['Inspiration Source'] : []
      const inspoId = inspoSrcIds[0] || null
      const inspo = inspoId ? (inspoMap[inspoId] || {}) : {}

      return {
        id: t.id,
        name: f.Name || '',
        description: f.Description || '',
        status: f.Status || 'To Do',
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

    // Sort: In Progress first, then To Do, then by creation time
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

    // Fetch the task to get the Asset ID
    const tasks = await fetchAirtableRecords('Tasks', {
      filterByFormula: `RECORD_ID()='${taskId}'`,
    })
    if (!tasks.length) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const assetId = (tasks[0].fields?.Asset || '').trim()

    // Update Task status
    await patchAirtableRecord('Tasks', taskId, { Status: newStatus })

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
