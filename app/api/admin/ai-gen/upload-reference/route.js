import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { requireAdminOrAiEditor } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'
import { uploadImageBytes, buildDeliveryUrl, isCloudflareImagesConfigured } from '@/lib/cloudflareImages'

export const maxDuration = 30

// Reference-image upload for the Free-form Image Generator.
//
// Why this exists (vs. reusing /api/admin/photos/upload-pinterest):
//   - Pinterest upload is requireAdmin AND tags everything Is Outfit=true,
//     Outfit Reviewed=true, Source Type=Pinterest — wrong classification
//     for a free-form gen reference.
//   - We need a path the ai_editor role can hit (the whole free-form
//     generator is editor-facing).
//   - Reference images don't need to land in the Photos library — they
//     just need a public URL Wan/Nano/GPT can fetch.
//
// Accepts a single multipart file, uploads to Dropbox at
// /Palm Ops/AI Generations/_references/{date}/{shortid}.{ext}, mirrors to
// Cloudflare Images, and returns the CF URL for the client to pass as a
// referenceUrls[] entry on the subsequent /api/admin/ai-gen call.
export async function POST(request) {
  try {
    await requireAdminOrAiEditor()

    const form = await request.formData()
    const file = form.get('file')
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'file field required (multipart)' }, { status: 400 })
    }
    const type = file.type || 'application/octet-stream'
    if (!type.startsWith('image/')) {
      return NextResponse.json({ error: 'Reference must be an image' }, { status: 400 })
    }
    // Cap at 20MB — anything larger is almost certainly not a flatlay/
    // reference shot and we don't want to spend Dropbox quota on it.
    const rawBuf = Buffer.from(await file.arrayBuffer())
    if (rawBuf.length > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'Reference image too large (max 20MB)' }, { status: 400 })
    }

    // Normalize to JPEG so consumers see consistent bytes regardless of
    // input format (PNG/HEIC/WebP — sharp handles them all).
    let buf
    let contentType = 'image/jpeg'
    try {
      buf = await sharp(rawBuf).jpeg({ quality: 92, mozjpeg: true }).toBuffer()
    } catch (e) {
      console.warn('[ai-gen/upload-reference] jpeg coerce failed, using raw:', e.message)
      buf = rawBuf
      contentType = type
    }

    const date = new Date().toISOString().slice(0, 10)
    const shortid = Math.random().toString(36).slice(2, 12)
    const dropboxPath = `/Palm Ops/AI Generations/_references/${date}/${shortid}.jpg`

    const tok = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(tok)
    await uploadToDropbox(tok, ns, dropboxPath, buf, { overwrite: true })
    let dropboxLink = ''
    try { dropboxLink = await createDropboxSharedLink(tok, ns, dropboxPath) } catch {}

    // Mirror to CF Images — that's what we hand back to the client as
    // the "reference URL" for Wan, since CF serves faster than Dropbox
    // raw under load. format=jpeg variant is forced (vs /public's auto
    // AVIF) so any downstream consumer that downloads or re-uses the
    // URL gets compatible JPEG bytes. Falls through to Dropbox raw if
    // CF Images isn't configured.
    let cdnUrl = null
    let cdnImageId = null
    if (isCloudflareImagesConfigured()) {
      try {
        const cfId = `ai-gen-ref-${date}-${shortid}`.toLowerCase().replace(/[^a-z0-9-]/g, '-')
        const r = await uploadImageBytes(buf, cfId, contentType)
        cdnImageId = r.id
        const CF_HASH = process.env.CLOUDFLARE_IMAGES_HASH
        cdnUrl = `https://imagedelivery.net/${CF_HASH}/${r.id}/format=jpeg,quality=92`
      } catch (e) {
        console.warn('[ai-gen/upload-reference] CF Images upload failed:', e.message)
      }
    }

    // Convert Dropbox shared link to raw streamable URL as the fallback.
    const dropboxRaw = dropboxLink
      ? dropboxLink.replace(/[?&]dl=[01]/g, '').replace(/[?&]raw=1/g, '').replace(/\?$/, '')
        + (dropboxLink.includes('?') ? '&raw=1' : '?raw=1')
      : null

    const referenceUrl = cdnUrl || dropboxRaw
    if (!referenceUrl) {
      return NextResponse.json({ error: 'Uploaded to Dropbox but could not produce a public URL' }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      referenceUrl,
      cdnUrl,
      cdnImageId,
      dropboxPath,
      dropboxLink: dropboxRaw,
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[ai-gen/upload-reference] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
