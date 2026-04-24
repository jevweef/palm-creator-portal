import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import {
  getDropboxAccessToken,
  getDropboxRootNamespaceId,
  createDropboxFolder,
  listDropboxFolder,
} from '@/lib/dropbox'
import { createDropboxFileRequest } from '@/lib/dropboxFileRequests'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const CREATORS_TABLE = 'tbls2so6pHGbU4Uhh'

function sanitize(s) {
  return String(s || '').replace(/[\/\\:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
}

async function resolveAuth(request) {
  const { userId } = auth()
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const user = await currentUser()
  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin' || role === 'super_admin' || role === 'editor'

  const { searchParams } = new URL(request.url)
  const creatorOpsId = searchParams.get('creatorOpsId')
  if (!creatorOpsId || !/^rec[A-Za-z0-9]{14}$/.test(creatorOpsId)) {
    return { error: NextResponse.json({ error: 'Invalid creatorOpsId' }, { status: 400 }) }
  }
  if (!isAdmin && user?.publicMetadata?.airtableOpsId !== creatorOpsId) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { creatorOpsId, isAdmin, isOwner: user?.publicMetadata?.airtableOpsId === creatorOpsId }
}

async function fetchCreator(id) {
  const res = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${CREATORS_TABLE}/${id}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
  )
  if (!res.ok) return null
  return res.json()
}

async function patchCreator(id, fields) {
  return fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${CREATORS_TABLE}/${id}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    }
  )
}

// Lazy-init the brand assets folder + file request. Idempotent.
async function ensureAssetsSetup(creatorRecord) {
  const f = creatorRecord.fields || {}
  const aka = f['AKA'] || f['Creator'] || 'Unknown'
  const existingPath = f['Long-Form Assets Folder Path']
  const existingUrl = f['Long-Form Assets File Request URL']
  if (existingPath && existingUrl) {
    return { folderPath: existingPath, fileRequestUrl: existingUrl, fileRequestId: f['Long-Form Assets File Request ID'] || '' }
  }

  const folderPath = existingPath || `/Palm Ops/Creators/${sanitize(aka)}/Long Form/_Brand Assets`
  const token = await getDropboxAccessToken()
  const rootNs = await getDropboxRootNamespaceId(token)

  if (!existingPath) {
    try { await createDropboxFolder(token, rootNs, folderPath) } catch (err) {
      console.warn('[long-form-prefs] folder create failed:', err.message)
    }
  }

  let fileRequestUrl = existingUrl || ''
  let fileRequestId = f['Long-Form Assets File Request ID'] || ''
  if (!fileRequestUrl) {
    try {
      const fr = await createDropboxFileRequest(token, rootNs, {
        title: `${aka} — Long-Form Brand Assets`,
        destination: folderPath,
      })
      fileRequestUrl = fr.url
      fileRequestId = fr.id
    } catch (err) {
      console.warn('[long-form-prefs] file request create failed:', err.message)
    }
  }

  // Persist
  await patchCreator(creatorRecord.id, {
    'Long-Form Assets Folder Path': folderPath,
    'Long-Form Assets File Request URL': fileRequestUrl,
    'Long-Form Assets File Request ID': fileRequestId,
  })

  return { folderPath, fileRequestUrl, fileRequestId }
}

async function listAssets(folderPath) {
  if (!folderPath) return []
  try {
    const token = await getDropboxAccessToken()
    const rootNs = await getDropboxRootNamespaceId(token)
    const entries = await listDropboxFolder(token, rootNs, folderPath)
    return (entries || [])
      .filter(e => e['.tag'] === 'file')
      .map(e => ({ name: e.name, size: e.size, modified: e.client_modified || e.server_modified, path: e.path_display }))
  } catch (err) {
    console.warn('[long-form-prefs] list assets failed:', err.message)
    return []
  }
}

export async function GET(request) {
  const { error, creatorOpsId } = await resolveAuth(request)
  if (error) return error

  const record = await fetchCreator(creatorOpsId)
  if (!record) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })

  // Lazy setup assets folder — only for owners/admins, editors read-only
  const { searchParams } = new URL(request.url)
  const skipInit = searchParams.get('skipInit') === '1'
  let assetsInfo = {
    folderPath: record.fields?.['Long-Form Assets Folder Path'] || '',
    fileRequestUrl: record.fields?.['Long-Form Assets File Request URL'] || '',
    fileRequestId: record.fields?.['Long-Form Assets File Request ID'] || '',
  }
  if (!skipInit && (!assetsInfo.folderPath || !assetsInfo.fileRequestUrl)) {
    assetsInfo = await ensureAssetsSetup(record)
  }

  const assets = await listAssets(assetsInfo.folderPath)

  return NextResponse.json({
    longFormPrefs: record.fields?.['Long-Form Editing Preferences'] || '',
    assetsFolderPath: assetsInfo.folderPath,
    assetsFileRequestUrl: assetsInfo.fileRequestUrl,
    assets,
  })
}

export async function PATCH(request) {
  const { error, creatorOpsId } = await resolveAuth(request)
  if (error) return error

  const body = await request.json()
  const prefs = typeof body.longFormPrefs === 'string' ? body.longFormPrefs : ''

  const res = await patchCreator(creatorOpsId, { 'Long-Form Editing Preferences': prefs })
  if (!res.ok) {
    return NextResponse.json({ error: 'Update failed', detail: await res.text() }, { status: 500 })
  }
  return NextResponse.json({ ok: true, longFormPrefs: prefs })
}
