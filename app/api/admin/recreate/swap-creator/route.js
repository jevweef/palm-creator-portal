import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { submitWaveSpeedTask } from '@/lib/wavespeed'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'
import { POSES } from '@/lib/aiCloneConfig'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PALM_CREATORS = 'Palm Creators'
// Pro tier produces noticeably better skin/hair detail than standard.
// $0.075/run vs $0.03 — worth it given output feeds the rest of the pipeline.
const WAN_MODEL = 'alibaba/wan-2.7/image-edit-pro'

// shotType → pose key in POSES → AI Ref Inputs filename prefix
const SHOT_TO_POSE = { 'close-up': 'face', 'front': 'front', 'back': 'back' }

function rawDropboxUrl(url) {
  if (!url) return ''
  return url.replace(/[?&]dl=0/, '').replace(/([?&]raw=1)?$/, '') + (url.includes('?') ? '&raw=1' : '?raw=1')
}

async function ensureFolder(accessToken, rootNamespaceId, path) {
  const res = await fetch('https://api.dropboxapi.com/2/files/create_folder_v2', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root: rootNamespaceId }),
    },
    body: JSON.stringify({ path, autorename: false }),
  })
  if (res.ok) return
  const text = await res.text()
  if (text.includes('path/conflict/folder') || text.includes('already_exists') || res.status === 409) return
  throw new Error(`Dropbox folder create failed (${res.status}): ${text}`)
}

// POST — body: {
//   creatorId, shotType, positivePrompt,
//   preserveScene?: boolean — if true, source frame is sent as image[0]
//     to anchor exact composition. Prompt gets wrapped with "edit the
//     first image, replace identity from images 2-9".
//   frameUrl?, frameDataUrl?, shortcode? — only used when preserveScene
// }
// Returns: { ok, taskId, referenceCount, pose, mode }
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorId, shotType, positivePrompt, negativePrompt, preserveScene, frameUrl, frameDataUrl, shortcode } = await request.json()
    if (!creatorId) return NextResponse.json({ error: 'Missing creatorId' }, { status: 400 })
    if (!positivePrompt) return NextResponse.json({ error: 'Missing positivePrompt' }, { status: 400 })
    if (preserveScene && !frameUrl && !frameDataUrl) {
      return NextResponse.json({ error: 'preserveScene requires frameUrl or frameDataUrl' }, { status: 400 })
    }

    const poseKey = SHOT_TO_POSE[shotType] || 'front'
    const poseConfig = POSES[poseKey]

    // Fetch creator AKA + AI Ref Inputs
    const records = await fetchAirtableRecords(PALM_CREATORS, {
      filterByFormula: `RECORD_ID() = '${creatorId}'`,
      fields: ['AKA', 'AI Ref Inputs'],
      maxRecords: 1,
    })
    if (!records.length) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
    const aka = records[0].fields.AKA
    if (!aka) return NextResponse.json({ error: 'Creator missing AKA' }, { status: 400 })

    const allInputs = records[0].fields['AI Ref Inputs'] || []
    const refInputs = allInputs.filter(att => att.filename?.startsWith(`${poseConfig.fileLabel} input_`))
    if (refInputs.length === 0) {
      return NextResponse.json({
        error: `No ${poseConfig.fileLabel} input photos found for ${aka}. Set up the Super Clone references first (Admin → Creators → DNA → AI Super Clone).`,
      }, { status: 400 })
    }

    let images = []
    let finalPrompt = positivePrompt
    let mode = 'subject-only'
    let referenceFilenames = []

    if (preserveScene) {
      // Send source frame as image[0] so Wan has to match the actual scene,
      // composition, lighting, and small imperfections from the original.
      // Cap creator refs at 8 to fit 9-image limit.
      mode = 'scene-preserving'

      // Resolve source frame to a public URL
      let resolvedFrameUrl
      if (frameDataUrl) {
        const match = frameDataUrl.match(/^data:image\/([a-z]+);base64,(.+)$/i)
        if (!match) return NextResponse.json({ error: 'Invalid frameDataUrl' }, { status: 400 })
        const ext = match[1].toLowerCase()
        const safeExt = ['jpeg', 'jpg', 'png', 'webp'].includes(ext) ? (ext === 'jpeg' ? 'jpg' : ext) : 'jpg'
        const buf = Buffer.from(match[2], 'base64')
        const accessToken = await getDropboxAccessToken()
        const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)
        const folder = `/Palm Ops/Creators/${aka}/recreations${shortcode ? `/${shortcode}` : ''}`
        await ensureFolder(accessToken, rootNamespaceId, '/Palm Ops/Creators')
        await ensureFolder(accessToken, rootNamespaceId, `/Palm Ops/Creators/${aka}`)
        await ensureFolder(accessToken, rootNamespaceId, `/Palm Ops/Creators/${aka}/recreations`)
        if (shortcode) await ensureFolder(accessToken, rootNamespaceId, folder)
        const filename = `source-frame.${safeExt}`
        const dropboxPath = `${folder}/${filename}`
        await uploadToDropbox(accessToken, rootNamespaceId, dropboxPath, buf, { overwrite: true })
        const sharedLink = await createDropboxSharedLink(accessToken, rootNamespaceId, dropboxPath)
        resolvedFrameUrl = `${rawDropboxUrl(sharedLink)}&t=${Date.now()}`
      } else {
        resolvedFrameUrl = frameUrl
      }

      const creatorRefUrls = refInputs.slice(0, 8).map(att => att.url)
      images = [resolvedFrameUrl, ...creatorRefUrls]
      referenceFilenames = ['(source frame)', ...refInputs.slice(0, 8).map(att => att.filename)]

      // Wan 2.7 image-edit canonical format per WaveSpeed docs:
      //   "Figure 1" = canvas, "Figures 2-N" = character references
      //   Short Change/Keep instruction sentences (NOT long paragraphs)
      //
      // Per the verbatim examples on wavespeed.ai/models/alibaba/wan-2.7/image-edit
      // and replicate.com/wan-video/wan-2.7-image, the documented pattern is
      // 1-2 short sentences with explicit Change/Keep clauses.
      const refCount = images.length - 1
      const refRange = refCount === 1 ? 'Figure 2' : `Figures 2 through ${1 + refCount}`
      finalPrompt =
        `Replace the woman in Figure 1 with the woman shown in ${refRange}.\n\n` +
        `FROM ${refRange.toUpperCase()} (the woman to render), take ALL of these features exactly as shown:\n` +
        `• Face: face shape, eye shape and color, eyebrow shape, nose shape, lip shape and fullness, jawline, cheekbones, chin, ear shape\n` +
        `• Hair: exact color and highlights, length, texture (straight/wavy/curly), styling, hairline\n` +
        `• Body type: overall build (slim/athletic/curvy as shown in references — match exactly)\n` +
        `• Body proportions: ribcage width, bust size and shape, waist circumference, hip width, hip-to-waist ratio, shoulder width, arm shape and length, leg shape and length, overall height-to-width ratio\n` +
        `• Skin: skin tone, undertone, natural texture, any visible freckles or moles, body hair pattern\n\n` +
        `Do NOT inherit any of these features from the woman in Figure 1. The body proportions and silhouette of Figure 1's original woman are NOT preserved.\n\n` +
        `KEEP from Figure 1 only: the room/scene, lighting (direction and quality), camera framing and angle, the woman's pose (hand positions, head angle, weight distribution, foot placement), her gaze direction and facial expression. The wardrobe's TYPE, COLOR, and STYLE stay the same, but the wardrobe RESIZES to fit the new body naturally.\n\n` +
        `Scene details: ${positivePrompt}`
    } else {
      // Subject-only mode (current default) — only creator references
      const creatorRefUrls = refInputs.slice(0, 9).map(att => att.url)
      if (creatorRefUrls.length === 0) {
        return NextResponse.json({ error: `No usable reference URLs for ${poseConfig.fileLabel}` }, { status: 400 })
      }
      images = creatorRefUrls
      referenceFilenames = refInputs.map(att => att.filename)
    }

    // Don't append the negative prompt inline — Wan reads "Negative prompt:
    // plastic skin..." as content tokens (same problem as "no X" phrases),
    // produces artifacts. Wan handles negation via positive descriptions only.
    const promptForWan = finalPrompt

    // Match the AI Super Clone reference photo resolution (1080x1920) to
    // avoid scale-mismatch artifacts. Pro model still gives a cleaner render
    // at this resolution than the Standard model would.
    const body = { images, prompt: promptForWan, size: '1080*1920', seed: -1 }

    console.log(`[swap-creator] Sending to Wan 2.7 — mode=${mode}, ${images.length} input images for ${aka}:`)
    referenceFilenames.forEach((f, i) => console.log(`  ${i + 1}. ${f}`))

    const task = await submitWaveSpeedTask(WAN_MODEL, body)
    return NextResponse.json({
      ok: true,
      taskId: task.id,
      referenceCount: images.length,
      pose: poseKey,
      mode,
      referenceFilenames,
      // Surface the actual prompt sent to Wan for transparency — includes the
      // full wrapper (FROM/KEEP/Scene structure) prepended to Sonnet's positive.
      promptSent: promptForWan,
    })
  } catch (err) {
    console.error('[recreate/swap-creator] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
