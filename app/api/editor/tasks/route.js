export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdminOrEditor, fetchAirtableRecords, patchAirtableRecord, createAirtableRecord, OPS_BASE, airtableHeaders } from '@/lib/adminAuth'

// POST — create a new Task for a library asset and flip the asset out of the
// unreviewed library by setting Pipeline Status = 'In Editing'.
//
// CRITICAL: this route historically used field IDs (e.g. fld96IKrBmR1d5qdz for
// Pipeline Status) instead of field names. If the Airtable schema drifted, the
// PATCH would silently succeed but not update Pipeline Status — leaving the
// asset visible in the unreviewed library. Now uses field names everywhere
// (matches the rest of the codebase) and throws if the status update fails.
export async function POST(req) {
  try { await requireAdminOrEditor() } catch (e) { return e }

  try {
    const { assetId, creatorId } = await req.json()
    if (!assetId || !creatorId) {
      return NextResponse.json({ error: 'assetId and creatorId are required' }, { status: 400 })
    }

    // 1. Fetch the asset (by record ID via fetchAirtableRecords → returns field NAMES)
    const assetRecords = await fetchAirtableRecords('Assets', {
      filterByFormula: `RECORD_ID()='${assetId}'`,
      fields: ['Asset Name', 'Tasks', 'Inspiration Source', 'Pipeline Status'],
    })
    if (!assetRecords.length) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
    }
    const assetFields = assetRecords[0].fields || {}
    const assetName = assetFields['Asset Name'] || 'Untitled'
    const existingTasks = assetFields['Tasks'] || []
    const inspoSourceIds = assetFields['Inspiration Source'] || []

    // 2. Create the Task record
    const newTask = await createAirtableRecord('Tasks', {
      'Name': `Edit: ${assetName}`,
      'Status': 'To Do',
      'Creator': [creatorId],
      'Asset': [assetId],
      ...(inspoSourceIds.length ? { 'Inspiration': inspoSourceIds } : {}),
    })
    const taskId = newTask.id

    // 3. Flip the asset: Pipeline Status → 'In Editing', link the new Task.
    //    Throws if the PATCH fails — we don't want to leave a zombie task
    //    while the asset still shows as 'Uploaded'.
    const updatedTasks = [...new Set([...existingTasks, taskId])]
    try {
      await patchAirtableRecord('Assets', assetId, {
        'Pipeline Status': 'In Editing',
        'Tasks': updatedTasks,
      })
    } catch (patchErr) {
      console.error(`[Editor Tasks] Asset PATCH failed after task ${taskId} was created:`, patchErr.message)
      // Roll back the task so we don't leave orphaned records while the asset
      // is still showing as 'Uploaded' in the library
      try {
        await fetch(`https://api.airtable.com/v0/${OPS_BASE}/Tasks/${taskId}`, {
          method: 'DELETE', headers: airtableHeaders,
        })
      } catch {}
      throw new Error(`Could not update asset pipeline status: ${patchErr.message}`)
    }

    return NextResponse.json({ taskId })
  } catch (err) {
    console.error('[Editor Tasks] POST error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE — cancel a task and return the asset to the unreviewed library
export async function DELETE(req) {
  try { await requireAdminOrEditor() } catch (e) { return e }
  try {
    const { taskId, assetId } = await req.json()
    if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })

    // Delete the task record
    const delRes = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/Tasks/${taskId}`,
      { method: 'DELETE', headers: airtableHeaders }
    )
    if (!delRes.ok) throw new Error(`Failed to delete task: ${await delRes.text()}`)

    // Reset the asset's Pipeline Status so it reappears in the library
    if (assetId) {
      await patchAirtableRecord('Assets', assetId, {
        'Pipeline Status': 'Uploaded',
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[Editor Tasks] DELETE error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
