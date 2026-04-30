export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { NextResponse } from 'next/server'
import { requireAdminOrSocialMedia, patchAirtableRecord, fetchAirtableRecords } from '@/lib/adminAuth'
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
    // Airtable ingests image URLs by fetching them. www.dropbox.com URLs with
    // ?raw=1 sometimes return HTML wrappers depending on the team namespace.
    // dl.dropboxusercontent.com serves the bytes directly — the canonical way.
    const directUrl = (() => {
      try {
        const u = new URL(sharedLink)
        u.host = 'dl.dropboxusercontent.com'
        u.searchParams.delete('dl')
        u.searchParams.delete('raw')
        return u.toString()
      } catch {
        return sharedLink
      }
    })()

    // A single Asset/Task fans out into N sibling Post records (one per
    // managed IG account — typically 3 for Sunny/Taby). Replacing the
    // thumbnail on one cell while the other two keep the broken/old image
    // is confusing and useless. So: find every Post sharing this Post's
    // Task and patch them all in one shot. Also patch the Asset.Thumbnail
    // so future fan-outs of the same asset start from the new image.
    const sourceList = await fetchAirtableRecords('Posts', {
      filterByFormula: `RECORD_ID()='${params.postId}'`,
      fields: ['Task', 'Asset'],
    })
    const source = sourceList[0]?.fields || {}
    const taskId = (source.Task || [])[0] || null
    const assetId = (source.Asset || [])[0] || null

    let siblingIds = [params.postId]
    if (taskId) {
      const siblings = await fetchAirtableRecords('Posts', {
        filterByFormula: `FIND('${taskId}', ARRAYJOIN({Task}))`,
        fields: ['Task'],
      })
      const ids = siblings.map(s => s.id).filter(Boolean)
      if (ids.length) siblingIds = Array.from(new Set([params.postId, ...ids]))
    }

    // Build an Airtable attachment payload. Critical: filename: 'thumbnail.jpg'
    // — without an extension Airtable ingests the bytes but the attachment
    // serves with no content-type and breaks in browsers. Same lesson as
    // buildClonedThumbnail in grid-planner/route.js.
    const attachment = [{ url: directUrl, filename: 'thumbnail.jpg' }]

    // Patch all sibling Posts in parallel — this is a small fan-out (≤4
    // accounts) so it stays well under Airtable's 5 req/sec cap.
    await Promise.all(siblingIds.map(id =>
      patchAirtableRecord('Posts', id, { 'Thumbnail': attachment })
    ))

    // Refresh the source-of-truth on the Asset so future clones via
    // buildClonedThumbnail start from the new image. Best-effort —
    // failure here doesn't roll back the Post updates.
    if (assetId) {
      try {
        await patchAirtableRecord('Assets', assetId, { 'Thumbnail': attachment })
      } catch (e) {
        console.warn('[post-thumbnail] Asset.Thumbnail update failed:', e.message)
      }
    }

    return NextResponse.json({ ok: true, url: directUrl, postIds: siblingIds })
  } catch (err) {
    console.error('[post-thumbnail] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
