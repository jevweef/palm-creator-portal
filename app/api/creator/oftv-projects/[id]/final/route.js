import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import {
  getDropboxAccessToken,
  getDropboxRootNamespaceId,
  listDropboxFolder,
  getDropboxTempLink,
} from '@/lib/dropbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const PROJECTS_TABLE = 'tbl7DTdRooCsAns7j'

// Creator-side read of the final cut delivery folder.
// Mirrors the admin endpoint but enforces ownership instead of admin/editor.
// Used by the creator's project detail modal to preview the approved cut.
export async function GET(request, { params }) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  const user = await currentUser()
  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin' || role === 'super_admin' || role === 'editor'
  const ownerOpsId = user?.publicMetadata?.airtableOpsId
  const isOwner = (record.fields?.['Creator'] || []).includes(ownerOpsId)
  if (!isAdmin && !isOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const folderPath = record.fields?.['Final Folder Path']
  if (!folderPath) {
    // No final folder yet means nothing to show — empty list, not an error.
    return NextResponse.json({ files: [] })
  }

  const { searchParams } = new URL(request.url)
  const previewPath = searchParams.get('path')

  const token = await getDropboxAccessToken()
  const rootNs = await getDropboxRootNamespaceId(token)

  if (previewPath) {
    if (!previewPath.startsWith(folderPath + '/')) {
      return NextResponse.json({ error: 'Path not in final folder' }, { status: 400 })
    }
    try {
      const link = await getDropboxTempLink(token, rootNs, previewPath)
      return NextResponse.json({ link })
    } catch (err) {
      return NextResponse.json({ error: 'Temp link failed', detail: err.message }, { status: 500 })
    }
  }

  let files = []
  try {
    const entries = await listDropboxFolder(token, rootNs, folderPath)
    files = (entries || [])
      .filter(e => e['.tag'] === 'file')
      .map(e => ({ name: e.name, size: e.size, modified: e.client_modified || e.server_modified, path: e.path_display }))
      .sort((a, b) => (b.modified || '').localeCompare(a.modified || ''))
  } catch (err) {
    console.warn('[creator/oftv/final] list failed:', err.message)
  }

  return NextResponse.json({ files })
}
