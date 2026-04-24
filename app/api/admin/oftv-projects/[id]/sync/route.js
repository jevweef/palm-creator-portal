import { NextResponse } from 'next/server'
import { requireAdminOrEditor } from '@/lib/adminAuth'
import {
  getDropboxAccessToken,
  getDropboxRootNamespaceId,
  listDropboxFolder,
} from '@/lib/dropbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const PROJECTS_TABLE = 'tbl7DTdRooCsAns7j'

// Recount files in the Dropbox folder + update Airtable record.
// Creator UI can call this when the page is viewed so we don't need webhooks.
export async function POST(request, { params }) {
  try { await requireAdminOrEditor() } catch (e) {
    // Fall through — we also allow creator-initiated sync via the creator route below
    return e
  }

  const { id } = params
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  return syncProject(id)
}

export async function syncProject(id) {
  const recRes = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${PROJECTS_TABLE}/${id}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
  )
  if (!recRes.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const record = await recRes.json()
  const folderPath = record.fields?.['Dropbox Folder Path']
  if (!folderPath) return NextResponse.json({ error: 'No folder path' }, { status: 400 })

  const token = await getDropboxAccessToken()
  const rootNs = await getDropboxRootNamespaceId(token)
  let entries = []
  try {
    entries = await listDropboxFolder(token, rootNs, folderPath)
  } catch (err) {
    return NextResponse.json({ error: 'Dropbox list failed', detail: err.message }, { status: 500 })
  }

  const files = (entries || []).filter(e => e['.tag'] === 'file')
  const count = files.length
  const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0)
  const latest = files.reduce((acc, f) => {
    const t = f.client_modified || f.server_modified
    if (!t) return acc
    return !acc || t > acc ? t : acc
  }, null)

  const prevCount = record.fields?.['File Count'] || 0
  const currentStatus = record.fields?.['Status'] || 'Awaiting Upload'

  const patch = {
    'File Count': count,
    'Total Size (bytes)': totalSize,
  }
  if (latest) patch['Last File Uploaded At'] = latest
  if (count > 0 && currentStatus === 'Awaiting Upload') {
    patch['Status'] = 'Files Uploaded'
  }

  const patchRes = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${PROJECTS_TABLE}/${id}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ typecast: true, fields: patch }),
    }
  )
  if (!patchRes.ok) {
    return NextResponse.json({ error: 'Airtable patch failed', detail: await patchRes.text() }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    fileCount: count,
    totalSize,
    lastUploadedAt: latest,
    statusChanged: count > 0 && currentStatus === 'Awaiting Upload',
    newFiles: count - prevCount,
  })
}
