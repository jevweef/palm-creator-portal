import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import {
  getDropboxAccessToken,
  getDropboxRootNamespaceId,
  createDropboxFolder,
  createDropboxSharedLink,
} from '@/lib/dropbox'
import { createDropboxFileRequest } from '@/lib/dropboxFileRequests'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const PROJECTS_TABLE = 'tbl7DTdRooCsAns7j'
const CREATORS_TABLE = 'tbls2so6pHGbU4Uhh'

function sanitizeForPath(s) {
  return String(s || '').replace(/[\/\\:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
}

function todayStamp() {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

async function fetchCreator(opsId) {
  const res = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${CREATORS_TABLE}/${opsId}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
  )
  if (!res.ok) return null
  return res.json()
}

function mapRecord(r) {
  const f = r.fields || {}
  return {
    id: r.id,
    projectName: f['Project Name'] || '',
    status: f['Status'] || 'Awaiting Upload',
    instructions: f['Instructions'] || '',
    fileRequestUrl: f['Dropbox File Request URL'] || '',
    folderLink: f['Dropbox Folder Link'] || '',
    folderPath: f['Dropbox Folder Path'] || '',
    fileCount: f['File Count'] || 0,
    totalSize: f['Total Size (bytes)'] || 0,
    lastUploadedAt: f['Last File Uploaded At'] || null,
    assignedEditor: f['Assigned Editor'] || '',
    editorNotes: f['Editor Notes'] || '',
    editedFileLink: f['Edited File Link'] || '',
    adminFeedback: f['Admin Feedback'] || '',
    createdAt: f['Created At'] || null,
  }
}

export async function GET(request) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await currentUser()
  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin' || role === 'super_admin' || role === 'editor'

  const { searchParams } = new URL(request.url)
  const creatorOpsId = searchParams.get('creatorOpsId')
  if (!creatorOpsId) return NextResponse.json({ error: 'creatorOpsId required' }, { status: 400 })
  if (!/^rec[A-Za-z0-9]{14}$/.test(creatorOpsId)) {
    return NextResponse.json({ error: 'Invalid creatorOpsId' }, { status: 400 })
  }

  if (!isAdmin && user?.publicMetadata?.airtableOpsId !== creatorOpsId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Fetch all and filter client-side. ARRAYJOIN on a linked record field returns
  // the primary-field value (name), not record IDs — so FIND('recXXX', ...) misses.
  const q = new URLSearchParams()
  q.set('sort[0][field]', 'Created At')
  q.set('sort[0][direction]', 'desc')
  q.set('pageSize', '100')
  const res = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${PROJECTS_TABLE}?${q}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
  )
  if (!res.ok) {
    return NextResponse.json({ error: 'Airtable fetch failed', detail: await res.text() }, { status: 500 })
  }
  const data = await res.json()
  const mine = (data.records || []).filter(r => (r.fields?.['Creator'] || []).includes(creatorOpsId))
  return NextResponse.json({ projects: mine.map(mapRecord) })
}

export async function POST(request) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await currentUser()
  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin' || role === 'super_admin'

  const { creatorOpsId, projectName, instructions } = await request.json()

  if (!creatorOpsId || !projectName) {
    return NextResponse.json({ error: 'creatorOpsId and projectName required' }, { status: 400 })
  }
  if (!/^rec[A-Za-z0-9]{14}$/.test(creatorOpsId)) {
    return NextResponse.json({ error: 'Invalid creatorOpsId' }, { status: 400 })
  }
  if (!isAdmin && user?.publicMetadata?.airtableOpsId !== creatorOpsId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const creator = await fetchCreator(creatorOpsId)
  if (!creator) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
  const aka = creator.fields?.['AKA'] || creator.fields?.['Creator'] || 'Unknown'

  const safeCreator = sanitizeForPath(aka)
  const safeName = sanitizeForPath(projectName) || 'Untitled'
  const folderName = `${safeName} - ${todayStamp()}`
  const folderPath = `/Palm Ops/Creators/${safeCreator}/Long Form/Projects/${folderName}`

  let folderLink = ''
  let fileRequestUrl = ''
  let fileRequestId = ''
  let fileRequestError = ''

  let accessToken, rootNs
  try {
    accessToken = await getDropboxAccessToken()
    rootNs = await getDropboxRootNamespaceId(accessToken)
    // Ensure the Projects parent exists (creatorSetup only provisions Long Form + 10_UNREVIEWED_LIBRARY)
    await createDropboxFolder(accessToken, rootNs, `/Palm Ops/Creators/${safeCreator}/Long Form/Projects`)
    await createDropboxFolder(accessToken, rootNs, folderPath)
  } catch (err) {
    console.error('[oftv-projects] Folder creation failed:', err.message)
    return NextResponse.json({ error: 'Failed to create Dropbox folder', detail: err.message }, { status: 500 })
  }

  try { folderLink = await createDropboxSharedLink(accessToken, rootNs, folderPath) || '' } catch (err) {
    console.warn('[oftv-projects] Shared link failed:', err.message)
  }

  try {
    const fr = await createDropboxFileRequest(accessToken, rootNs, {
      title: `${aka} — ${projectName}`.slice(0, 140),
      destination: folderPath,
    })
    fileRequestUrl = fr.url
    fileRequestId = fr.id
  } catch (err) {
    console.error('[oftv-projects] File request failed:', err.message)
    fileRequestError = err.message
  }

  const createRes = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${PROJECTS_TABLE}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        typecast: true,
        records: [{
          fields: {
            'Project Name': projectName,
            'Creator': [creatorOpsId],
            'Status': 'Awaiting Upload',
            'Instructions': instructions || '',
            'Dropbox Folder Path': folderPath,
            'Dropbox Folder Link': folderLink,
            'Dropbox File Request URL': fileRequestUrl,
            'Dropbox File Request ID': fileRequestId,
            'File Count': 0,
            'Created At': new Date().toISOString(),
          },
        }],
      }),
    }
  )

  if (!createRes.ok) {
    const err = await createRes.text()
    console.error('[oftv-projects] Airtable create failed:', err)
    return NextResponse.json({ error: 'Airtable create failed', detail: err }, { status: 500 })
  }

  const data = await createRes.json()
  return NextResponse.json({
    project: mapRecord(data.records[0]),
    ...(fileRequestError ? { warning: `Project created, but Dropbox upload link failed: ${fileRequestError}` } : {}),
  })
}
