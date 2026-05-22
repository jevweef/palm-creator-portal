import { NextResponse } from 'next/server'
import sharp from 'sharp'
import Anthropic from '@anthropic-ai/sdk'
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

// Claude vision pass — describe the garment(s) the subject is wearing
// in forensic detail BEFORE feeding the request to WaveSpeed. Vague
// prompts ("the clothes the person is wearing") produce generic
// outputs that miss the design language of small-detail garments like
// bikinis. A specific description ("triangle micro top, thin spaghetti
// halter ties, light pink ribbed knit fabric, side-tie low-rise
// bottom") gives the diffusion model concrete targets to hit.
//
// Returns a paragraph the WaveSpeed prompt embeds verbatim. Empty
// string on failure — the flatlay still runs, just with the generic
// fallback prompt.
async function describeGarment(imageUrl) {
  if (!process.env.ANTHROPIC_API_KEY || !imageUrl) return ''
  try {
    const ir = await fetch(imageUrl)
    if (!ir.ok) return ''
    const b64 = Buffer.from(await ir.arrayBuffer()).toString('base64')
    const ct = ir.headers.get('content-type') || ''
    const mediaType = (ct.match(/^(image\/[a-z]+)/i)?.[1] || 'image/jpeg').toLowerCase().replace('image/jpg', 'image/jpeg')
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
          { type: 'text', text:
            'Describe EXACTLY the garment(s) the person is wearing in this photo, for a flatlay product photographer who will reconstruct them on a white background.\n\n'
            + 'For EACH visible garment, list:\n'
            + '• Garment type (e.g. triangle bikini top, low-rise side-tie bikini bottom, slip dress, one-shoulder mini dress, ribbed crop top, bandeau, halter, etc.)\n'
            + '• Exact color — REQUIRED FORMAT: hex code FIRST, then descriptive name. Example: "#B0BAC4 (powder blue-gray / chambray)" or "#7A4A30 (warm chocolate brown)". Sample the actual fabric pixels, not lit highlights or shadowed folds — pick the hex of the mid-tone. Be aware of cool/warm undertones: a light gray with a blue undertone is NOT pure gray, it\'s #B0B5C0 / powder blue. A "white" with a yellow undertone is cream / ivory. Always include the hex; the diffusion model uses hex codes more reliably than color words.\n'
            + '• Fabric type and texture (ribbed knit / smooth jersey / sheer mesh / silky satin / waffle / textured weave / etc.) — describe what the surface looks and feels like\n'
            + '• Cut, silhouette, and coverage (high-rise, low-rise, micro, full coverage, cheeky, asymmetric, mini, midi, cropped, etc.)\n'
            + '• Neckline / strap detail (thin spaghetti string ties, thick straps, halter neck, cowl, square-cut, sweetheart, one-shoulder, racerback, etc.)\n'
            + '• Closures — be exhaustive. COUNT visible buttons, snaps, ties, drawstrings, hooks, eyelets, grommets. State where they sit (center placket front-to-hem, side seam, shoulder, hip). If there is a button-front fly on shorts/pants, say "button-front fly with N visible buttons down the front" — do not just say "shorts" or describe them as elastic-only. If there are no closures, say "no visible closures."\n'
            + '• Any prints, patterns, embellishments, hem details (raw / rolled / lettuce-edge / scalloped), or visible stitching/seams\n\n'
            + 'IGNORE accessories (sunglasses, jewelry, watches, bags, shoes), hair, makeup, the person themselves, and the environment. ONLY describe garments that would be in the flatlay.\n\n'
            + 'If part of a garment is hidden by pose or body, infer the most likely typical cut — assume symmetric construction unless the design is clearly asymmetric.\n\n'
            + 'Be concise but specific. Return one paragraph per garment, no preamble.'
          },
        ],
      }],
    })
    const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
    return text || ''
  } catch (e) {
    console.warn('[photos/flatlay] describeGarment failed:', e.message)
    return ''
  }
}

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

// Builds the WaveSpeed prompt with an embedded forensic garment
// description from Claude. The description anchors the model to the
// specific cut/fabric/color of the source, defeating the generic-
// output drift we see with vague "the clothes the person is wearing"
// language. Accessories (jewelry, shoes, watches) are intentionally
// dropped — flatlay is about the outfit itself, not the full styling.
function buildFlatlayPrompt(garmentDescription) {
  const hasDescription = !!garmentDescription
  return (
    'TASK: Create a clean product-flatlay photograph showing the EXACT garment(s) described below, '
    + 'reconstructed in their natural symmetric off-body shape on a pure white seamless studio surface.\n\n'
    + (hasDescription
        ? `GARMENT(S) TO REPLICATE — copy these EXACTLY, this is the design you must produce:\n${garmentDescription}\n\n`
        : 'GARMENT(S) TO REPLICATE: study the photo carefully and reproduce the exact garment(s) the subject is wearing — match cut, fabric, color, and construction precisely.\n\n')
    + 'REPLICATION RULES (highest priority):\n'
    + '1. The CUT and SILHOUETTE of each garment must match exactly — if it is a triangle bikini top, '
    + 'draw a triangle bikini top, not a bralette or sports top. If it is a side-tie bikini bottom, '
    + 'draw side-tie ties at the hips, not a pull-on brief. Do NOT substitute a "generic version" of '
    + 'the same category — copy the specific design language visible in the source.\n'
    + '2. FABRIC must match — ribbed knit stays ribbed, smooth jersey stays smooth, sheer stays sheer, '
    + 'satin stays glossy. Do not flatten textured fabric into matte solid.\n'
    + '3. COLOR — render the EXACT hex code(s) given in the garment description above. The hex '
    + 'code is canonical; the descriptive English name ("powder blue", "chambray") is supporting '
    + 'context. If the description says #B0BAC4 powder blue-gray, render #B0BAC4 — do not default '
    + 'to a neutral gray or pure blue. Match the literal hue and undertone, not a "close enough" '
    + 'interpretation of the English word.\n'
    + '4. Strap detail, tie placement, neckline shape, hem cut, ruching, cutouts, prints — every '
    + 'design detail in the description must appear in the flatlay.\n\n'
    + 'PRESENTATION:\n'
    + '• Lay each garment flat on the white surface as if it were just lifted off a hanger and placed '
    + 'down. Strap lengths matched, hem level, fabric undistorted, no body shape, no hanger, no '
    + 'mannequin. Top-down overhead view.\n'
    + '• Pose-induced asymmetry in the source (strap pulled off shoulder, fabric bunched against the '
    + 'body, hem twisted by sitting) should be IGNORED — assume the garment is constructed '
    + 'symmetrically unless the design is intentionally asymmetric (e.g. one-shoulder dress).\n'
    + '• Soft even shadowless studio lighting. Photoreal, sharp focus, high detail. The texture of '
    + 'the fabric should be visible at close inspection.\n\n'
    + 'STRICTLY EXCLUDE (do not draw any of these):\n'
    + '• The person, body parts, hair, skin\n'
    + '• Original background, environment, sky, walls, plants, furniture\n'
    + '• Accessories: sunglasses, jewelry, watches, bags, shoes, hats — the flatlay shows the worn '
    + 'garment(s) only\n'
    + '• Environmental textiles laid in the original scene: towels, blankets, sheets, pillows, '
    + 'robes draped on a chair, beach throws, rugs, sarongs on furniture — if it was not WORN by '
    + 'the person, do not include it\n'
    + '• Store/brand/price/hang/swing tags, size labels, hangers, mannequins, rulers, commercial '
    + 'listing decorations.\n\n'
    + 'Output: just the garment(s) on a white surface, nothing else.'
  )
}

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
      fields: ['Source Handle', 'Source Post URL', 'Carousel Index', 'CDN URL', 'Dropbox Path', 'Is Outfit', 'Flatlay Locked'],
      filterByFormula: `RECORD_ID() = '${photoId}'`,
    })
    if (!rows.length) return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
    const f = rows[0].fields || {}
    // Lock guard — once the editor has marked a flatlay as final, refuse
    // to overwrite it. They must unlock before re-running so a stray
    // click on N/W/G doesn't destroy a result they liked.
    if (f['Flatlay Locked']) {
      return NextResponse.json({ error: 'This flatlay is locked. Unlock it first to re-generate.' }, { status: 409 })
    }
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

    // Claude vision pre-pass — describe the specific garment(s) so the
    // diffusion model gets explicit "draw X in Y fabric with Z details"
    // text instead of having to forensically extract design language
    // from pixels. Empty description = generic fallback prompt (still
    // works, just not as accurate). Logged so we can audit what Claude
    // saw when a flatlay misses.
    const garmentDescription = await describeGarment(sourceImageUrl)
    if (garmentDescription) {
      console.log(`[photos/flatlay] ${photoId} garment: ${garmentDescription.slice(0, 200)}${garmentDescription.length > 200 ? '…' : ''}`)
    } else {
      console.warn(`[photos/flatlay] ${photoId} Claude analysis returned empty — falling back to generic prompt`)
    }
    const prompt = buildFlatlayPrompt(garmentDescription)

    let task
    try {
      task = await submitWaveSpeedTask(mdl.path, mdl.body([sourceImageUrl], prompt))
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
      if (d.status === 'failed') {
        // WaveSpeed sometimes returns `error` as an object ({message, code}
        // or similar) rather than a string. Stringify defensively so the
        // client gets something readable instead of "[object Object]".
        const raw = d.error
        lastError = typeof raw === 'string' ? raw
          : raw?.message ? raw.message
          : raw ? JSON.stringify(raw)
          : 'WaveSpeed reported failed'
        break
      }
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
    const rawBuf = Buffer.from(await ir.arrayBuffer())

    // Coerce to JPEG. Wan and GPT return PNG even though we save as
    // .jpg, causing macOS Finder to flag the file as corrupt (extension
    // ↔ content mismatch). Re-encoding with sharp gives us a real
    // JPEG that matches the filename + Content-Type the proxy serves.
    let buf
    try {
      buf = await sharp(rawBuf).jpeg({ quality: 92, mozjpeg: true }).toBuffer()
    } catch (e) {
      console.warn(`[photos/flatlay] jpeg re-encode failed, using raw bytes:`, e.message)
      buf = rawBuf
    }

    const tok = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(tok)
    const dbxPath = `/Palm Ops/Photos/Flatlays/${handle}/${code}_${String(idx).padStart(2, '0')}_flatlay_${modelKey}.jpg`
    let dbxUploadOk = false
    try {
      await uploadToDropbox(tok, ns, dbxPath, buf, { overwrite: true })
      dbxUploadOk = true
    } catch (e) {
      // Non-fatal — CF mirror below is the actual delivery path. Log
      // and keep going so the editor still sees the result, but DON'T
      // write the path field below or downloads will hit empty files.
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
      'Flatlay Model': modelKey,
      // Only write the path field when the Dropbox upload actually
      // succeeded. Stale paths cause the ⬇ button to hit empty bytes
      // (broken-link icon in Finder) since the route proxies through
      // downloadFromDropbox.
      ...(dbxUploadOk ? { 'Flatlay Dropbox Path': dbxPath } : { 'Flatlay Dropbox Path': '' }),
      ...(flatlayCdnUrl ? { 'Flatlay CDN URL': flatlayCdnUrl } : {}),
    }
    await patchAirtableRecord(PHOTOS, photoId, patch, { typecast: true })

    return NextResponse.json({
      ok: true,
      photoId,
      flatlayCdnUrl,
      flatlayDropboxPath: dbxPath,
      predictionId,
      // Echo what Claude saw — surfaces in the UI so editor can spot
      // mis-reads ("Claude said 'green dress' when it's clearly blue").
      garmentDescription: garmentDescription || null,
      sourceVariant,
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
