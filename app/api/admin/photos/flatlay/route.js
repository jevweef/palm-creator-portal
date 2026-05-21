import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'
import { submitWaveSpeedTask, pollWaveSpeedTask } from '@/lib/wavespeed'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, downloadFromDropbox } from '@/lib/dropbox'
import { uploadImageBytes, buildDeliveryUrl, isCloudflareImagesConfigured } from '@/lib/cloudflareImages'

export const dynamic = 'force-dynamic'
// Nano Banana edits typically finish in 10–30s. 90s leaves comfortable
// headroom for the Dropbox + CF mirror at the end without bumping into
// Vercel's hard 300s ceiling.
export const maxDuration = 90

const PHOTOS = 'Photos'
const EDIT_MODEL = 'google/nano-banana-2/edit'

// Product-flatlay prompt. Tuned for e-commerce style: clothes only,
// laid out separately on a clean white seamless background, no person,
// no sunglasses. Phrased as a transformation directive so the editor
// model knows to discard the original scene.
const FLATLAY_PROMPT = (
  'Transform this photo into a clean product-flatlay photography image, '
  + 'styled like an e-commerce listing on Net-A-Porter, Revolve, or Zara. '
  + 'Background: pure white seamless studio background, soft even shadowless lighting. '
  + 'Subject: ONLY the clothing items the person is wearing in the original photo, '
  + 'arranged neatly as a coordinated flat-lay — each piece laid out separately and '
  + 'visible (top, bottom, dress, outerwear, shoes, jewelry, etc.) so a shopper could '
  + 'identify every piece. Maintain the exact same colors, textures, materials, '
  + 'prints, patterns, and details of every garment. Photoreal, sharp focus, '
  + 'overhead or slightly angled product-shot perspective. '
  + 'Do NOT include: the person/model, body parts, the original background, '
  + 'sunglasses, phones, water bottles, drinks, bags, cars, walls, plants, or any '
  + 'environmental context — clothing items only on white.'
)

// POST { photoId } — generate a flatlay for one Photos row. Writes
// `Flatlay Status = Generating` immediately, polls WaveSpeed, then on
// completion downloads the output, uploads to Dropbox + Cloudflare
// Images, and patches the record with CDN + path + Status=Done.
//
// On failure the record gets `Flatlay Status = Failed` so the UI can
// surface a retry button and the run is debuggable via Prediction ID.
export async function POST(request) {
  let photoId = null
  try {
    await requireAdmin()
    const body = await request.json()
    photoId = String(body.photoId || '')
    if (!photoId || !/^rec[A-Za-z0-9]{14}$/.test(photoId)) {
      return NextResponse.json({ error: 'Valid photoId required' }, { status: 400 })
    }

    // Load the photo. Prefer CDN URL as the source for WaveSpeed (it's
    // a public Cloudflare URL — no auth, fastest to fetch). Fall back
    // to Dropbox-proxied bytes if the row hasn't been CF-mirrored yet.
    const rows = await fetchAirtableRecords(PHOTOS, {
      fields: ['Source Handle', 'Source Post URL', 'Carousel Index', 'CDN URL', 'Dropbox Path', 'Is Outfit'],
      filterByFormula: `RECORD_ID() = '${photoId}'`,
    })
    if (!rows.length) return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
    const f = rows[0].fields || {}
    const handle = (f['Source Handle'] || 'unknown').replace(/[^A-Za-z0-9_-]+/g, '-').toLowerCase()
    const postUrl = f['Source Post URL'] || ''
    const idx = f['Carousel Index'] || 1
    const code = postUrl.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/)?.[1] || photoId.slice(3)
    const cdnUrl = f['CDN URL'] || ''
    const dropboxPath = f['Dropbox Path'] || ''
    if (!cdnUrl && !dropboxPath) {
      return NextResponse.json({ error: 'Photo has no source bytes (no CDN URL, no Dropbox path)' }, { status: 400 })
    }

    // Flip status to Generating so the UI updates immediately while
    // WaveSpeed chews on it. Any client polling the row will see this
    // and render a spinner.
    await patchAirtableRecord(PHOTOS, photoId, { 'Flatlay Status': 'Generating' }, { typecast: true })

    // WaveSpeed needs a publicly fetchable URL. If we don't have a CDN
    // URL yet, fall back to our Dropbox proxy (server-side fetched +
    // re-served with correct MIME). The proxy URL needs to be absolute
    // for WaveSpeed to reach it from outside our domain.
    const origin = new URL(request.url).origin
    const sourceImageUrl = cdnUrl
      ? cdnUrl
      : `${origin}/api/admin/photos/image?path=${encodeURIComponent(dropboxPath)}`

    let task
    try {
      task = await submitWaveSpeedTask(EDIT_MODEL, {
        images: [sourceImageUrl],
        prompt: FLATLAY_PROMPT,
        aspect_ratio: '1:1',     // product shots read best square; flatlays aren't 9:16
        resolution: '2k',
        output_format: 'jpeg',
      })
    } catch (e) {
      await patchAirtableRecord(PHOTOS, photoId, { 'Flatlay Status': 'Failed' }, { typecast: true })
      throw new Error(`WaveSpeed submit failed: ${e.message}`)
    }
    const predictionId = task?.id || ''
    if (predictionId) {
      await patchAirtableRecord(PHOTOS, photoId, { 'Flatlay Prediction ID': predictionId }, { typecast: true })
    }

    // Poll until done. Cap at 80s so we leave time for the Dropbox +
    // CF upload before the 90s maxDuration kicks in.
    const t0 = Date.now()
    let outputUrl = null
    let lastError = null
    while (Date.now() - t0 < 80000) {
      const d = await pollWaveSpeedTask(task.id)
      if (d.status === 'completed') {
        outputUrl = (d.outputs || [])[0]
        if (!outputUrl) { lastError = 'WaveSpeed completed with no outputs'; break }
        break
      }
      if (d.status === 'failed') { lastError = d.error || 'WaveSpeed reported failed'; break }
      await new Promise(r => setTimeout(r, 2500))
    }
    if (!outputUrl) {
      await patchAirtableRecord(PHOTOS, photoId, { 'Flatlay Status': 'Failed' }, { typecast: true })
      return NextResponse.json({ error: lastError || 'Flatlay generation timed out' }, { status: 504 })
    }

    // Pull the rendered image bytes once, then push to both Dropbox
    // (canonical store) and Cloudflare Images (fast delivery).
    const ir = await fetch(outputUrl)
    if (!ir.ok) {
      await patchAirtableRecord(PHOTOS, photoId, { 'Flatlay Status': 'Failed' }, { typecast: true })
      return NextResponse.json({ error: `Couldn't fetch flatlay output: HTTP ${ir.status}` }, { status: 502 })
    }
    const buf = Buffer.from(await ir.arrayBuffer())

    const tok = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(tok)
    const dbxPath = `/Palm Ops/Photos/Flatlays/${handle}/${code}_${String(idx).padStart(2, '0')}_flatlay.jpg`
    try {
      await uploadToDropbox(tok, ns, dbxPath, buf, { overwrite: true })
    } catch (e) {
      // Non-fatal — CF mirror below is the actual delivery path. Log
      // and keep going so the editor still sees the result.
      console.warn(`[photos/flatlay] Dropbox upload failed for ${dbxPath}:`, e.message)
    }

    let flatlayCdnUrl = null
    if (isCloudflareImagesConfigured()) {
      const cfId = `flatlay-${handle}-${code}-${String(idx).padStart(2, '0')}`.toLowerCase().replace(/[^a-z0-9-]/g, '-')
      try {
        const r = await uploadImageBytes(buf, cfId)
        flatlayCdnUrl = buildDeliveryUrl(r.id, 'public')
      } catch (e) {
        console.warn(`[photos/flatlay] CF Images upload failed:`, e.message)
      }
    }

    const patch = {
      'Flatlay Status': 'Done',
      'Flatlay Dropbox Path': dbxPath,
      ...(flatlayCdnUrl ? { 'Flatlay CDN URL': flatlayCdnUrl } : {}),
    }
    await patchAirtableRecord(PHOTOS, photoId, patch, { typecast: true })

    return NextResponse.json({
      ok: true,
      photoId,
      flatlayCdnUrl,
      flatlayDropboxPath: dbxPath,
      predictionId,
    })
  } catch (err) {
    if (err instanceof Response) return err
    const msg = typeof err?.message === 'string' && err.message ? err.message : String(err)
    console.error('[photos/flatlay] error:', msg)
    if (photoId && /^rec[A-Za-z0-9]{14}$/.test(photoId)) {
      try { await patchAirtableRecord(PHOTOS, photoId, { 'Flatlay Status': 'Failed' }, { typecast: true }) } catch {}
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
