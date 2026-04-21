export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdminOrEditor, fetchAirtableRecords, patchAirtableRecord, createAirtableRecord, OPS_BASE, airtableHeaders } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, createDropboxSharedLink } from '@/lib/dropbox'

const FROM_STAGE = '10_UNREVIEWED_LIBRARY'
const TO_STAGE = '20_NEEDS_EDIT'

// Move the raw clip from 10_UNREVIEWED_LIBRARY → 20_NEEDS_EDIT when a task
// is created. Returns the new path + share link, or null if the move didn't
// apply (e.g. path wasn't in the source stage). Non-fatal — we log but don't
// fail the task creation if Dropbox is misbehaving.
async function moveRawClipToNeedsEdit(currentPath) {
  if (!currentPath || !currentPath.includes(`/${FROM_STAGE}/`)) return null
  const newPath = currentPath.replace(`/${FROM_STAGE}/`, `/${TO_STAGE}/`)
  try {
    const token = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(token)
    const moveRes = await fetch('https://api.dropboxapi.com/2/files/move_v2', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root: ns }),
      },
      body: JSON.stringify({ from_path: currentPath, to_path: newPath, autorename: false }),
    })
    if (!moveRes.ok) {
      const err = await moveRes.text()
      // Tolerate "already at destination" and "source missing" — file may have
      // been moved manually or by a concurrent request.
      if (moveRes.status !== 409) throw new Error(`move ${moveRes.status}: ${err.slice(0, 200)}`)
      console.warn(`[Editor Tasks] Dropbox move 409 (tolerated):`, err.slice(0, 120))
    }
    let newLink = ''
    try {
      newLink = await createDropboxSharedLink(token, ns, newPath)
    } catch (linkErr) {
      console.warn(`[Editor Tasks] Could not create share link at new path:`, linkErr.message)
    }
    return { newPath, newLink }
  } catch (err) {
    console.error(`[Editor Tasks] Dropbox move failed (non-fatal):`, err.message)
    return null
  }
}

// POST — create a new Task for a library asset and move the raw clip out of
// the unreviewed library. Three things happen:
//   1. New Task record in 'To Do' status
//   2. Raw Dropbox file physically moved 10_UNREVIEWED_LIBRARY → 20_NEEDS_EDIT
//      (so the folder stays lean and Make automations don't re-ingest it)
//   3. Asset record updated: Pipeline Status = 'In Editing', Tasks linked,
//      Dropbox path + share link synced to the new location
//
// If the Dropbox move fails, the task is still created (non-fatal) — run the
// /tmp/unreviewed-cleanup.mjs script to backfill any stragglers.
// If the Airtable Asset PATCH fails, the created task is rolled back to avoid
// orphaned records.
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
      fields: ['Asset Name', 'Tasks', 'Inspiration Source', 'Pipeline Status', 'Dropbox Path (Current)', 'Dropbox Parent Folder'],
    })
    if (!assetRecords.length) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
    }
    const assetFields = assetRecords[0].fields || {}
    const assetName = assetFields['Asset Name'] || 'Untitled'
    const existingTasks = assetFields['Tasks'] || []
    const inspoSourceIds = assetFields['Inspiration Source'] || []
    const currentPath = (assetFields['Dropbox Path (Current)'] || '').trim()
    const currentParent = (assetFields['Dropbox Parent Folder'] || '').trim()

    // 2. Create the Task record
    const newTask = await createAirtableRecord('Tasks', {
      'Name': `Edit: ${assetName}`,
      'Status': 'To Do',
      'Creator': [creatorId],
      'Asset': [assetId],
      ...(inspoSourceIds.length ? { 'Inspiration': inspoSourceIds } : {}),
    })
    const taskId = newTask.id

    // 3. Move the raw Dropbox file: 10_UNREVIEWED_LIBRARY → 20_NEEDS_EDIT
    //    (non-fatal — proceeds even if Dropbox misbehaves; cleanup script
    //    can backfill any stragglers).
    const moveResult = await moveRawClipToNeedsEdit(currentPath)

    // 4. Flip the asset: Pipeline Status → 'In Editing', link the new Task,
    //    sync path fields if the file moved. Throws if the PATCH fails —
    //    we don't want to leave a zombie task + an asset still showing 'Uploaded'.
    const updatedTasks = [...new Set([...existingTasks, taskId])]
    const assetUpdate = {
      'Pipeline Status': 'In Editing',
      'Tasks': updatedTasks,
    }
    if (moveResult?.newPath) {
      assetUpdate['Dropbox Path (Current)'] = moveResult.newPath
      if (currentParent) {
        assetUpdate['Dropbox Parent Folder'] = currentParent.replace(`/${FROM_STAGE}`, `/${TO_STAGE}`)
      }
      if (moveResult.newLink) assetUpdate['Dropbox Shared Link'] = moveResult.newLink
    }
    try {
      await patchAirtableRecord('Assets', assetId, assetUpdate)
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
