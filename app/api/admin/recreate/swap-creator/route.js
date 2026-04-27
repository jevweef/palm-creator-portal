import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { submitWaveSpeedTask } from '@/lib/wavespeed'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'
import { POSES } from '@/lib/aiCloneConfig'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PALM_CREATORS = 'Palm Creators'
const WAN_MODEL = 'alibaba/wan-2.7/image-edit'

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
//   creatorId, shotType, shortcode?,
//   frameUrl? (remote URL accessible to WaveSpeed) OR frameDataUrl? (data:image/...),
//   positivePrompt
// }
// Returns: { ok, taskId, referenceCount, sourceFrameUrl }
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorId, shotType, shortcode, frameUrl, frameDataUrl, positivePrompt } = await request.json()
    if (!creatorId) return NextResponse.json({ error: 'Missing creatorId' }, { status: 400 })
    if (!positivePrompt) return NextResponse.json({ error: 'Missing positivePrompt' }, { status: 400 })
    if (!frameUrl && !frameDataUrl) return NextResponse.json({ error: 'Missing source frame' }, { status: 400 })

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

    // Resolve source frame URL — Wan 2.7 needs publicly accessible URLs
    let resolvedFrameUrl
    if (frameDataUrl) {
      // data URL — upload to Dropbox and get a shared link
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

    // Build images array — Wan 2.7 accepts 1-9. Source frame first, then
    // creator reference inputs from the matching pose.
    const referenceUrls = refInputs.slice(0, 8).map(att => att.url) // leave room for source frame
    const images = [resolvedFrameUrl, ...referenceUrls]

    // Submit to Wan 2.7 image-edit
    const body = {
      images,
      prompt: positivePrompt,
      size: '1080*1920',
      seed: -1,
    }

    const task = await submitWaveSpeedTask(WAN_MODEL, body)
    return NextResponse.json({
      ok: true,
      taskId: task.id,
      referenceCount: referenceUrls.length,
      pose: poseKey,
      sourceFrameUrl: resolvedFrameUrl,
    })
  } catch (err) {
    console.error('[recreate/swap-creator] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
