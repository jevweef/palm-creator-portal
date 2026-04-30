import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { triggerAssetMirror } from '@/lib/triggerMirror'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const ASSETS_TABLE = 'tblAPl8Pi5v1qmMNM'
const TASKS_TABLE = 'tblXMh2UznOJMgxl6'
const INSPIRATION_TABLE = 'tblnQhATaMtpoYErb'

function getWeekStart() {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? 6 : day - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - diff)
  return monday.toISOString().split('T')[0]
}

export async function POST(request) {
  try {
    const { userId } = auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { inspoRecordId, creatorOpsId, notes, uploadedFiles, thumbnailBase64 } = await request.json()

    // Ownership check
    const user = await currentUser()
    const role = user?.publicMetadata?.role
    const isAdmin = role === 'admin' || role === 'super_admin'
    if (!isAdmin && user?.publicMetadata?.airtableOpsId !== creatorOpsId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!inspoRecordId || !creatorOpsId || !uploadedFiles?.length) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Validate record ID formats
    if (!/^rec[A-Za-z0-9]{14}$/.test(inspoRecordId) || !/^rec[A-Za-z0-9]{14}$/.test(creatorOpsId)) {
      return NextResponse.json({ error: 'Invalid record ID format' }, { status: 400 })
    }

    // Get inspo title
    const inspoRes = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/${INSPIRATION_TABLE}/${inspoRecordId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
    )
    const inspoTitle = inspoRes.ok ? (await inspoRes.json()).fields?.['Title'] || 'Untitled' : 'Untitled'

    // Create Asset record
    const assetRes = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/${ASSETS_TABLE}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${AIRTABLE_PAT}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          typecast: true,
          records: [{
            fields: {
              'Asset Name': `Inspo Upload: ${inspoTitle}`,
              'Palm Creators': [creatorOpsId],
              'Inspiration Source': [inspoRecordId],
              'Source Type': 'Inspo Upload',
              'Source': 'Dropbox',
              'Pipeline Status': 'Uploaded',
              'Asset Type': 'Video',
              'Creator Notes': notes || '',
              'Upload Week': getWeekStart(),
              'Dropbox Shared Link': uploadedFiles.map(f => f.sharedLink).filter(Boolean).join('\n') || '',
              'Dropbox Path (Current)': uploadedFiles.map(f => f.path).filter(Boolean).join('\n') || '',
            },
          }],
        }),
      }
    )

    if (!assetRes.ok) {
      const err = await assetRes.json()
      console.error('[content-upload] Asset creation failed:', JSON.stringify(err))
      return NextResponse.json({ error: 'Failed to create asset record', detail: err }, { status: 500 })
    }

    const assetData = await assetRes.json()
    const assetId = assetData.records[0].id

    // Upload thumbnail to Asset record if provided
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
        if (!thumbRes.ok) {
          console.warn('[content-upload] Thumbnail upload failed:', await thumbRes.text())
        } else {
          thumbnailUploaded = true
        }
      } catch (err) {
        console.warn('[content-upload] Thumbnail upload error:', err.message)
      }
    }

    // Create Task record for editor
    const taskRes = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/${TASKS_TABLE}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${AIRTABLE_PAT}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          typecast: true,
          records: [{
            fields: {
              'Name': `Edit: ${inspoTitle}`,
              'Status': 'To Do',
              'Asset': [assetId],
              'Creator': [creatorOpsId],
              'Inspiration': inspoRecordId ? [inspoRecordId] : [],
              'Creator Notes': notes || '',
            },
          }],
        }),
      }
    )

    let taskCreated = true
    if (!taskRes.ok) {
      taskCreated = false
      console.warn('[content-upload] Task creation failed:', await taskRes.text())
    }

    triggerAssetMirror(assetId)

    return NextResponse.json({
      status: 'success',
      assetId,
      thumbnailUploaded,
      taskCreated,
      ...((!thumbnailUploaded || !taskCreated) && {
        warnings: [
          ...(!thumbnailUploaded && thumbnailBase64 ? ['Thumbnail upload failed — asset was created without a preview image'] : []),
          ...(!taskCreated ? ['Editor task creation failed — admin may need to create it manually'] : []),
        ],
      }),
    })
  } catch (err) {
    console.error('[content-upload] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
