export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { NextResponse } from 'next/server'
import { requireAdminOrSocialMedia, patchAirtableRecord } from '@/lib/adminAuth'
import {
  getDropboxAccessToken,
  getDropboxRootNamespaceId,
  uploadToDropbox,
  createDropboxSharedLink,
  createDropboxFolder,
} from '@/lib/dropbox'

// POST /api/admin/grid-planner/post-thumbnail/:postId
// multipart/form-data: { file: <image> }
// Uploads to Dropbox, swaps the Post's Thumbnail attachment to the new image.
export async function POST(request, { params }) {
  try { await requireAdminOrSocialMedia() } catch (e) { return e }

  try {
    const formData = await request.formData()
    const file = formData.get('file')
    if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    const accessToken = await getDropboxAccessToken()
    const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)

    const folder = '/Palm Ops/Post Thumbnails'
    await createDropboxFolder(accessToken, rootNamespaceId, folder)

    const buf = Buffer.from(await file.arrayBuffer())
    const safeName = (file.name || 'thumbnail.jpg').replace(/[^\w.\-]/g, '_')
    const ts = Date.now()
    const path = `${folder}/${params.postId}-${ts}-${safeName}`
    await uploadToDropbox(accessToken, rootNamespaceId, path, buf)
    const sharedLink = await createDropboxSharedLink(accessToken, rootNamespaceId, path)
    const directUrl = sharedLink.replace('?dl=0', '?raw=1').replace('&dl=0', '&raw=1')

    // Replace the Thumbnail attachment on the Post (Airtable re-hosts on ingest)
    await patchAirtableRecord('Posts', params.postId, {
      'Thumbnail': [{ url: directUrl, filename: safeName }],
    })

    return NextResponse.json({ ok: true, url: directUrl })
  } catch (err) {
    console.error('[post-thumbnail] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
