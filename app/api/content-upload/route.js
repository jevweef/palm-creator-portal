import { NextResponse } from 'next/server'
import {
  getDropboxAccessToken,
  getDropboxRootNamespaceId,
  uploadToDropbox,
  createDropboxSharedLink,
} from '@/lib/dropbox'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const HQ_BASE = 'appL7c4Wtotpz07KS'
const ASSETS_TABLE = 'tblAPl8Pi5v1qmMNM'
const TASKS_TABLE = 'tblXMh2UznOJMgxl6'
const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'
const HQ_ONBOARDING = 'tbl4nFzgH6nJHr3q6'
const INSPIRATION_TABLE = 'tblnQhATaMtpoYErb'

// Allow larger uploads (100MB) and longer execution
export const maxDuration = 60

function getWeekStart() {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? 6 : day - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - diff)
  return monday.toISOString().split('T')[0]
}

async function getCreatorDropboxPath(hqId) {
  // Get creator name from HQ
  const creatorRes = await fetch(
    `https://api.airtable.com/v0/${HQ_BASE}/${HQ_CREATORS}/${hqId}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
  )
  if (!creatorRes.ok) throw new Error('Failed to fetch creator record')
  const creator = await creatorRes.json()
  const creatorName = creator.fields['Creator'] || ''

  // Find onboarding record by creator name
  const nameFilter = encodeURIComponent(`FIND("${creatorName}", {Creator})`)
  const onboardingRes = await fetch(
    `https://api.airtable.com/v0/${HQ_BASE}/${HQ_ONBOARDING}?filterByFormula=${nameFilter}&maxRecords=1`,
    { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
  )
  if (!onboardingRes.ok) throw new Error('Failed to fetch onboarding record')
  const onboarding = await onboardingRes.json()

  if (!onboarding.records || onboarding.records.length === 0) {
    throw new Error('No onboarding record found for creator')
  }

  const rootPath = onboarding.records[0].fields['Dropbox Creator Root Path']
  if (!rootPath) throw new Error('No Dropbox root path configured for creator')

  return rootPath
}

async function getInspoTitle(inspoId) {
  const res = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${INSPIRATION_TABLE}/${inspoId}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
  )
  if (!res.ok) return 'Untitled'
  const data = await res.json()
  return data.fields['Title'] || 'Untitled'
}

export async function POST(request) {
  try {
    const formData = await request.formData()
    const files = formData.getAll('files')
    const inspoRecordId = formData.get('inspoRecordId')
    const creatorOpsId = formData.get('creatorOpsId')
    const creatorHqId = formData.get('creatorHqId')
    const notes = formData.get('notes') || ''

    if (!inspoRecordId || !creatorOpsId || !creatorHqId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 })
    }

    console.log(`[content-upload] Starting upload: ${files.length} files for inspo ${inspoRecordId}`)

    // Get Dropbox path and auth in parallel
    const [dropboxPath, accessToken, inspoTitle] = await Promise.all([
      getCreatorDropboxPath(creatorHqId),
      getDropboxAccessToken(),
      getInspoTitle(inspoRecordId),
    ])

    const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)
    const uploadFolder = `${dropboxPath}/Social Media/20_NEEDS_EDIT`

    // Upload each file to Dropbox
    const uploadedFiles = []
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer())
      const fileName = file.name || `clip-${Date.now()}.mp4`
      const filePath = `${uploadFolder}/${fileName}`

      console.log(`[content-upload] Uploading ${fileName} to ${filePath}`)
      const result = await uploadToDropbox(accessToken, rootNamespaceId, filePath, buffer)

      // Get shared link
      let sharedLink = ''
      try {
        sharedLink = await createDropboxSharedLink(accessToken, rootNamespaceId, result.path_display)
      } catch (e) {
        console.warn(`[content-upload] Shared link failed for ${fileName}:`, e.message)
      }

      uploadedFiles.push({
        name: fileName,
        path: result.path_display,
        sharedLink,
        size: result.size,
      })
    }

    // Create Asset record in Airtable
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
              'Creator Notes': notes,
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
      // Don't fail the upload if task creation fails
    }

    console.log(`[content-upload] Success: ${uploadedFiles.length} files uploaded, asset ${assetId} created`)

    return NextResponse.json({
      status: 'success',
      assetId,
      files: uploadedFiles.map((f) => ({ name: f.name, path: f.path })),
    })
  } catch (err) {
    console.error('[content-upload] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
