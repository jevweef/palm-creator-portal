import { NextResponse } from 'next/server'
import sharp from 'sharp'
import Anthropic from '@anthropic-ai/sdk'
import { requireAdminOrAiEditor, fetchAirtableRecords } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'
import { uploadImageBytes, isCloudflareImagesConfigured } from '@/lib/cloudflareImages'
import { submitWaveSpeedTask, pollWaveSpeedTask } from '@/lib/wavespeed'
import { quoteAirtableString } from '@/lib/airtableFormula'
import { POSES } from '@/lib/aiCloneConfig'

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
const SONNET_SYSTEM = `You plan pose variations for AI image generation. Given an AI-generated portrait of a creator, your job is to write 3 short Wan 2.7 image-edit prompts that produce natural pose variations of the same scene — like the next few shots in a candid photo session.

CORE PRINCIPLE: The output must look like the same photo session, taken seconds apart. The world stays still. Only the subject's pose, expression, gaze, hand placement, and tiny camera reframes change.

LOCKED CONSTANTS (every variation must preserve these from the source image — phrase your prompts in a way that makes Wan treat these as do-not-touch):
- Subject identity: face shape, hair color, hair style, body proportions, skin tone
- Outfit: every garment, every fabric detail (lace trim, fringe, scalloped hem, ruching, stitching, prints), every accessory, every piece of jewelry — DO NOT redesign the dress, do not alter the silhouette, do not change the hem shape, do not move buttons or straps
- Location: every architectural detail, every piece of furniture, every fixture, every plant, every decor item, every distant building or skyline element
- Props in frame: any objects visible or being held — exact shape, color, placement
- Lighting: color, direction, intensity, shadows
- Time of day, weather, atmosphere
- Camera viewpoint: same approximate distance and angle, max 6-12 inch shift, 5-10° rotation

VARIATION DIMENSIONS (each call samples ~2-3 of these to actually change):
- Gaze direction (at-camera / off-frame-left / off-frame-right / slightly-down / slightly-up)
- Facial expression (neutral / soft closed-mouth smile / parted lips / mid-laugh / contemplative / playful)
- Head rotation (unchanged or 10-25° turn left/right, slight up/down tilt)
- Body orientation (slight 3/4 turn, square-up, weight shift between legs, hip pop, slight torso twist)
- Hand placement (one hand near hair/face, one hand at torso/hip, hands on opposite hips, both hands relaxed at sides, engaged with a prop already visible)
- Foot/leg placement (weight on one foot with the other relaxed, slight forward step, crossed-ankle stance, slight foot reposition — REQUIRED for at least one variation when framingType is "full-body" or "three-quarter")
- Camera framing (unchanged or slight zoom in/out, slight L-R drift)

CRITICAL RULES:
- Never name specific objects that may not be in the scene ("railing", "menu", "drink") — use "a prop already visible" or describe by general type only if you can see it.
- Never invent gestures the source can't support — if the source is a close-up portrait, don't ask for "weight shift to other foot" (no legs visible).
- For full-body or three-quarter framing, AT LEAST ONE of the N variations MUST include a foot/weight/leg change — never return a set where every variation has identical foot placement. A photo session has the subject naturally shifting their stance.
- Each prompt must be 2-4 short sentences, change/keep style, optimized for Wan 2.7 image-edit.
- Each prompt must include an explicit "do not change" clause naming the outfit details (fabric texture, hem shape, accessories) and the background — say "preserve the white lace dress including its scalloped hem and lace trim exactly, do not redesign any garment detail" type wording matched to whatever you see.
- Prompts MUST reference "image 1" as the canonical source.
- If you include creator face/body reference images, refer to them as "additional images of the same subject for identity preservation."

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
function buildWanPrompt(variationPrompt, refCount) {
  const refRange = refCount === 0
    ? ''
    : refCount === 1
    ? ' Additional image (image 2) is a reference photo of the same subject for identity preservation — match her face, body proportions, and skin tone exactly.'
    : ` Additional images (images 2 to ${1 + refCount}) are reference photos of the same subject for identity preservation — match her face, body proportions, and skin tone exactly.`
  return (
    `Image 1 is the canonical source. Recreate the SAME scene, lighting, outfit, props, background, and camera viewpoint exactly as image 1.${refRange}\n\n` +
    `DO NOT redesign any garment detail — the dress, fabric texture, hem shape (including any scallops, fringe, or lace trim), accessories, and jewelry must look identical to image 1.\n` +
    `DO NOT alter the background — every architectural element, distant building, plant, furniture piece, and lighting source must remain pixel-for-pixel as in image 1.\n\n` +
    `${variationPrompt}\n\n` +
    `Hyper realistic, natural skin texture, candid photo session feel, no posed-model stiffness, no text overlay, no watermark.`
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
    const wanSize = pickWanSize(srcW, srcH)
    console.log(`[carousel-variations] source ${srcW}x${srcH} → Wan size ${wanSize}`)

    // 3. Sonnet analyzes the source and plans N variations.
    console.log(`[carousel-variations] Sonnet planning ${n} variations for ${aka}…`)
    const plan = await planVariations(sourceUrl, n)
    console.log(`[carousel-variations] Plan: ${plan.framingType}, ${plan.variations.length} variations`)

    // 4. Submit N Wan calls in parallel. Each fails independently — we
    //    collect successes + per-variation errors rather than aborting
    //    the whole batch.
    const submissions = await Promise.all(plan.variations.map(async (v, i) => {
      try {
        // Fall back to Front refs if Sonnet asked for a pose we don't have
        // (e.g., Back requested but creator only has Front + Face).
        const requested = v.referencesNeeded.length ? v.referencesNeeded : ['front']
        const availablePoses = requested.filter(p => (refsByPose[p] || []).length > 0)
        const effectivePoses = availablePoses.length ? availablePoses : (
          refsByPose.front.length ? ['front'] : ['face']
        )
        const refUrls = pickRefs(effectivePoses, refsByPose)
        const images = [sourceUrl, ...refUrls]
        const promptForWan = buildWanPrompt(v.prompt, refUrls.length)
        console.log(`[carousel-variations] Variation ${i + 1} (${v.label}) → ${images.length} images, poses: ${effectivePoses.join(',')}`)
        const task = await submitWaveSpeedTask(WAN_MODEL, {
          images,
          prompt: promptForWan,
          size: wanSize,
          seed: -1,
        })
        return {
          variationIndex: i,
          label: v.label,
          prompt: v.prompt,
          promptSent: promptForWan,
          posesUsed: effectivePoses,
          refCount: refUrls.length,
          taskId: task.id,
        }
      } catch (err) {
        return { variationIndex: i, label: v.label, prompt: v.prompt, error: err.message }
      }
    }))

    // 5. Poll all submitted tasks in parallel.
    const results = await Promise.all(submissions.map(async (s) => {
      if (s.error) return s
      try {
        const outputUrl = await waitForTask(s.taskId)
        return { ...s, outputUrl }
      } catch (err) {
        return { ...s, error: err.message }
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
