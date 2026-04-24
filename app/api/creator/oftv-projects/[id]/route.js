import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import {
  getDropboxAccessToken,
  getDropboxRootNamespaceId,
  listDropboxFolder,
} from '@/lib/dropbox'
import {
  closeDropboxFileRequest,
  deleteDropboxFileRequests,
} from '@/lib/dropboxFileRequests'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const PROJECTS_TABLE = 'tbl7DTdRooCsAns7j'

async function fetchProject(id) {
  const res = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${PROJECTS_TABLE}/${id}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
  )
  if (!res.ok) return null
  return res.json()
}

function assertOwnershipOrAdmin(user, record, { allowEditor = false } = {}) {
  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin' || role === 'super_admin' || (allowEditor && role === 'editor')
  if (isAdmin) return true
  const creatorLinks = record.fields?.['Creator'] || []
  const ownerOpsId = user?.publicMetadata?.airtableOpsId
  return ownerOpsId && creatorLinks.includes(ownerOpsId)
}

function mapRecord(r, files = null) {
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
    ...(files ? { files } : {}),
  }
}

export async function GET(request, { params }) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await currentUser()
  const { id } = params
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const record = await fetchProject(id)
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!assertOwnershipOrAdmin(user, record, { allowEditor: true })) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const includeFiles = searchParams.get('includeFiles') === '1'
  let files = null
  if (includeFiles && record.fields?.['Dropbox Folder Path']) {
    try {
      const token = await getDropboxAccessToken()
      const rootNs = await getDropboxRootNamespaceId(token)
      const entries = await listDropboxFolder(token, rootNs, record.fields['Dropbox Folder Path'])
      files = (entries || [])
        .filter(e => e['.tag'] === 'file')
        .map(e => ({ name: e.name, size: e.size, modified: e.client_modified || e.server_modified, path: e.path_display }))
    } catch (err) {
      console.warn('[oftv-projects/:id] list folder failed:', err.message)
      files = []
    }
  }

  return NextResponse.json({ project: mapRecord(record, files) })
}

export async function PATCH(request, { params }) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await currentUser()
  const { id } = params
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const record = await fetchProject(id)
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin' || role === 'super_admin'
  const isEditor = role === 'editor'
  const isOwner = (record.fields?.['Creator'] || []).includes(user?.publicMetadata?.airtableOpsId)
  if (!isAdmin && !isEditor && !isOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const fields = {}

  // Creator can edit their own project name + instructions (only before editing starts)
  if (isOwner && !isAdmin && !isEditor) {
    const currentStatus = record.fields?.['Status'] || 'Awaiting Upload'
    if (currentStatus !== 'Awaiting Upload' && currentStatus !== 'Files Uploaded') {
      return NextResponse.json({ error: 'Cannot edit project once editing has started' }, { status: 403 })
    }
    if (body.projectName !== undefined) fields['Project Name'] = body.projectName
    if (body.instructions !== undefined) fields['Instructions'] = body.instructions
  } else {
    // Admin/editor can update more
    if (body.projectName !== undefined) fields['Project Name'] = body.projectName
    if (body.instructions !== undefined) fields['Instructions'] = body.instructions
    if (body.status !== undefined) fields['Status'] = body.status
    if (body.assignedEditor !== undefined) fields['Assigned Editor'] = body.assignedEditor
    if (body.editorNotes !== undefined) fields['Editor Notes'] = body.editorNotes
    if (body.editedFileLink !== undefined) fields['Edited File Link'] = body.editedFileLink
    if (body.adminFeedback !== undefined) fields['Admin Feedback'] = body.adminFeedback
  }

  if (!Object.keys(fields).length) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
  }

  const res = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${PROJECTS_TABLE}/${id}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ typecast: true, fields }),
    }
  )
  if (!res.ok) {
    return NextResponse.json({ error: 'Airtable update failed', detail: await res.text() }, { status: 500 })
  }
  const data = await res.json()
  return NextResponse.json({ project: mapRecord(data) })
}

export async function DELETE(_request, { params }) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await currentUser()
  const { id } = params
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const record = await fetchProject(id)
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin' || role === 'super_admin'
  const isOwner = (record.fields?.['Creator'] || []).includes(user?.publicMetadata?.airtableOpsId)
  if (!isAdmin && !isOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Close + delete the Dropbox file request so it stops accepting uploads
  const fileRequestId = record.fields?.['Dropbox File Request ID']
  if (fileRequestId) {
    try {
      const token = await getDropboxAccessToken()
      const rootNs = await getDropboxRootNamespaceId(token)
      try { await closeDropboxFileRequest(token, rootNs, fileRequestId) } catch {}
      await deleteDropboxFileRequests(token, rootNs, [fileRequestId])
    } catch (err) {
      console.warn('[oftv-projects] Failed to clean up file request on delete:', err.message)
    }
  }

  // Delete Airtable record. Folder is left intact — uploaded files stay in Dropbox.
  const delRes = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${PROJECTS_TABLE}/${id}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } }
  )
  if (!delRes.ok) {
    return NextResponse.json({ error: 'Airtable delete failed', detail: await delRes.text() }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
