import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { getDropboxAccessToken, getDropboxRootNamespaceId, getDropboxTempLink } from '@/lib/dropbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const PROJECTS_TABLE = 'tbl7DTdRooCsAns7j'

// GET /api/creator/oftv-projects/[id]/file-link?path=/path/to/file.mp4
// Returns a short-lived direct streaming URL. Ownership-scoped.
export async function GET(request, { params }) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await currentUser()
  const { id } = params
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }
  const { searchParams } = new URL(request.url)
  const path = searchParams.get('path')
  if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 })

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

  // Path must be inside this project's folder — prevent arbitrary file access via this endpoint
  const folderPath = record.fields?.['Dropbox Folder Path'] || ''
  if (!folderPath || !path.startsWith(folderPath + '/')) {
    return NextResponse.json({ error: 'Path not in project folder' }, { status: 400 })
  }

  try {
    const token = await getDropboxAccessToken()
    const rootNs = await getDropboxRootNamespaceId(token)
    const link = await getDropboxTempLink(token, rootNs, path)
    return NextResponse.json({ link })
  } catch (err) {
    return NextResponse.json({ error: 'Failed to get link', detail: err.message }, { status: 500 })
  }
}
