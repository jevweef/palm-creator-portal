import { NextResponse } from 'next/server'
import sharp from 'sharp'
import Anthropic from '@anthropic-ai/sdk'
import { requireAdminOrAiEditor, fetchAirtableRecords } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'
import { uploadImageBytes, isCloudflareImagesConfigured } from '@/lib/cloudflareImages'
import { submitWaveSpeedTask, pollWaveSpeedTask } from '@/lib/wavespeed'
import { quoteAirtableString } from '@/lib/airtableFormula'
import { POSES } from '@/lib/aiCloneConfig'
import { generateVariation, pickModelSize } from '@/lib/imageEditAdapters'

const ALLOWED_MODELS = new Set(['wan', 'gpt', 'nano'])

export const dynamic = 'force-dynamic'
// Bumped to 600s. With 3 parallel Wan 2.7 image-edit-pro jobs the
// late-queued tasks routinely take 5-8 min; the prior 300s cap was killing
// the request before they completed and the client saw "polling timed out".
// 600s requires Vercel Pro tier — local dev has no cap.
export const maxDuration = 600

const WAN_MODEL = 'alibaba/wan-2.7/image-edit-pro'

// Sonnet prompt — analyzes the source TJP image and returns a structured
// set of variation specs. Each variation names which creator-reference
// poses it needs from {front, back, face} so we can pull the right
// `AI Ref Inputs` photos per call. Critical: scene-agnostic language; the
// model decides what's appropriate for the actual source image, not us
// from a hardcoded pool.
const SONNET_SYSTEM = `You plan pose variations for AI image generation. Given a photo of a creator, write N short pose-adjustment instructions that produce natural variations — like the next few frames in a candid photo session.

YOUR JOB: write ONLY the pose delta — what changes from one frame to the next. The scene-lock framing and identity-preservation framing are added automatically around your text; do NOT repeat them.

CORE PRINCIPLE: Same photo session, taken seconds apart. Subtle, natural human motion — gaze shifts, soft expression changes, hand repositions, weight shifts. Holistic descriptions ("she shifts her weight onto her right leg and looks slightly off-camera") work far better than itemized lists of constraints. Wan has trained understanding of natural pose — trust it.

WHAT TO VARY (sample 2-3 per variation, never repeat the exact same combination):
- Gaze: at-camera, off-frame-left, off-frame-right, slightly down, slightly up
- Expression: neutral, soft closed-mouth smile, parted lips, mid-laugh, contemplative, playful
- Head: subtle turn left/right, slight up/down tilt
- Torso: subtle 3/4 turn, square-up, slight twist, hip pop
- Weight/legs: weight on left leg vs right, slight forward step, crossed-ankle stance, slight foot reposition
- Hands: near hair/face, at hip/torso, relaxed at sides, engaged with a prop already visible
- Camera framing: subtle zoom or L/R drift

HARD RULES:
- For "full-body" or "three-quarter" framing, AT LEAST ONE variation MUST include a weight shift / foot reposition / leg change. Never return a set where every variation has identical foot placement — that's not how real photo sessions look.
- Each prompt must be 2 short sentences max. Plain natural language. No itemized "do not change X" clauses — those overwhelm the model. The scene lock is handled in the system wrapper.
- Never invent gestures the framing can't support (no foot shift if it's a close-up portrait).
- Never name specific objects unless you can see them in the source — "a prop already visible" or general type only.

REFERENCE POSE SELECTION per variation:
- "front": needed if the variation involves any front-facing pose adjustments (most variations)
- "back": needed ONLY if the variation involves turning around / over-the-shoulder views / back angles
- "face": needed if the variation is a close-up portrait change (head/expression/gaze) where face fidelity is critical

Most variations only need "front". Use "back" sparingly, only when the variation explicitly rotates the subject toward the back.

OUTPUT FORMAT (STRICT JSON, no preamble, no markdown fences):
{
  "sceneDescription": "1-sentence description of what's in the source image",
  "framingType": "close-up" | "waist-up" | "three-quarter" | "full-body",
  "variations": [
    {
      "label": "short human-readable label, ≤6 words",
      "prompt": "Wan 2.7 image-edit prompt, 2-4 sentences",
      "referencesNeeded": ["front" | "back" | "face"]
    },
    ...exactly N items
  ]
}`

const SONNET_USER_TEMPLATE = (n) => `Analyze the attached image and produce exactly ${n} variation plans following the system rules. Return strict JSON only.`

// Wan 2.7 image-edit canonical wrapper around Sonnet's variation prompt.
// Sonnet writes the variation-specific instruction; we wrap it with the
// "image 1 = source, images 2-N = identity references" framing so Wan
// gets the same structure used in /recreate/swap-creator.
// Holistic Wan 2.7 image-edit wrapper. Mirrors the proven pattern from
// /api/admin/recreate/swap-creator (Figure 1 = canonical canvas, Figures
// 2-N = identity refs, short 2-3 sentence structure). The consultant
// note in swap-creator's source is the authority here:
//   "Itemized feature lists were overwhelming Wan and producing worse
//    swaps. Holistic match-references / match-image-1 works better —
//    Wan uses its trained identity understanding instead of trying to
//    balance 45 individual feature attributes."
// Style anchors ("raw iPhone photo, slight handheld feel") are borrowed
// from swap-creator + pose-alt — those consistently produce naturalistic
// candid-feel output instead of glossy studio-look.
function buildWanPrompt(variationPrompt, refCount) {
  const refRange = refCount === 0
    ? ''
    : refCount === 1
    ? 'Image 2 is a reference photo of the same woman — match her face, skin tone, hair, and body proportions to that reference. Same person.\n\n'
    : `Images 2 to ${1 + refCount} are reference photos of the same woman — match her face, skin tone, hair, and body proportions to those references. Same person.\n\n`
  return (
    `Use image 1 as the primary reference and recreate the scene exactly: same outfit, same location, same lighting, same camera angle and framing, same composition. Match image 1 precisely for everything except the pose adjustment described below.\n\n` +
    refRange +
    `Pose change: ${variationPrompt}\n\n` +
    `Hyper realistic raw iPhone photo, natural skin texture, candid photo-session feel like the next frame seconds later, slight handheld feel, true-to-life colors, no posed-model stiffness, no text overlay, no watermark.`
  )
}

function rawDropboxUrl(url) {
  if (!url) return ''
  return url.replace(/[?&]dl=0/, '').replace(/([?&]raw=1)?$/, '') + (url.includes('?') ? '&raw=1' : '?raw=1')
}

// Upload the editor's TJP image to Dropbox + CF Images so Wan can fetch it.
// Also returns the post-rotate intrinsic dimensions so the caller can ask
// Wan for an output at the same aspect ratio.
async function hostSourceImage(file, aka) {
  const rawBuf = Buffer.from(await file.arrayBuffer())
  // Normalize to JPEG via sharp — handles HEIC/PNG/WebP, EXIF orientation.
  let buf = rawBuf
  let contentType = 'image/jpeg'
  let width = 0
  let height = 0
  try {
    const pipeline = sharp(rawBuf).rotate()
    const meta = await pipeline.metadata()
    width = meta.width || 0
    height = meta.height || 0
    buf = await pipeline.jpeg({ quality: 95, mozjpeg: true }).toBuffer()
  } catch (e) {
    console.warn('[carousel-variations] sharp coerce failed, using raw:', e.message)
    contentType = file.type || 'application/octet-stream'
  }

  const date = new Date().toISOString().slice(0, 10)
  const shortid = Math.random().toString(36).slice(2, 12)
  const safeAka = (aka || 'unknown').replace(/[^a-zA-Z0-9_-]+/g, '_')
  const dropboxPath = `/Palm Ops/AI Carousel Variations/${safeAka}/${date}/${shortid}-source.jpg`

  const tok = await getDropboxAccessToken()
  const ns = await getDropboxRootNamespaceId(tok)
  await uploadToDropbox(tok, ns, dropboxPath, buf, { overwrite: true })
  let dropboxLink = ''
  try { dropboxLink = await createDropboxSharedLink(tok, ns, dropboxPath) } catch {}
  const dropboxRaw = dropboxLink ? rawDropboxUrl(dropboxLink) : null

  // CF Images for fast loading in the result UI; Wan can use either URL.
  let cdnUrl = null
  if (isCloudflareImagesConfigured()) {
    try {
      const cfId = `carousel-var-${safeAka}-${shortid}`.toLowerCase().replace(/[^a-z0-9-]/g, '-')
      const r = await uploadImageBytes(buf, cfId, contentType)
      const CF_HASH = process.env.CLOUDFLARE_IMAGES_HASH
      cdnUrl = `https://imagedelivery.net/${CF_HASH}/${r.id}/format=jpeg,quality=92`
    } catch (e) {
      console.warn('[carousel-variations] CF Images upload failed:', e.message)
    }
  }

  return { sourceUrl: dropboxRaw || cdnUrl, dropboxPath, cdnUrl, width, height }
}

// Pick a Wan-friendly output size matching the source aspect ratio.
// Wan 2.7 image-edit-pro accepts arbitrary dimensions but performs best
// when each side is a multiple of 64 and the longer side is ~1280-1440px.
// Pin the LONGER side to TARGET_LONG and round the shorter to match AR.
// Falls back to a sensible 4:5 portrait if dimensions are missing.
function pickWanSize(w, h) {
  const TARGET_LONG = 1440
  const MIN_SIDE = 512
  const round64 = (n) => Math.max(MIN_SIDE, Math.round(n / 64) * 64)
  if (!w || !h) return '1152*1440' // 4:5 portrait default — most common TJP shape
  const ar = w / h
  if (ar >= 1) {
    // Landscape or square
    return `${round64(TARGET_LONG)}*${round64(TARGET_LONG / ar)}`
  }
  return `${round64(TARGET_LONG * ar)}*${round64(TARGET_LONG)}`
}

// Group `AI Ref Inputs` attachments by pose prefix from the filename:
// "Front View input_1.jpg" → front, ordered by the trailing number so
// input_1 (priority 1) comes first. Wan caps total images at 9 (source + 8)
// so we send the top few per pose request.
function groupRefsByPose(aiRefInputs) {
  const groups = { front: [], back: [], face: [] }
  for (const att of aiRefInputs) {
    const filename = att.filename || ''
    const m = filename.match(/^(Front View|Back View|Close Up Face) input_(\d+)\./)
    if (!m) continue
    const key = m[1] === 'Front View' ? 'front' : m[1] === 'Back View' ? 'back' : 'face'
    groups[key].push({ url: att.url, filename, priority: parseInt(m[2], 10) })
  }
  // Lowest number = highest priority (input_1 first).
  for (const k of Object.keys(groups)) {
    groups[k].sort((a, b) => a.priority - b.priority)
  }
  return groups
}

// Pick reference URLs for a variation. Caller passes which poses are
// needed; we pull top-N from each pose pool and cap the total at 8 (the
// Wan 9-image limit minus the source frame).
function pickRefs(neededPoses, refsByPose, maxTotal = 8) {
  const picks = []
  // Per-pose budget: split the 8-slot budget across requested poses.
  const perPose = Math.max(1, Math.floor(maxTotal / Math.max(1, neededPoses.length)))
  for (const pose of neededPoses) {
    const pool = refsByPose[pose] || []
    picks.push(...pool.slice(0, perPose).map(r => r.url))
    if (picks.length >= maxTotal) break
  }
  return picks.slice(0, maxTotal)
}

async function planVariations(sourceUrl, n) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set')

  // Fetch + base64 the source for Claude vision.
  const ir = await fetch(sourceUrl)
  if (!ir.ok) throw new Error(`Could not fetch source image: HTTP ${ir.status}`)
  const b64 = Buffer.from(await ir.arrayBuffer()).toString('base64')
  const ct = ir.headers.get('content-type') || ''
  const mediaType = (ct.match(/^(image\/[a-z]+)/i)?.[1] || 'image/jpeg').toLowerCase().replace('image/jpg', 'image/jpeg')

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: SONNET_SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
        { type: 'text', text: SONNET_USER_TEMPLATE(n) },
      ],
    }],
  })
  const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()

  // Strip any accidental markdown fences before parsing.
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  let plan
  try {
    plan = JSON.parse(cleaned)
  } catch (e) {
    throw new Error(`Sonnet returned invalid JSON: ${e.message}\nRaw: ${cleaned.slice(0, 400)}`)
  }
  if (!Array.isArray(plan?.variations) || plan.variations.length === 0) {
    throw new Error('Sonnet plan missing variations array')
  }
  // Defensive — clamp to N, fix bad pose names.
  plan.variations = plan.variations.slice(0, n).map(v => ({
    label: (v.label || 'Variation').slice(0, 80),
    prompt: String(v.prompt || '').trim(),
    referencesNeeded: Array.isArray(v.referencesNeeded)
      ? v.referencesNeeded.filter(p => ['front', 'back', 'face'].includes(p))
      : ['front'],
  }))
  if (plan.variations.some(v => !v.prompt)) {
    throw new Error('One or more variations missing prompt text')
  }
  return plan
}

// Poll a Wan task until completed/failed/timeout. 3s interval, max 190
// attempts (~9.5 min). When 3+ Wan tasks queue on WaveSpeed the late ones
// commonly take 5-8 min; the prior 4.5 min cap was killing them mid-flight.
// Stays just under the route's maxDuration=600s so the poll loop fails
// gracefully before Vercel kills the whole function.
async function waitForTask(taskId) {
  const SLEEP_MS = 3000
  const MAX_ATTEMPTS = 190
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const s = await pollWaveSpeedTask(taskId)
    if (s.status === 'completed') {
      const out = (s.outputs || [])[0]
      if (!out) throw new Error('Wan completed with no output URL')
      return out
    }
    if (s.status === 'failed') {
      throw new Error(s.error || 'Wan task failed')
    }
    await new Promise(r => setTimeout(r, SLEEP_MS))
  }
  throw new Error('Wan task polling timed out')
}

// POST (multipart) — generate carousel pose variations from a single source image.
//   file:      single image (the TJP-generated photo to vary)
//   creatorId: Palm Creators record ID — used to pull AI Ref Inputs
//   n:         number of variations (default 3, max 5)
//
// Returns: { ok, sourceUrl, sceneDescription, framingType, results: [{ label, prompt, refsUsed, outputUrl|error }] }
export async function POST(request) {
  try {
    await requireAdminOrAiEditor()

    const form = await request.formData()
    const file = form.get('file')
    const creatorId = form.get('creatorId')
    const rawN = parseInt(form.get('n') || '3', 10)
    const n = Math.max(1, Math.min(5, isNaN(rawN) ? 3 : rawN))
    const modelRaw = String(form.get('model') || 'wan').toLowerCase()
    const model = ALLOWED_MODELS.has(modelRaw) ? modelRaw : 'wan'

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'file field required (multipart)' }, { status: 400 })
    }
    if (!creatorId || !/^rec[A-Za-z0-9]{14}$/.test(String(creatorId))) {
      return NextResponse.json({ error: 'valid creatorId required' }, { status: 400 })
    }
    const type = file.type || ''
    if (!type.startsWith('image/')) {
      return NextResponse.json({ error: 'File must be an image' }, { status: 400 })
    }

    // 1. Load creator + check that AI Super Clone references are set up.
    const recs = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(String(creatorId))}`,
      fields: ['AKA', 'Creator', 'AI Ref Inputs'],
      maxRecords: 1,
    })
    const creator = recs[0]
    if (!creator) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
    const aka = creator.fields?.AKA || creator.fields?.Creator || 'unknown'
    const aiRefInputs = creator.fields?.['AI Ref Inputs'] || []
    if (!aiRefInputs.length) {
      return NextResponse.json({
        error: `${aka} has no AI Ref Inputs uploaded. Set up the Super Clone reference photos in /admin/recreate-source → Creator Avatar before generating variations.`,
      }, { status: 400 })
    }
    const refsByPose = groupRefsByPose(aiRefInputs)
    if (!refsByPose.front.length && !refsByPose.face.length) {
      return NextResponse.json({
        error: `${aka} has no Front or Face references. At minimum, set up Front View input photos in /admin/recreate-source → Creator Avatar.`,
      }, { status: 400 })
    }

    // 2. Host the source image so Wan can fetch it. Capture dimensions so
    //    we can ask Wan for an output at the same aspect ratio — without
    //    this, Wan defaults the prior hardcoded 9:16 size regardless of
    //    input shape.
    const { sourceUrl, cdnUrl, width: srcW, height: srcH } = await hostSourceImage(file, aka)
    if (!sourceUrl) {
      return NextResponse.json({ error: 'Failed to upload source image' }, { status: 500 })
    }
    const outputSize = pickModelSize(model, srcW, srcH)
    console.log(`[carousel-variations] model=${model} source ${srcW}x${srcH} → output ${outputSize}`)

    // 3. Sonnet analyzes the source and plans N variations.
    console.log(`[carousel-variations] Sonnet planning ${n} variations for ${aka}…`)
    const plan = await planVariations(sourceUrl, n)
    console.log(`[carousel-variations] Plan: ${plan.framingType}, ${plan.variations.length} variations`)

    // 4. Generate all N variations in parallel via the chosen model. The
    //    adapter (lib/imageEditAdapters.js) hides the model-specific
    //    submit/poll/decode details; route just gets a Buffer back per
    //    variation. Each variation fails independently — we collect
    //    successes + per-variation errors rather than aborting the batch.
    const tok = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(tok)
    const dateStr = new Date().toISOString().slice(0, 10)
    const safeAka = (aka || 'unknown').replace(/[^a-zA-Z0-9_-]+/g, '_')

    const results = await Promise.all(plan.variations.map(async (v, i) => {
      try {
        // Fall back to Front refs if Sonnet asked for a pose we don't have
        // (e.g., Back requested but creator only has Front + Face).
        const requested = v.referencesNeeded.length ? v.referencesNeeded : ['front']
        const availablePoses = requested.filter(p => (refsByPose[p] || []).length > 0)
        const effectivePoses = availablePoses.length ? availablePoses : (
          refsByPose.front.length ? ['front'] : ['face']
        )
        const refUrls = pickRefs(effectivePoses, refsByPose)
        const promptForModel = buildWanPrompt(v.prompt, refUrls.length)
        console.log(`[carousel-variations] Variation ${i + 1} (${v.label}) → model=${model}, ${1 + refUrls.length} images, poses: ${effectivePoses.join(',')}`)

        const { outputBuffer, contentType } = await generateVariation({
          model,
          sourceUrl,
          refUrls,
          prompt: promptForModel,
          srcW,
          srcH,
        })

        // Upload the output to Dropbox + CF Images so the URL is stable
        // (Wan's WaveSpeed URL expires; GPT/Nano return base64 only).
        const ext = (contentType.includes('png') ? 'png' : 'jpg')
        const shortid = Math.random().toString(36).slice(2, 10)
        const dbxPath = `/Palm Ops/AI Carousel Variations/${safeAka}/${dateStr}/var-${i + 1}-${shortid}.${ext}`
        await uploadToDropbox(tok, ns, dbxPath, outputBuffer, { overwrite: true })
        let dbxLink = ''
        try { dbxLink = await createDropboxSharedLink(tok, ns, dbxPath) } catch {}
        const dbxRaw = dbxLink ? dbxLink.replace('dl=0', 'raw=1').replace('dl=1', 'raw=1') : ''

        // CF Images for fast UI delivery.
        let cdnOutputUrl = null
        if (isCloudflareImagesConfigured()) {
          try {
            const cfId = `carousel-var-out-${safeAka}-${dateStr}-${i + 1}-${shortid}`.toLowerCase().replace(/[^a-z0-9-]/g, '-')
            const r = await uploadImageBytes(outputBuffer, cfId, contentType)
            const CF_HASH = process.env.CLOUDFLARE_IMAGES_HASH
            cdnOutputUrl = `https://imagedelivery.net/${CF_HASH}/${r.id}/format=jpeg,quality=92`
          } catch (e) {
            console.warn(`[carousel-variations] CF Images upload variation ${i + 1} failed:`, e.message)
          }
        }

        return {
          variationIndex: i,
          label: v.label,
          prompt: v.prompt,
          promptSent: promptForModel,
          posesUsed: effectivePoses,
          refCount: refUrls.length,
          modelUsed: model,
          outputUrl: cdnOutputUrl || dbxRaw,
          outputCdnUrl: cdnOutputUrl,
          outputDropboxPath: dbxPath,
        }
      } catch (err) {
        return {
          variationIndex: i,
          label: v.label,
          prompt: v.prompt,
          modelUsed: model,
          error: err.message,
        }
      }
    }))

    const okCount = results.filter(r => r.outputUrl).length
    return NextResponse.json({
      ok: true,
      sourceUrl,
      sourceCdnUrl: cdnUrl,
      sceneDescription: plan.sceneDescription || '',
      framingType: plan.framingType || '',
      creator: { id: creator.id, aka },
      model,
      outputSize,
      requested: n,
      succeeded: okCount,
      results,
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[carousel-variations] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
