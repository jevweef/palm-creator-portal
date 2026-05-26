import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { auth } from '@clerk/nextjs/server'
import { requireAdminOrAiEditor, createAirtableRecord } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'
import { uploadImageBytes, isCloudflareImagesConfigured } from '@/lib/cloudflareImages'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// AI Carousel slide upload. One image per request — client generates a
// shared `batchId` and calls this endpoint once per slide, then either
// triggers no follow-up or polls /carousel-submissions to confirm Pending
// rows appeared. Each upload creates a Photos record (Source Type=AI
// Generated, Review Status=Pending, Submission Batch ID, Creator linked)
// so admins see the batch in their For Review tab.
//
// Body (multipart):
//   file:            image bytes (single image)
//   creatorId:       string (Palm Creator record ID, required)
//   batchId:         string (client-generated, shared across all slides
//                    in this carousel submission, required)
//   slideIndex:      1-based slide number (for ordered filename)
//   submissionTitle: optional human-readable label
export async function POST(request) {
  try {
    await requireAdminOrAiEditor()

    const form = await request.formData()
    const file = form.get('file')
    const creatorId = form.get('creatorId')
    const batchId = form.get('batchId')
    const slideIndex = parseInt(form.get('slideIndex') || '1', 10)
    const submissionTitle = (form.get('submissionTitle') || '').toString().trim()

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'file field required (multipart)' }, { status: 400 })
    }
    if (!creatorId || typeof creatorId !== 'string' || !/^rec[A-Za-z0-9]{14}$/.test(creatorId)) {
      return NextResponse.json({ error: 'valid creatorId required' }, { status: 400 })
    }
    if (!batchId || typeof batchId !== 'string' || batchId.length < 8) {
      return NextResponse.json({ error: 'batchId required (client-generated, ≥8 chars)' }, { status: 400 })
    }
    const type = file.type || 'application/octet-stream'
    if (!type.startsWith('image/')) {
      return NextResponse.json({ error: 'File must be an image' }, { status: 400 })
    }
    const rawBuf = Buffer.from(await file.arrayBuffer())
    if (rawBuf.length > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image too large (max 20MB)' }, { status: 400 })
    }

    // Normalize to JPEG via sharp — handles HEIC/PNG/WebP consistently +
    // strips EXIF orientation so portrait shots don't show sideways.
    let buf = rawBuf
    let contentType = 'image/jpeg'
    try {
      buf = await sharp(rawBuf).rotate().jpeg({ quality: 92, mozjpeg: true }).toBuffer()
    } catch (e) {
      console.warn('[carousel-upload] jpeg coerce failed, using raw:', e.message)
      contentType = type
    }

    const date = new Date().toISOString().slice(0, 10)
    const safeBatchId = batchId.replace(/[^a-zA-Z0-9_-]+/g, '')
    const dropboxPath = `/Palm Ops/AI Carousel Uploads/${date}/${safeBatchId}/slide_${String(slideIndex).padStart(2, '0')}.jpg`

    const tok = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(tok)
    await uploadToDropbox(tok, ns, dropboxPath, buf, { overwrite: true })
    let dropboxLink = ''
    try { dropboxLink = await createDropboxSharedLink(tok, ns, dropboxPath) } catch {}
    const dropboxRaw = dropboxLink
      ? dropboxLink.replace(/[?&]dl=[01]/g, '').replace(/[?&]raw=1/g, '').replace(/\?$/, '')
        + (dropboxLink.includes('?') ? '&raw=1' : '?raw=1')
      : null

    // Mirror to Cloudflare Images so the For Review tab + Carousels picker
    // load fast. Falls back to Dropbox raw URL if CF isn't configured.
    let cdnUrl = null
    if (isCloudflareImagesConfigured()) {
      try {
        const cfId = `ai-carousel-${safeBatchId}-${slideIndex}`.toLowerCase().replace(/[^a-z0-9-]/g, '-')
        const r = await uploadImageBytes(buf, cfId, contentType)
        const CF_HASH = process.env.CLOUDFLARE_IMAGES_HASH
        cdnUrl = `https://imagedelivery.net/${CF_HASH}/${r.id}/format=jpeg,quality=92`
      } catch (e) {
        console.warn('[carousel-upload] CF Images upload failed:', e.message)
      }
    }

    // Capture uploader for the For Review tab to display + audit trail.
    let uploadedBy = ''
    try {
      const { userId } = auth()
      if (userId) uploadedBy = userId
    } catch {}

    const photoFields = {
      'Source Type': 'AI Generated',
      'Creator': [creatorId],
      'Review Status': 'Pending',
      'Submission Batch ID': batchId,
      'Carousel Index': slideIndex,
    }
    if (uploadedBy) photoFields['Uploaded By'] = uploadedBy
    if (submissionTitle) photoFields['Submission Title'] = submissionTitle
    if (cdnUrl) photoFields['CDN URL'] = cdnUrl
    if (dropboxRaw) photoFields['Dropbox Link'] = dropboxRaw
    photoFields['Dropbox Path'] = dropboxPath
    // Image attachment via URL — Airtable will ingest the bytes async.
    // Prefer CF (fast, stable) over Dropbox raw which can change.
    const attachmentUrl = cdnUrl || dropboxRaw
    if (attachmentUrl) photoFields['Image'] = [{ url: attachmentUrl }]

    const rec = await createAirtableRecord('Photos', photoFields, { typecast: true })

    return NextResponse.json({
      ok: true,
      photoId: rec.id,
      cdnUrl,
      dropboxPath,
      dropboxLink: dropboxRaw,
      batchId,
      slideIndex,
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[carousel-upload] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
