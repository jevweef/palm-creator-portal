import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { requireAdminOrAiEditor, OPS_BASE } from '@/lib/adminAuth'
import { submitWaveSpeedTask, pollWaveSpeedTask } from '@/lib/wavespeed'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'
import { uploadImageBytes, buildDeliveryUrl, isCloudflareImagesConfigured } from '@/lib/cloudflareImages'

export const maxDuration = 90

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const PHOTOS_TABLE = 'Photos'

// Free-form image generation playground. Pick a model, type a prompt,
// optionally drop reference images, get a result saved to Dropbox + CF
// Images + the Photos table. Lets the editor try ideas WITHOUT going
// through Stage B / flatlay / room-variation flows.
//
// Model adapters mirror the flatlay route's body shapes. Each takes
// (images: string[], prompt, sizeOrAspect, negativePrompt). Text-to-image
// uses the t2i variant when images is empty.
const MODELS = {
  nano: {
    label: 'Nano-Banana 2',
    edit: 'google/nano-banana-2/edit',
    t2i: 'google/nano-banana-2/text-to-image',
    body: (images, prompt, aspect) => ({
      ...(images.length ? { images } : {}),
      prompt,
      aspect_ratio: aspect,
      resolution: '2k',
      output_format: 'jpeg',
    }),
  },
  wan: {
    label: 'Wan 2.7 image-edit-pro',
    edit: 'alibaba/wan-2.7/image-edit-pro',
    // Wan doesn't have a separate t2i path — image-edit-pro accepts
    // an empty images array but tends to drift. For best results pass
    // at least one reference. Size is W*H, not aspect ratio.
    t2i: 'alibaba/wan-2.7/image-edit-pro',
    body: (images, prompt, aspect) => ({
      ...(images.length ? { images } : {}),
      prompt,
      size: ASPECT_TO_SIZE[aspect] || '1024*1024',
    }),
  },
  gpt: {
    label: 'GPT-Image-2',
    edit: 'openai/gpt-image-2/edit',
    t2i: 'openai/gpt-image-2/text-to-image',
    body: (images, prompt, aspect) => ({
      ...(images.length ? { images } : {}),
      prompt,
      aspect_ratio: aspect,
      resolution: '2k',
      quality: 'high',
    }),
  },
}

// Aspect ratio → Wan size mapping. Wan wants explicit pixel dimensions.
const ASPECT_TO_SIZE = {
  '1:1':  '1024*1024',
  '9:16': '1080*1920',
  '16:9': '1920*1080',
  '4:5':  '1080*1350',
  '5:4':  '1350*1080',
  '3:4':  '1080*1440',
  '4:3':  '1440*1080',
}
const SUPPORTED_ASPECTS = Object.keys(ASPECT_TO_SIZE)

// POST { model, prompt, aspect?, referenceUrls? }
// - model: 'nano' | 'wan' | 'gpt' (default nano)
// - prompt: required, free text
// - aspect: one of SUPPORTED_ASPECTS, default '1:1'
// - referenceUrls: optional array of public URLs (up to 3) — the editor
//   uploaded these via the existing Photos upload flow or pasted a URL
//
// Returns { ok, photoId, cdnUrl, dropboxPath, predictionId, sourceModel }
export async function POST(request) {
  try {
    await requireAdminOrAiEditor()
    const body = await request.json()
    const modelKey = MODELS[body.model] ? body.model : 'nano'
    const mdl = MODELS[modelKey]
    const prompt = String(body.prompt || '').trim()
    if (!prompt) return NextResponse.json({ error: 'prompt required' }, { status: 400 })
    if (prompt.length > 4000) return NextResponse.json({ error: 'prompt too long (>4000 chars)' }, { status: 400 })

    const aspect = SUPPORTED_ASPECTS.includes(body.aspect) ? body.aspect : '1:1'
    const referenceUrls = Array.isArray(body.referenceUrls)
      ? body.referenceUrls.filter(u => typeof u === 'string' && u).slice(0, 3)
      : []

    // Pick path: edit (if refs) vs t2i (if none). Wan uses the same path
    // for both because its t2i support is via the image-edit-pro endpoint.
    const actorPath = referenceUrls.length ? mdl.edit : mdl.t2i
    const reqBody = mdl.body(referenceUrls, prompt, aspect)

    // Submit + poll. Cap at 70s so the Dropbox + CF upload below has
    // headroom before the 90s maxDuration.
    let task
    try {
      task = await submitWaveSpeedTask(actorPath, reqBody)
    } catch (e) {
      return NextResponse.json({ error: `WaveSpeed submit failed: ${e.message}` }, { status: 502 })
    }
    const predictionId = task?.id || ''

    const t0 = Date.now()
    let outputUrl = null
    let lastError = null
    while (Date.now() - t0 < 70000) {
      const d = await pollWaveSpeedTask(task.id)
      if (d.status === 'completed') {
        outputUrl = (d.outputs || [])[0]
        if (!outputUrl) { lastError = 'WaveSpeed completed with no outputs'; break }
        break
      }
      if (d.status === 'failed') {
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
      return NextResponse.json({ error: lastError || 'Generation timed out — try again', predictionId }, { status: 504 })
    }

    // Pull bytes, normalize to JPEG (Wan/GPT often emit PNG even when
    // we ask for JPEG — macOS Finder + Airtable both behave better with
    // a real JPEG matching the .jpg extension).
    const ir = await fetch(outputUrl)
    if (!ir.ok) {
      return NextResponse.json({ error: `Couldn't fetch model output: HTTP ${ir.status}` }, { status: 502 })
    }
    const rawBuf = Buffer.from(await ir.arrayBuffer())
    let buf
    try {
      buf = await sharp(rawBuf).jpeg({ quality: 92, mozjpeg: true }).toBuffer()
    } catch (e) {
      console.warn('[ai-gen] jpeg re-encode failed, using raw bytes:', e.message)
      buf = rawBuf
    }

    // Save to Dropbox (canonical source) at /Palm Ops/AI Generations/{date}/{shortid}.jpg
    const date = new Date().toISOString().slice(0, 10)
    const shortid = Math.random().toString(36).slice(2, 12)
    const dropboxPath = `/Palm Ops/AI Generations/${date}/${modelKey}_${shortid}.jpg`
    const tok = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(tok)
    await uploadToDropbox(tok, ns, dropboxPath, buf, { overwrite: true })
    let dbxLink = ''
    try { dbxLink = await createDropboxSharedLink(tok, ns, dropboxPath) } catch {}

    // Mirror to CF Images for fast delivery.
    let cdnUrl = null
    let cdnImageId = null
    if (isCloudflareImagesConfigured()) {
      try {
        const cfId = `ai-gen-${modelKey}-${date}-${shortid}`.toLowerCase().replace(/[^a-z0-9-]/g, '-')
        const r = await uploadImageBytes(buf, cfId)
        cdnImageId = r.id
        cdnUrl = buildDeliveryUrl(r.id, 'public')
      } catch (e) {
        console.warn('[ai-gen] CF Images upload failed:', e.message)
      }
    }

    // Create a Photos row so the result can be reused as a reference
    // downstream (outfit picker, pose reference, etc.). Path-only —
    // no Airtable attachment per architecture policy.
    const photoFields = {
      'Source Type': 'AI Generated',
      'Source Handle': `ai-${modelKey}`,  // synthesizes a handle for filtering
      'Source Post URL': '',
      'Carousel Index': 1,
      'Carousel Total': 1,
      'Dropbox Path': dropboxPath,
      Caption: prompt.slice(0, 2000),
      Status: 'Approved',
      'Is Outfit': false,
      'Outfit Reviewed': false,
      ...(dbxLink ? { 'Dropbox Link': dbxLink } : {}),
      ...(cdnUrl ? { 'CDN URL': cdnUrl } : {}),
      ...(cdnImageId ? { 'CDN Image ID': cdnImageId } : {}),
    }
    const createRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(PHOTOS_TABLE)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ typecast: true, records: [{ fields: photoFields }] }),
    })
    let photoId = null
    if (createRes.ok) {
      const j = await createRes.json()
      photoId = j?.records?.[0]?.id || null
    } else {
      console.warn('[ai-gen] Photos create failed:', await createRes.text())
    }

    return NextResponse.json({
      ok: true,
      photoId,
      cdnUrl,
      dropboxPath,
      dropboxLink: dbxLink || null,
      predictionId,
      model: modelKey,
      modelLabel: mdl.label,
      aspect,
      hadReferences: referenceUrls.length,
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[ai-gen] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// GET — list recent AI generations for the history sidebar.
export async function GET() {
  try {
    await requireAdminOrAiEditor()
    const res = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(PHOTOS_TABLE)}?` +
      new URLSearchParams({
        filterByFormula: `{Source Type}='AI Generated'`,
        'sort[0][field]': 'Name',  // Name is the primary; createdTime sort below
        pageSize: '40',
      }),
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
    )
    if (!res.ok) {
      return NextResponse.json({ error: `Airtable list failed: ${res.status}` }, { status: 502 })
    }
    const data = await res.json()
    const items = (data.records || []).map(r => {
      const f = r.fields || {}
      return {
        id: r.id,
        createdTime: r.createdTime,
        prompt: f.Caption || '',
        cdnUrl: f['CDN URL'] || null,
        dropboxLink: f['Dropbox Link'] || null,
        model: (f['Source Handle'] || '').replace(/^ai-/, '') || 'unknown',
      }
    }).sort((a, b) => (b.createdTime || '').localeCompare(a.createdTime || ''))
    return NextResponse.json({ ok: true, items })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
