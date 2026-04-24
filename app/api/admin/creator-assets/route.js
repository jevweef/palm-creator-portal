import { NextResponse } from 'next/server'
import { requireAdminOrEditor } from '@/lib/adminAuth'
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
const CREATORS_TABLE = 'tbls2so6pHGbU4Uhh'

// GET /api/admin/creator-assets?creatorOpsId=recXXX           → list files
// GET /api/admin/creator-assets?creatorOpsId=recXXX&path=...  → temp link for preview
export async function GET(request) {
  try { await requireAdminOrEditor() } catch (e) { return e }

  const { searchParams } = new URL(request.url)
  const creatorOpsId = searchParams.get('creatorOpsId')
  const path = searchParams.get('path')
  if (!creatorOpsId || !/^rec[A-Za-z0-9]{14}$/.test(creatorOpsId)) {
    return NextResponse.json({ error: 'Invalid creatorOpsId' }, { status: 400 })
  }

  const recRes = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${CREATORS_TABLE}/${creatorOpsId}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
  )
  if (!recRes.ok) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
  const record = await recRes.json()
  const folderPath = record.fields?.['Long-Form Assets Folder Path'] || ''
  if (!folderPath) return NextResponse.json({ assets: [] })

  const token = await getDropboxAccessToken()
  const rootNs = await getDropboxRootNamespaceId(token)

  if (path) {
    if (!path.startsWith(folderPath + '/')) {
      return NextResponse.json({ error: 'Path not in assets folder' }, { status: 400 })
    }
    try {
      const link = await getDropboxTempLink(token, rootNs, path)
      return NextResponse.json({ link })
    } catch (err) {
      return NextResponse.json({ error: 'Failed to get link', detail: err.message }, { status: 500 })
    }
  }

  try {
    const entries = await listDropboxFolder(token, rootNs, folderPath)
    const assets = (entries || [])
      .filter(e => e['.tag'] === 'file')
      .map(e => ({ name: e.name, size: e.size, modified: e.client_modified || e.server_modified, path: e.path_display }))
    return NextResponse.json({ assets })
  } catch (err) {
    return NextResponse.json({ error: 'List failed', detail: err.message }, { status: 500 })
  }
}
