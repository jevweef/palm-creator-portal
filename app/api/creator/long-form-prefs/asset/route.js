import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import {
  getDropboxAccessToken,
  getDropboxRootNamespaceId,
  deleteDropboxPath,
  getDropboxTempLink,
} from '@/lib/dropbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const CREATORS_TABLE = 'tbls2so6pHGbU4Uhh'

async function loadCreator(creatorOpsId) {
  const res = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${CREATORS_TABLE}/${creatorOpsId}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
  )
  if (!res.ok) return null
  return res.json()
}

function authContext() {
  return auth()
}

async function permissionCheck(request, { requireOwner = false } = {}) {
  const { userId } = authContext()
  if (!userId) return { err: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const user = await currentUser()
  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin' || role === 'super_admin' || role === 'editor'

  const { searchParams } = new URL(request.url)
  const creatorOpsId = searchParams.get('creatorOpsId')
  const path = searchParams.get('path')
  if (!creatorOpsId || !/^rec[A-Za-z0-9]{14}$/.test(creatorOpsId)) {
    return { err: NextResponse.json({ error: 'Invalid creatorOpsId' }, { status: 400 }) }
  }
  if (!path) return { err: NextResponse.json({ error: 'path required' }, { status: 400 }) }

  const isOwner = user?.publicMetadata?.airtableOpsId === creatorOpsId
  if (requireOwner) {
    if (!isOwner && !(role === 'admin' || role === 'super_admin')) {
      return { err: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    }
  } else if (!isAdmin && !isOwner) {
    return { err: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  const record = await loadCreator(creatorOpsId)
  if (!record) return { err: NextResponse.json({ error: 'Creator not found' }, { status: 404 }) }

  const folderPath = record.fields?.['Long-Form Assets Folder Path'] || ''
  if (!folderPath || !path.startsWith(folderPath + '/')) {
    return { err: NextResponse.json({ error: 'Path not in assets folder' }, { status: 400 }) }
  }

  return { creatorOpsId, path, folderPath, record }
}

// GET — returns a short-lived streaming URL for previewing the asset
export async function GET(request) {
  const result = await permissionCheck(request)
  if (result.err) return result.err

  try {
    const token = await getDropboxAccessToken()
    const rootNs = await getDropboxRootNamespaceId(token)
    const link = await getDropboxTempLink(token, rootNs, result.path)
    return NextResponse.json({ link })
  } catch (err) {
    return NextResponse.json({ error: 'Failed to get link', detail: err.message }, { status: 500 })
  }
}

// DELETE — removes the asset file. Owner or admin only (editors read-only).
export async function DELETE(request) {
  const result = await permissionCheck(request, { requireOwner: true })
  if (result.err) return result.err

  try {
    const token = await getDropboxAccessToken()
    const rootNs = await getDropboxRootNamespaceId(token)
    await deleteDropboxPath(token, rootNs, result.path)
  } catch (err) {
    return NextResponse.json({ error: 'Delete failed', detail: err.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
