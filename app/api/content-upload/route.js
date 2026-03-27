import { NextResponse } from 'next/server'

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
    const { inspoRecordId, creatorOpsId, notes, uploadedFiles } = await request.json()

    if (!inspoRecordId || !creatorOpsId || !uploadedFiles?.length) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
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
              'Dropbox Shared Link': uploadedFiles[0]?.sharedLink || '',
              'Dropbox Path (Current)': uploadedFiles[0]?.path || '',
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
          records: [{
            fields: {
              'Name': `Edit: ${inspoTitle}`,
              'Description': `Creator uploaded ${uploadedFiles.length} clip(s) for inspo: "${inspoTitle}".${notes ? ` Creator notes: ${notes}` : ''}`,
              'Status': 'To Do',
              'Asset': assetId,
              'Related Creator': creatorOpsId,
            },
          }],
        }),
      }
    )

    if (!taskRes.ok) {
      console.warn('[content-upload] Task creation failed:', await taskRes.text())
    }

    console.log(`[content-upload] Success: asset ${assetId} created for inspo "${inspoTitle}"`)

    return NextResponse.json({ status: 'success', assetId })
  } catch (err) {
    console.error('[content-upload] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
