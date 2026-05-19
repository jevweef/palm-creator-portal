import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, createAirtableRecord, OPS_BASE } from '@/lib/adminAuth'
import { submitWaveSpeedTask, pollWaveSpeedTask } from '@/lib/wavespeed'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'
import Anthropic from '@anthropic-ai/sdk'
import { buildStreamPosterUrl } from '@/lib/cfStreamUrl'

export const maxDuration = 300

// Sonnet looks at the reel screenshot and says how the subject is
// framed, so we can match it to a room of similar tightness.
async function classifyScreenshotFraming(imgUrl) {
  try {
    const r = await fetch(imgUrl)
    if (!r.ok) return null
    const b64 = Buffer.from(await r.arrayBuffer()).toString('base64')
    const ct = r.headers.get('content-type') || ''
    const m = ct.match(/^(image\/[a-z]+)/i)
    const mediaType = m ? m[1].toLowerCase().replace('image/jpg', 'image/jpeg') : 'image/jpeg'
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      tools: [{
        name: 'submit_framing',
        description: 'Report how the person in this reel screenshot is framed.',
        input_schema: {
          type: 'object',
          properties: {
            framing: {
              type: 'string',
              enum: ['Wide', 'Medium', 'Tight'],
              description: '"Wide" = full body, her feet/whole figure visible; "Medium" = roughly knees/thighs-up; "Tight" = punched-in, only waist-up or chest-up.',
            },
          },
          required: ['framing'],
        },
      }],
      tool_choice: { type: 'tool', name: 'submit_framing' },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
          { type: 'text', text: 'Classify how the person is framed using submit_framing.' },
        ],
      }],
    })
    const t = resp.content.find(b => b.type === 'tool_use')
    return ['Wide', 'Medium', 'Tight'].includes(t?.input?.framing) ? t.input.framing : null
  } catch { return null }
}

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

// POST { creatorId, poseStreamUid, poseTime, refDropboxPaths?: [] }
//  - creatorId: the creator to insert. Their OWN rooms are the
//    location pool (a room = that creator's virtual bedroom).
//  - poseStreamUid + poseTime: the reel's Cloudflare Stream UID and
//    the timestamp (seconds) to grab as the pose+outfit frame. We use
//    Stream's thumbnail-at-time JPG directly (public URL, no CORS).
//  - refDropboxPaths: optional extra per-run identity images.
// The system Sonnet-classifies the screenshot framing and auto-picks
// the creator's room ANGLE whose framing best matches (full-body →
// Wide, cropped → Tight), then a RANDOM approved variation of it.
// Identity = extras + the creator's Front/Face/Back AI refs. Wan
// caps at 9: [room, pose, ...identity (max 7)].
export async function POST(request) {
  try {
    await requireAdmin()
    const { creatorId, poseStreamUid, poseTime, refDropboxPaths } = await request.json()
    if (!creatorId || !/^rec[A-Za-z0-9]{14}$/.test(creatorId)) {
      return NextResponse.json({ error: 'Valid creatorId required' }, { status: 400 })
    }
    if (!poseStreamUid) {
      return NextResponse.json({ error: 'A captured pose frame is required (reel has no Stream video)' }, { status: 400 })
    }
    // CF Stream thumbnails 404 on fit=scale-down with width-only and on
    // time=0 — use fit=crop and a non-zero floor (matches what the UI shows).
    const tSec = Math.max(0.1, Number(poseTime) || 0)
    const poseUrl = buildStreamPosterUrl(poseStreamUid, { time: `${tSec}s`, width: 1080, fit: 'crop' })
    if (!poseUrl) return NextResponse.json({ error: 'Could not build pose frame URL' }, { status: 400 })

    const cRecs = await fetchAirtableRecords(PALM_CREATORS, {
      filterByFormula: `RECORD_ID() = '${creatorId}'`,
      fields: ['AKA', 'AI Ref Inputs', 'AI Ref Front', 'AI Ref Back', 'AI Ref Face'],
      maxRecords: 1,
    })
    if (!cRecs.length) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
    const cf = cRecs[0].fields
    const aka = cf.AKA || 'Creator'
    // Prefer the APPROVED single best ref per angle (curated via AI Super
    // Clone). Fall back to the raw multi-pose AI Ref Inputs dump only for
    // creators whose refs haven't been approved yet.
    const approvedFace = cf['AI Ref Face'] || []
    const approvedFront = cf['AI Ref Front'] || []
    const approvedBack = cf['AI Ref Back'] || []
    let onFileRefs = [...approvedFace, ...approvedFront, ...approvedBack]
    if (onFileRefs.length === 0) {
      const allRefs = cf['AI Ref Inputs'] || []
      const front = allRefs.filter(a => a.filename?.startsWith('Front View input_'))
      const face = allRefs.filter(a => a.filename?.startsWith('Close Up Face input_'))
      const back = allRefs.filter(a => a.filename?.startsWith('Back View input_'))
      for (let i = 0; i < Math.max(face.length, front.length, back.length); i++) {
        if (face[i]) onFileRefs.push(face[i])
        if (front[i]) onFileRefs.push(front[i])
        if (back[i]) onFileRefs.push(back[i])
      }
    }

    const tok = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(tok)
    const pathToUrl = async (p) => {
      try { return rawDbx(await createDropboxSharedLink(tok, ns, p)) } catch { return '' }
    }
    const extraUrls = []
    for (const p of (Array.isArray(refDropboxPaths) ? refDropboxPaths : [])) {
      const u = await pathToUrl(p)
      if (u) extraUrls.push(u)
    }

    // Classify the screenshot, then auto-pick this creator's room
    // whose Framing best matches; random approved variation within it.
    const shotFraming = await classifyScreenshotFraming(poseUrl)
    const allRooms = await fetchAirtableRecords(ROOMS, { fields: ['Room Name', 'Creator', 'Framing'] })
    const myRooms = allRooms.filter(r => (r.fields?.Creator || []).includes(creatorId))
    if (myRooms.length === 0) {
      return NextResponse.json({ error: `${aka} has no rooms yet. Create & approve a room for this creator in the Rooms tab first.` }, { status: 400 })
    }
    const myRoomIds = new Set(myRooms.map(r => r.id))
    const allVars = await fetchAirtableRecords(VARS, { fields: ['Variation', 'Room', 'Status', 'Image', 'Dropbox Link'] })
    const approved = allVars.filter(v =>
      (v.fields?.Status?.name || v.fields?.Status) === 'Approved'
      && (v.fields?.Room || []).some(rid => myRoomIds.has(rid)))
    if (approved.length === 0) {
      return NextResponse.json({ error: `${aka} has no approved room variations yet. Approve some in the Rooms tab.` }, { status: 400 })
    }
    const order = ['Wide', 'Medium', 'Tight']
    const framingOf = (v) => {
      const rid = (v.fields?.Room || [])[0]
      return myRooms.find(r => r.id === rid)?.fields?.Framing?.name
        || myRooms.find(r => r.id === rid)?.fields?.Framing || null
    }
    let pool = approved
    if (shotFraming) {
      const exact = approved.filter(v => framingOf(v) === shotFraming)
      if (exact.length) pool = exact
      else {
        // nearest framing by the Wide→Medium→Tight scale
        const si = order.indexOf(shotFraming)
        let best = null, bestD = 99
        for (const v of approved) {
          const fi = order.indexOf(framingOf(v))
          if (fi < 0) continue
          const d = Math.abs(fi - si)
          if (d < bestD) { bestD = d; best = framingOf(v) }
        }
        if (best) pool = approved.filter(v => framingOf(v) === best)
      }
    }
    const chosen = pool[Math.floor(Math.random() * pool.length)]
    const vf = chosen.fields || {}
    const roomUrl = (vf['Dropbox Link'] && rawDbx(vf['Dropbox Link']))
      || (Array.isArray(vf.Image) && vf.Image[0]?.url) || ''
    if (!roomUrl) return NextResponse.json({ error: 'Picked variation has no image' }, { status: 400 })
    const roomId = (vf.Room || [])[0] || null
    const chosenRoomName = myRooms.find(r => r.id === roomId)?.fields?.['Room Name'] || 'Room'
    const chosenFraming = framingOf(chosen) || 'unclassified'

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

    const locName = chosenRoomName
    const folderSafe = locName.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'Room'
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
      Variation: `${locName} - ${name}`,
      ...(roomId ? { Room: [roomId] } : {}),
      Recipe: name,
      'Prompt Used': prompt,
      Image: [{ url: outUrl }],
      ...(dbxPath ? { 'Dropbox Path': dbxPath } : {}),
      ...(dbxLink ? { 'Dropbox Link': dbxLink } : {}),
      Status: 'Pending',
    })
    return NextResponse.json({
      ok: true, imageCount: images.length,
      out: outUrl,
      dropbox: dbxLink || null,
      room: chosenRoomName, roomFraming: chosenFraming,
      screenshotFraming: shotFraming || 'unknown',
    })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
