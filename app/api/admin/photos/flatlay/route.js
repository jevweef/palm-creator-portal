import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'
import { submitWaveSpeedTask, pollWaveSpeedTask } from '@/lib/wavespeed'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, downloadFromDropbox } from '@/lib/dropbox'
import { uploadImageBytes, buildDeliveryUrl, isCloudflareImagesConfigured } from '@/lib/cloudflareImages'
import { fetchPostHdUrls } from '@/lib/instagramHd'

export const dynamic = 'force-dynamic'
// Nano Banana edits typically finish in 10–30s. 90s leaves comfortable
// headroom for the Dropbox + CF mirror at the end without bumping into
// Vercel's hard 300s ceiling.
export const maxDuration = 90

const PHOTOS = 'Photos'

// Selectable WaveSpeed models for flatlay generation. Each takes an
// images[] + prompt; param schemas mirror their Stage B counterparts.
// Default is nano-banana (cheap, fast, good at clothing detail);
// editor can switch to wan or gpt for comparison.
const MODELS = {
  nano: { label: 'Nano-Banana 2', path: 'google/nano-banana-2/edit',
    body: (images, prompt) => ({ images, prompt, aspect_ratio: '1:1', resolution: '2k', output_format: 'jpeg' }) },
  wan: { label: 'Wan 2.7 image-edit-pro', path: 'alibaba/wan-2.7/image-edit-pro',
    body: (images, prompt) => ({ images, prompt, size: '1080*1080' }) },
  gpt: { label: 'GPT-Image-2', path: 'openai/gpt-image-2/edit',
    body: (images, prompt) => ({ images, prompt, aspect_ratio: '1:1', resolution: '2k', quality: 'high' }) },
}

// Product-flatlay prompt. Tuned to:
//   • Reconstruct the garment in its natural symmetric shape (strap
//     lengths matched, hem aligned, no pose-induced distortion)
//   • Preserve fabric quality / sheen / weight — the original was
//     coming out looking matte and cheap; reference the actual
//     material texture from the source photo
//   • Show each piece laid as if hanging on a hanger then placed flat
//     on a surface — no hanger visible, no mannequin, no model
//   • Strictly no store tags, brand labels, price tags
const FLATLAY_PROMPT = (
  'Transform this photo into a clean product-flatlay photography image. '
  + 'Background: pure white seamless studio surface, soft even shadowless lighting, '
  + 'overhead or slightly angled top-down perspective. '
  + 'Subject: ONLY the clothing items the person is wearing in the original photo, '
  + 'arranged neatly as a coordinated flat-lay — each piece laid out separately so '
  + 'a viewer could identify every garment (top, bottom, dress, outerwear, shoes, '
  + 'jewelry where applicable).\n\n'
  + 'CRITICAL — reconstruct each garment in its natural, symmetric, off-body shape, '
  + 'as if it were hanging on a hanger then laid flat on the surface (no hanger, no '
  + 'mannequin, no body visible). Pose-induced asymmetry in the source (one strap '
  + 'pulled down, fabric bunched against the body, hem twisted by sitting/leaning) '
  + 'should be IGNORED — assume the garment is symmetric and well-constructed: '
  + 'matching strap lengths, even shoulder seams, level hem, undistorted silhouette. '
  + 'Infer the typical cut from the visible portion if part of the garment is '
  + 'hidden behind the body. Do not invent unusual asymmetric design unless the '
  + 'garment is clearly intentionally asymmetric (e.g. a one-shoulder dress).\n\n'
  + 'Preserve the EXACT same fabric, material, weight, sheen, drape, color, prints, '
  + 'patterns, and stitching detail as the original — match the texture and quality '
  + 'of the source garment (silk should look like silk, ribbed knit should look '
  + 'ribbed, sheer should stay sheer). Do NOT cheapen or flatten the material. '
  + 'Photoreal, sharp focus, high detail.\n\n'
  + 'STRICTLY exclude everything that is NOT a garment the subject is wearing: '
  + 'the person/model, body parts, original background, sunglasses, phones, '
  + 'drinks, bags, jewelry not visibly on the subject, environmental textiles '
  + '(towels, blankets, sheets, pillows, robes laid on a surface, beach throws, '
  + 'rugs, sarongs draped on furniture), furniture, plants. Also exclude store '
  + 'or brand tags, price tags, hang tags, swing tags, size labels, hangers, '
  + 'mannequins, rulers, or any commercial-listing decorations. Only items '
  + 'actually worn by the person belong in the flatlay — if it is on a chair, '
  + 'a bed, the floor, or behind the subject, omit it.'
)

// POST { photoId, model? } — generate a flatlay for one Photos row.
// `model` is 'nano' (default), 'wan', or 'gpt'. Writes
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
    const modelKey = MODELS[body.model] ? body.model : 'nano'
    const mdl = MODELS[modelKey]

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

    // Source for WaveSpeed: always try to grab a fresh 1080w HD URL
    // straight from Instagram first — the CDN copy may still be the
    // ~480w feed thumbnail if this row was imported before the HD-on-
    // import fix and hasn't been upgraded yet. More pixels at the input
    // = the model has more fabric texture / silhouette detail to read
    // from, which directly affects how well the flatlay matches.
    //
    // Falls back to CDN URL (if HD lookup misses, e.g. post deleted or
    // rate-limited), then to the Dropbox proxy as a last resort.
    const origin = new URL(request.url).origin
    let sourceImageUrl = null
    let sourceVariant = 'unknown'
    try {
      const hdMap = await fetchPostHdUrls(code)
      const hdUrl = hdMap?.get(idx)
      if (hdUrl) { sourceImageUrl = hdUrl; sourceVariant = 'ig-1080w' }
    } catch (e) { console.warn('[photos/flatlay] HD lookup failed:', e.message) }
    if (!sourceImageUrl && cdnUrl) { sourceImageUrl = cdnUrl; sourceVariant = 'cdn' }
    if (!sourceImageUrl && dropboxPath) {
      sourceImageUrl = `${origin}/api/admin/photos/image?path=${encodeURIComponent(dropboxPath)}`
      sourceVariant = 'dropbox-proxy'
    }
    if (!sourceImageUrl) {
      await patchAirtableRecord(PHOTOS, photoId, { 'Flatlay Status': 'Failed' }, { typecast: true })
      return NextResponse.json({ error: 'No source bytes available for this photo' }, { status: 400 })
    }
    console.log(`[photos/flatlay] ${photoId} model=${modelKey} source=${sourceVariant}`)

    let task
    try {
      task = await submitWaveSpeedTask(mdl.path, mdl.body([sourceImageUrl], FLATLAY_PROMPT))
    } catch (e) {
      await patchAirtableRecord(PHOTOS, photoId, { 'Flatlay Status': 'Failed' }, { typecast: true })
      throw new Error(`WaveSpeed ${modelKey} submit failed: ${e.message}`)
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
    const dbxPath = `/Palm Ops/Photos/Flatlays/${handle}/${code}_${String(idx).padStart(2, '0')}_flatlay_${modelKey}.jpg`
    try {
      await uploadToDropbox(tok, ns, dbxPath, buf, { overwrite: true })
    } catch (e) {
      // Non-fatal — CF mirror below is the actual delivery path. Log
      // and keep going so the editor still sees the result.
      console.warn(`[photos/flatlay] Dropbox upload failed for ${dbxPath}:`, e.message)
    }

    // Include the model key in the CF id so wan/nano/gpt outputs for
    // the same photo coexist instead of clobbering each other — the
    // editor wants to compare them side by side.
    let flatlayCdnUrl = null
    if (isCloudflareImagesConfigured()) {
      const cfId = `flatlay-${modelKey}-${handle}-${code}-${String(idx).padStart(2, '0')}`.toLowerCase().replace(/[^a-z0-9-]/g, '-')
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
