import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
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

// Creator-triggered sync. Reuses the core logic but scoped to the owner.
export async function POST(_request, { params }) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await currentUser()
  const { id } = params
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const recRes = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${PROJECTS_TABLE}/${id}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
  )
  if (!recRes.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const record = await recRes.json()

  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin' || role === 'super_admin' || role === 'editor'
  const isOwner = (record.fields?.['Creator'] || []).includes(user?.publicMetadata?.airtableOpsId)
  if (!isAdmin && !isOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

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

  const currentStatus = record.fields?.['Status'] || 'Awaiting Upload'
  const patch = {
    'File Count': count,
    'Total Size (bytes)': totalSize,
  }
  if (latest) patch['Last File Uploaded At'] = latest
  if (count > 0 && currentStatus === 'Awaiting Upload') patch['Status'] = 'Files Uploaded'

  await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${PROJECTS_TABLE}/${id}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ typecast: true, fields: patch }),
    }
  )

  return NextResponse.json({
    ok: true,
    fileCount: count,
    totalSize,
    lastUploadedAt: latest,
    status: patch['Status'] || currentStatus,
  })
}
