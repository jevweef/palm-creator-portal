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

function buildPrompt(refRange, poseText) {
  return (
    'Use image 1 as the fixed environment — this exact room. Keep the room, '
    + 'furniture, layout, windows, the outside view, the rug, décor, wall '
    + 'hangings, plants, lighting, time of day and camera perspective EXACTLY '
    + 'as in image 1. Do not change, move, restyle, re-render or re-light the '
    + 'room in any way.\n\n'
    + `There is no person in image 1 — ADD one woman into this room. She is the `
    + `EXACT same woman as in ${refRange}: match her face, skin tone, hair and `
    + 'body shape to those references precisely, with natural anatomy and '
    + 'realistic proportions.\n\n'
    + `Her pose: ${poseText}. She stands on the open floor area in front of the `
    + 'bed at a realistic human scale, properly grounded with correct contact '
    + 'shadows on the floor, and the light on her matched to the room\'s '
    + 'existing lighting and direction.\n\n'
    + 'Hyper realistic, ultra detailed natural skin texture, true-to-life '
    + 'colors, raw iPhone camera style, seamless blend into the scene, no text '
    + 'overlay, no watermark.'
  )
}

async function runWan(images, prompt) {
  const task = await submitWaveSpeedTask(WAN_MODEL, { images, prompt, size: '1080*1920', seed: -1 })
  const t0 = Date.now()
  while (Date.now() - t0 < 240000) {
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

// POST { variationId, poseText } — insert the room's creator into an
// approved room variation, in the given pose, room untouched. Saves the
// result as a new variation under the same room.
export async function POST(request) {
  try {
    await requireAdmin()
    const { variationId, poseText } = await request.json()
    if (!variationId || !/^rec[A-Za-z0-9]{14}$/.test(variationId)) {
      return NextResponse.json({ error: 'Valid variationId required' }, { status: 400 })
    }
    const pose = String(poseText || '').trim()
    if (!pose) return NextResponse.json({ error: 'poseText required' }, { status: 400 })

    // Variation → its room image + parent room → creator
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

    // Creator identity refs: front-body + face inputs from AI Super Clone.
    const cRecs = await fetchAirtableRecords(PALM_CREATORS, {
      filterByFormula: `RECORD_ID() = '${creatorId}'`,
      fields: ['AKA', 'AI Ref Inputs'],
      maxRecords: 1,
    })
    if (!cRecs.length) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
    const aka = cRecs[0].fields.AKA || 'Creator'
    const all = cRecs[0].fields['AI Ref Inputs'] || []
    const front = all.filter(a => a.filename?.startsWith('Front View input_'))
    const face = all.filter(a => a.filename?.startsWith('Close Up Face input_'))
    const refs = [...front, ...face].slice(0, 7)
    if (refs.length === 0) {
      return NextResponse.json({ error: `No AI Super Clone reference photos for ${aka}. Set them up under Creators → DNA → AI Super Clone.` }, { status: 400 })
    }

    const images = [roomUrl, ...refs.map(a => a.url)]
    const refRange = images.length === 2 ? 'image 2' : `images 2 to ${images.length}`
    const prompt = buildPrompt(refRange, pose)
    const outUrl = await runWan(images, prompt)

    // Save the composite as a new variation under the same room.
    const folderSafe = String(roomName).replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'Room'
    const name = `Stage B · ${aka}`
    let dbxPath = '', dbxLink = ''
    try {
      const ir = await fetch(outUrl)
      if (ir.ok) {
        const buf = Buffer.from(await ir.arrayBuffer())
        const tok = await getDropboxAccessToken()
        const ns = await getDropboxRootNamespaceId(tok)
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
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
