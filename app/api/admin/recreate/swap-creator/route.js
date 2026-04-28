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

      // Wan 2.7 prefers distinct descriptors over run-on text and the
      // explicit "Change X / Keep Y" pattern with "image 1, image 2..."
      // notation per the WaveSpeed/RunComfy docs.
      //
      // image 1 = inspo frame (canvas — keep its scene/pose/wardrobe)
      // images 2-9 = creator references (take her face/body/hair from these)
      const refCount = images.length - 1
      finalPrompt =
        `Image 1 is the canvas. Images 2-${1 + refCount} are character references for the woman.\n\n` +
        `CHANGE in image 1: replace the woman's face, hair (color/length/texture/styling), body shape, body proportions (build, hip-to-waist ratio, bust size, shoulder width, arm/leg shape), and skin tone — match these to the woman in images 2-${1 + refCount}. The reference woman's full body must take over — do not preserve image 1's original silhouette or proportions.\n\n` +
        `KEEP from image 1: the room/scene. The lighting. The camera framing and angle. The woman's pose (hand positions, head angle, weight distribution, foot placement). Her wardrobe (the clothing items, fitted to the new body). Her facial expression and gaze direction. Hair direction and motion. Small imperfections in the scene.\n\n` +
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

    // Wan 2.7 Image Edit Pro: per-dimension range 512-4096, BUT the i2i
    // (with reference images) total-pixel cap is 4,194,304 (2K). 9:16 max
    // safely under that = 1440x2560 (3.7M px).
    const body = { images, prompt: promptForWan, size: '1440*2560', seed: -1 }

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
