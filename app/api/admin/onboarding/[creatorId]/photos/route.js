export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { fetchHqRecord, patchHqRecord } from '@/lib/hqAirtable'
import {
  getDropboxAccessToken,
  getDropboxRootNamespaceId,
  createDropboxSharedLink,
  createDropboxFolder,
  listDropboxFolder,
  getDropboxTemporaryUploadLink,
  deleteDropboxPath,
} from '@/lib/dropbox'

const HQ_CREATORS_TABLE = 'tblYhkNvrNuOAHfgw'
const IMG_RE = /\.(jpe?g|png|webp|gif|heic)$/i
const rawUrl = (u) => u.replace('?dl=0', '?raw=1').replace('&dl=0', '&raw=1')
const safe = (n) => String(n || 'photo').replace(/[^\w.\-]/g, '_')

async function creatorFolder(creatorId) {
  const creator = await fetchHqRecord(HQ_CREATORS_TABLE, creatorId)
  if (!creator) return { error: 'Creator not found', status: 404 }
  const aka = creator.fields?.['AKA'] || creator.fields?.['Creator']
  if (!aka) return { error: 'Creator has no AKA or name', status: 400 }
  // Reference photos live in the creator's canonical "Profile Pictures" folder
  // (same one SMM + the Multi-Link picker read), NOT a separate "Profile Photos".
  return { creator, aka, folder: `/Palm Ops/Creators/${aka}/Profile Pictures` }
}

// List image files in the folder (+ one level of subfolders like Current/Archive),
// each with a persistent shared-link URL — this is the source of truth for display,
// so it never depends on Airtable ingesting the URL.
async function listPhotos(token, ns, folder) {
  const top = await listDropboxFolder(token, ns, folder)
  const files = []
  for (const e of top) if (e['.tag'] === 'file' && IMG_RE.test(e.name)) files.push({ name: e.name, path: `${folder}/${e.name}` })
  for (const e of top.filter((x) => x['.tag'] === 'folder')) {
    const inner = await listDropboxFolder(token, ns, `${folder}/${e.name}`)
    for (const f of inner) if (f['.tag'] === 'file' && IMG_RE.test(f.name)) files.push({ name: f.name, path: `${folder}/${e.name}/${f.name}` })
  }
  const photos = []
  for (const f of files.slice(0, 60)) {
    try {
      const link = await createDropboxSharedLink(token, ns, f.path)
      photos.push({ id: f.path, url: rawUrl(link), filename: f.name, thumbnail: rawUrl(link) })
    } catch { /* skip a file that won't share */ }
  }
  return photos
}

// POST ?step=prepare  { filenames:[...] }  -> [{ filename, path, uploadUrl }]
//   Returns short-lived Dropbox upload links the BROWSER posts each file to
//   directly (bypasses Vercel's ~4.5 MB body cap; handles HEIC/any size).
// POST ?step=finalize { paths:[...] }       -> { ok, photos }
//   After the browser finishes uploading, mirror the URLs into the Airtable
//   "Profile Photos" attachment field (SMM consumes it) and return the list.
export async function POST(request, { params }) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const step = new URL(request.url).searchParams.get('step') || 'prepare'
    const info = await creatorFolder(params.creatorId)
    if (info.error) return NextResponse.json({ error: info.error }, { status: info.status })
    const token = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(token)
    const body = await request.json().catch(() => ({}))

    if (step === 'prepare') {
      const filenames = Array.isArray(body.filenames) ? body.filenames.slice(0, 20) : []
      if (!filenames.length) return NextResponse.json({ error: 'No filenames' }, { status: 400 })
      await createDropboxFolder(token, ns, `/Palm Ops/Creators/${info.aka}`).catch(() => {})
      await createDropboxFolder(token, ns, info.folder).catch(() => {})
      const ts = Date.now()
      const targets = []
      for (let i = 0; i < filenames.length; i++) {
        const path = `${info.folder}/${ts}-${i}-${safe(filenames[i])}`
        const uploadUrl = await getDropboxTemporaryUploadLink(token, ns, path)
        targets.push({ filename: filenames[i], path, uploadUrl })
      }
      return NextResponse.json({ targets })
    }

    // finalize
    const paths = Array.isArray(body.paths) ? body.paths : []
    const attach = []
    for (const p of paths) {
      try {
        const link = await createDropboxSharedLink(token, ns, p)
        attach.push({ url: rawUrl(link), filename: p.split('/').pop() })
      } catch { /* skip */ }
    }
    if (attach.length) {
      const existing = (info.creator.fields?.['Profile Photos'] || []).map((a) => ({ url: a.url, filename: a.filename }))
      await patchHqRecord(HQ_CREATORS_TABLE, params.creatorId, { 'Profile Photos': [...existing, ...attach] }).catch(() => {})
    }
    const photos = await listPhotos(token, ns, info.folder)
    return NextResponse.json({ ok: true, uploaded: attach.length, photos })
  } catch (err) {
    console.error('[onboarding photos] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE ?path=<dropbox path> — removes the file from Dropbox + the Airtable field.
export async function DELETE(request, { params }) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const path = new URL(request.url).searchParams.get('path')
    if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 })
    const info = await creatorFolder(params.creatorId)
    if (info.error) return NextResponse.json({ error: info.error }, { status: info.status })
    const token = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(token)
    await deleteDropboxPath(token, ns, path).catch(() => {})
    // Best-effort: drop any Airtable attachment whose filename matches.
    const fname = path.split('/').pop()
    const remaining = (info.creator.fields?.['Profile Photos'] || []).filter((a) => a.filename !== fname).map((a) => ({ id: a.id }))
    await patchHqRecord(HQ_CREATORS_TABLE, params.creatorId, { 'Profile Photos': remaining }).catch(() => {})
    const photos = await listPhotos(token, ns, info.folder)
    return NextResponse.json({ ok: true, photos })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// GET — list the creator's profile photos straight from the Dropbox folder.
export async function GET(_request, { params }) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const info = await creatorFolder(params.creatorId)
    if (info.error) return NextResponse.json({ error: info.error }, { status: info.status })
    const token = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(token)
    const photos = await listPhotos(token, ns, info.folder)
    return NextResponse.json({ name: info.creator.fields?.['Creator'] || '', aka: info.aka, folder: info.folder, photos })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
