export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { fetchHqRecord, patchHqRecord } from '@/lib/hqAirtable'
import {
  getDropboxAccessToken,
  getDropboxRootNamespaceId,
  uploadToDropbox,
  createDropboxSharedLink,
  createDropboxFolder,
} from '@/lib/dropbox'

const HQ_CREATORS_TABLE = 'tblYhkNvrNuOAHfgw'

// POST /api/admin/onboarding/:creatorId/photos
// multipart/form-data with one or more `file` entries.
// Stores each file in Dropbox at /Palm Ops/Creators/{AKA}/Profile Photos/,
// then appends attachment URLs to HQ Creators.Profile Photos.
export async function POST(request, { params }) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const creator = await fetchHqRecord(HQ_CREATORS_TABLE, params.creatorId)
    if (!creator) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
    const aka = creator.fields?.['AKA'] || creator.fields?.['Creator']
    if (!aka) return NextResponse.json({ error: 'Creator has no AKA or name' }, { status: 400 })

    const formData = await request.formData()
    const files = formData.getAll('file').filter(f => f && typeof f === 'object' && 'arrayBuffer' in f)
    if (files.length === 0) return NextResponse.json({ error: 'No files uploaded' }, { status: 400 })

    const accessToken = await getDropboxAccessToken()
    const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)

    // Ensure parent folders exist (idempotent)
    const folder = `/Palm Ops/Creators/${aka}/Profile Photos`
    await createDropboxFolder(accessToken, rootNamespaceId, `/Palm Ops/Creators/${aka}`)
    await createDropboxFolder(accessToken, rootNamespaceId, folder)

    const uploaded = []
    for (const file of files) {
      const buf = Buffer.from(await file.arrayBuffer())
      const safeName = (file.name || 'photo').replace(/[^\w.\-]/g, '_')
      const ts = Date.now()
      const path = `${folder}/${ts}-${safeName}`
      await uploadToDropbox(accessToken, rootNamespaceId, path, buf)
      const sharedLink = await createDropboxSharedLink(accessToken, rootNamespaceId, path)
      // Direct content URL for Airtable to fetch
      const directUrl = sharedLink.replace('?dl=0', '?raw=1').replace('&dl=0', '&raw=1')
      uploaded.push({ url: directUrl, filename: safeName })
    }

    // Merge with existing attachments
    const existing = (creator.fields?.['Profile Photos'] || []).map(a => ({ url: a.url, filename: a.filename }))
    const merged = [...existing, ...uploaded]

    await patchHqRecord(HQ_CREATORS_TABLE, params.creatorId, { 'Profile Photos': merged })

    return NextResponse.json({ ok: true, uploaded: uploaded.length, total: merged.length })
  } catch (err) {
    console.error('[onboarding photos upload] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE /api/admin/onboarding/:creatorId/photos?attachmentId=...
export async function DELETE(request, { params }) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { searchParams } = new URL(request.url)
    const attachmentId = searchParams.get('attachmentId')
    if (!attachmentId) return NextResponse.json({ error: 'attachmentId required' }, { status: 400 })

    const creator = await fetchHqRecord(HQ_CREATORS_TABLE, params.creatorId)
    const remaining = (creator.fields?.['Profile Photos'] || [])
      .filter(a => a.id !== attachmentId)
      .map(a => ({ id: a.id }))

    await patchHqRecord(HQ_CREATORS_TABLE, params.creatorId, { 'Profile Photos': remaining })
    return NextResponse.json({ ok: true, remaining: remaining.length })
  } catch (err) {
    console.error('[onboarding photos delete] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// GET /api/admin/onboarding/:creatorId/photos
export async function GET(_request, { params }) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const creator = await fetchHqRecord(HQ_CREATORS_TABLE, params.creatorId)
    return NextResponse.json({
      name: creator.fields?.['Creator'] || '',
      aka: creator.fields?.['AKA'] || '',
      photos: (creator.fields?.['Profile Photos'] || []).map(p => ({
        id: p.id, url: p.url, filename: p.filename,
        thumbnail: p.thumbnails?.large?.url || p.url,
      })),
    })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
