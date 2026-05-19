import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, createAirtableRecord, OPS_BASE } from '@/lib/adminAuth'
import { submitWaveSpeedTask, pollWaveSpeedTask } from '@/lib/wavespeed'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'

export const maxDuration = 300

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const ROOMS = 'Recreate Rooms'
const VARS = 'Recreate Room Variations'
const PALM_CREATORS = 'Palm Creators'
const WAN_MODEL = 'alibaba/wan-2.7/image-edit-pro'

const rawDbx = (u) => u ? String(u).replace('dl=0', 'raw=1').replace('dl=1', 'raw=1') : ''

// 3-role prompt: image 1 = the room (keep 100%), image 2 = pose &
// outfit reference (copy ONLY her body pose + clothing/styling, NOT
// its background or her face), images 3..N = the creator's identity.
function buildPrompt(idRange) {
  return (
    'Image 1 is the FIXED SCENE — this exact room. Keep the room, furniture, '
    + 'layout, windows, the outside view, the rug, décor, wall hangings, '
    + 'plants, lighting, time of day and camera framing EXACTLY as in image 1. '
    + 'Do not change, move, restyle, re-render or re-light the room at all. '
    + 'There is no person in image 1 — add one woman standing in it.\n\n'
    + 'Image 2 is a POSE & OUTFIT reference ONLY. Copy the woman\'s body pose, '
    + 'stance, limb positioning and her clothing/outfit, fabric and styling '
    + 'from image 2. Do NOT copy image 2\'s background, location, lighting, '
    + 'crop or her face/identity — only the pose and what she is wearing.\n\n'
    + `Her IDENTITY — face, skin tone, hair, facial features and body shape — `
    + `must be the EXACT same woman as in ${idRange}. Natural anatomy and `
    + 'realistic proportions.\n\n'
    + 'Composite her standing on the open floor area in front of the bed at a '
    + 'realistic human scale, properly grounded with correct contact shadows, '
    + 'and the light on her matched to the room\'s existing lighting and '
    + 'direction. Hyper realistic, ultra detailed natural skin texture, '
    + 'true-to-life colors, raw iPhone camera style, seamless blend into the '
    + 'scene, no text overlay, no watermark.'
  )
}

async function runWan(images, prompt) {
  const task = await submitWaveSpeedTask(WAN_MODEL, { images, prompt, size: '1080*1920', seed: -1 })
  const t0 = Date.now()
  while (Date.now() - t0 < 270000) {
    const d = await pollWaveSpeedTask(task.id)
    if (d.status === 'completed') {
      const out = (d.outputs || [])[0]
      if (!out) throw new Error('no output')
      return out
    }
    if (d.status === 'failed') throw new Error(d.error || 'Wan edit failed')
    await new Promise(r => setTimeout(r, 3000))
  }
  throw new Error('Stage B timed out')
}

// POST { variationId, poseDropboxPath, refDropboxPaths?: [] }
//  - variationId: an approved Recreate Room Variation = the LOCATION
//    (its image is Wan image 1, kept exactly). Its room → the creator.
//  - poseDropboxPath: a screenshot from a reel = pose+outfit reference.
//  - refDropboxPaths: optional extra per-run identity images.
// Creator's on-file AI Super Clone refs (Front+Face) fill remaining
// slots. Wan caps at 9 images total: [room, pose, ...identity].
export async function POST(request) {
  try {
    await requireAdmin()
    const { variationId, poseDropboxPath, refDropboxPaths } = await request.json()
    if (!variationId || !/^rec[A-Za-z0-9]{14}$/.test(variationId)) {
      return NextResponse.json({ error: 'Valid variationId required' }, { status: 400 })
    }
    if (!poseDropboxPath) {
      return NextResponse.json({ error: 'A pose screenshot is required' }, { status: 400 })
    }

    const vRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(VARS)}/${variationId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' })
    if (!vRes.ok) return NextResponse.json({ error: 'Variation not found' }, { status: 404 })
    const vf = (await vRes.json()).fields || {}
    const roomId = Array.isArray(vf.Room) ? vf.Room[0] : null
    const roomUrl = (vf['Dropbox Link'] && rawDbx(vf['Dropbox Link']))
      || (Array.isArray(vf.Image) && vf.Image[0]?.url) || ''
    if (!roomId) return NextResponse.json({ error: 'Variation has no room' }, { status: 400 })
    if (!roomUrl) return NextResponse.json({ error: 'Variation has no image' }, { status: 400 })

    const rRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(ROOMS)}/${roomId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' })
    if (!rRes.ok) return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    const rf = (await rRes.json()).fields || {}
    const roomName = rf['Room Name'] || 'Room'
    const creatorId = Array.isArray(rf.Creator) ? rf.Creator[0] : null
    if (!creatorId) return NextResponse.json({ error: 'Room has no linked creator' }, { status: 400 })

    const cRecs = await fetchAirtableRecords(PALM_CREATORS, {
      filterByFormula: `RECORD_ID() = '${creatorId}'`,
      fields: ['AKA', 'AI Ref Inputs'],
      maxRecords: 1,
    })
    if (!cRecs.length) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
    const aka = cRecs[0].fields.AKA || 'Creator'
    const allRefs = cRecs[0].fields['AI Ref Inputs'] || []
    const front = allRefs.filter(a => a.filename?.startsWith('Front View input_'))
    const face = allRefs.filter(a => a.filename?.startsWith('Close Up Face input_'))
    const onFileRefs = [...front, ...face]

    // Turn Dropbox paths (browser-uploaded) into raw shared-link URLs.
    const tok = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(tok)
    const pathToUrl = async (p) => {
      try { return rawDbx(await createDropboxSharedLink(tok, ns, p)) } catch { return '' }
    }
    const poseUrl = await pathToUrl(poseDropboxPath)
    if (!poseUrl) return NextResponse.json({ error: 'Could not link the pose screenshot' }, { status: 400 })
    const extraUrls = []
    for (const p of (Array.isArray(refDropboxPaths) ? refDropboxPaths : [])) {
      const u = await pathToUrl(p)
      if (u) extraUrls.push(u)
    }

    // Wan cap = 9 total: [room, pose, ...identity]. Identity = uploaded
    // extras first, then on-file AI refs, filling remaining slots.
    const identity = [...extraUrls, ...onFileRefs.map(a => a.url)]
    if (identity.length === 0) {
      return NextResponse.json({ error: `No identity references — upload some for this run, or set up ${aka}'s AI Super Clone refs.` }, { status: 400 })
    }
    const images = [roomUrl, poseUrl, ...identity].slice(0, 9)
    const idCount = images.length - 2
    const idRange = idCount === 1 ? 'image 3' : `images 3 to ${images.length}`
    const prompt = buildPrompt(idRange)
    const outUrl = await runWan(images, prompt)

    const folderSafe = String(roomName).replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'Room'
    const name = `Stage B · ${aka}`
    let dbxPath = '', dbxLink = ''
    try {
      const ir = await fetch(outUrl)
      if (ir.ok) {
        const buf = Buffer.from(await ir.arrayBuffer())
        dbxPath = `/Palm Ops/Recreate Rooms/${folderSafe}/_stageB/${aka}-${Date.now()}.jpg`.replace(/[^ -~]/g, '')
        await uploadToDropbox(tok, ns, dbxPath, buf, { overwrite: true })
        try { dbxLink = await createDropboxSharedLink(tok, ns, dbxPath) } catch {}
      }
    } catch (e) {
      console.warn(`[recreate-rooms/stage-b] Dropbox save failed: ${e.message}`)
    }

    await createAirtableRecord(VARS, {
      Variation: `${roomName} - ${name}`,
      Room: [roomId],
      Recipe: name,
      'Prompt Used': prompt,
      Image: [{ url: outUrl }],
      ...(dbxPath ? { 'Dropbox Path': dbxPath } : {}),
      ...(dbxLink ? { 'Dropbox Link': dbxLink } : {}),
      Status: 'Pending',
    })
    return NextResponse.json({ ok: true, images: images.length })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
