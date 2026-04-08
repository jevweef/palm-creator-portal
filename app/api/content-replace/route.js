import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { getDropboxAccessToken, getDropboxRootNamespaceId, deleteDropboxFile } from '@/lib/dropbox'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const ASSETS_TABLE = 'tblAPl8Pi5v1qmMNM'
const TASKS_TABLE = 'tblXMh2UznOJMgxl6'

export async function POST(request) {
  try {
    const { userId } = auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { assetId, creatorOpsId, notes, uploadedFiles, thumbnailBase64 } = await request.json()

    // Ownership check
    const user = await currentUser()
    const role = user?.publicMetadata?.role
    const isAdmin = role === 'admin' || role === 'super_admin'
    if (!isAdmin && user?.publicMetadata?.airtableOpsId !== creatorOpsId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!assetId || !creatorOpsId || !uploadedFiles?.length) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (!/^rec[A-Za-z0-9]{14}$/.test(assetId) || !/^rec[A-Za-z0-9]{14}$/.test(creatorOpsId)) {
      return NextResponse.json({ error: 'Invalid record ID format' }, { status: 400 })
    }

    // Fetch the asset to validate status and get old Dropbox paths
    const assetRes = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/${ASSETS_TABLE}/${assetId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
    )
    if (!assetRes.ok) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
    }
    const asset = await assetRes.json()

    // Check asset belongs to this creator
    const assetCreators = asset.fields?.['Palm Creators'] || []
    if (!isAdmin && !assetCreators.includes(creatorOpsId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Check pipeline status — only allow replace if still "Uploaded"
    const pipelineStatus = asset.fields?.['Pipeline Status']
    if (pipelineStatus !== 'Uploaded') {
      return NextResponse.json({
        error: 'This clip is already being edited and cannot be replaced',
      }, { status: 409 })
    }

    // Check linked task status — only allow if task is still "To Do"
    const taskIds = asset.fields?.['Tasks'] || []
    if (taskIds.length > 0) {
      const taskId = taskIds[0]
      const taskRes = await fetch(
        `https://api.airtable.com/v0/${OPS_BASE}/${TASKS_TABLE}/${taskId}`,
        { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
      )
      if (taskRes.ok) {
        const task = await taskRes.json()
        const taskStatus = task.fields?.Status
        if (taskStatus && taskStatus !== 'To Do') {
          return NextResponse.json({
            error: 'An editor has already started on this clip — it cannot be replaced',
          }, { status: 409 })
        }
      }
    }

    // Delete old Dropbox files
    const oldPaths = (asset.fields?.['Dropbox Path (Current)'] || '')
      .split('\n')
      .map(p => p.trim())
      .filter(Boolean)

    if (oldPaths.length > 0) {
      try {
        const accessToken = await getDropboxAccessToken()
        const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)
        await Promise.all(
          oldPaths.map(path => deleteDropboxFile(accessToken, rootNamespaceId, path))
        )
      } catch (err) {
        console.warn('[content-replace] Dropbox delete failed (continuing):', err.message)
      }
    }

    // Update asset record with new files
    const updateRes = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/${ASSETS_TABLE}/${assetId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${AIRTABLE_PAT}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: {
            'Creator Notes': notes || '',
            'Dropbox Shared Link': uploadedFiles.map(f => f.sharedLink).filter(Boolean).join('\n') || '',
            'Dropbox Path (Current)': uploadedFiles.map(f => f.path).filter(Boolean).join('\n') || '',
          },
        }),
      }
    )

    if (!updateRes.ok) {
      const err = await updateRes.json()
      console.error('[content-replace] Asset update failed:', JSON.stringify(err))
      return NextResponse.json({ error: 'Failed to update asset record', detail: err }, { status: 500 })
    }

    // Re-upload thumbnail if provided (clear old one first by re-uploading)
    let thumbnailUploaded = false
    if (thumbnailBase64) {
      try {
        const thumbRes = await fetch(
          `https://content.airtable.com/v0/${OPS_BASE}/${assetId}/Thumbnail/uploadAttachment`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${AIRTABLE_PAT}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              contentType: 'image/jpeg',
              filename: 'clip-thumbnail.jpg',
              file: thumbnailBase64,
            }),
          }
        )
        thumbnailUploaded = thumbRes.ok
      } catch (err) {
        console.warn('[content-replace] Thumbnail upload error:', err.message)
      }
    }

    // Update task notes if there's a linked task
    if (taskIds.length > 0) {
      try {
        await fetch(
          `https://api.airtable.com/v0/${OPS_BASE}/${TASKS_TABLE}/${taskIds[0]}`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${AIRTABLE_PAT}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              fields: { 'Creator Notes': notes || '' },
            }),
          }
        )
      } catch (err) {
        console.warn('[content-replace] Task update failed:', err.message)
      }
    }

    return NextResponse.json({
      status: 'success',
      assetId,
      thumbnailUploaded,
    })
  } catch (err) {
    console.error('[content-replace] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
