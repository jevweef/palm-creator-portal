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

      // Wrap the prompt with explicit edit instruction. The first image is
      // the canvas; images 2-9 are FULL CHARACTER references — face, body,
      // hair, proportions all come from those, not from image 1.
      //
      // Critical: tell Wan explicitly to swap body proportions too, not just
      // face. Default behavior keeps the original creator's body shape with
      // a face-only swap, which produces a chimera. We want full character
      // replacement: take her body from refs, only the pose/scene/wardrobe
      // come from image 1.
      finalPrompt =
        `Edit the first image. Fully replace the woman with the woman shown in the other reference images. Replace HER ENTIRE BODY: face, hair (color, length, texture, styling from the refs), body shape and proportions (build, height ratio, hip-to-waist ratio, bust size, shoulder width, arm/leg shape), skin tone and texture. The reference woman's body must fully take over — do NOT keep the original woman's body silhouette, proportions, or shape.\n\n` +
        `Keep from the first image: the room/scene, lighting (direction and quality), camera framing and tilt, the woman's POSE (where her hands are, head angle, weight distribution, foot placement), wardrobe items (what she's wearing — but the wardrobe should fit and drape correctly on the new body), facial expression, gaze direction, hair direction/motion, and any small imperfections (rumples in bedding, used objects). Do not "tidy up" the scene.\n\n` +
        `Detailed scene description (image 1 is the source of truth for scene/pose; the reference images are the source of truth for body/identity): ${positivePrompt}`
    } else {
      // Subject-only mode (current default) — only creator references
      const creatorRefUrls = refInputs.slice(0, 9).map(att => att.url)
      if (creatorRefUrls.length === 0) {
        return NextResponse.json({ error: `No usable reference URLs for ${poseConfig.fileLabel}` }, { status: 400 })
      }
      images = creatorRefUrls
      referenceFilenames = refInputs.map(att => att.filename)
    }

    // Append "Negative prompt:" inline. Wan 2.7 image-edit doesn't have a
    // formal negative_prompt parameter, but some image models parse this
    // convention. Worst case Wan ignores it; best case it suppresses
    // unwanted aesthetics (plastic skin, magazine vibe, etc.).
    let promptForWan = finalPrompt
    if (negativePrompt && negativePrompt.trim()) {
      promptForWan = `${finalPrompt}\n\nNegative prompt: ${negativePrompt.trim()}`
    }

    // Wan 2.7 Image Edit Pro range is 512-4096 per side. Max 9:16 = 2304x4096.
    const body = { images, prompt: promptForWan, size: '2304*4096', seed: -1 }

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
    })
  } catch (err) {
    console.error('[recreate/swap-creator] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
