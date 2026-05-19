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
// Finished Stage B content lives here — NOT in VARS. VARS is the
// empty-room location pool that Stage B itself draws from; writing
// creator-in-room images back into it would let a future run pick a
// populated frame as a "room" backdrop.
const STAGE_B_OUTPUTS = 'Stage B Outputs'
const WAN_MODEL = 'alibaba/wan-2.7/image-edit-pro'

const rawDbx = (u) => u ? String(u).replace('dl=0', 'raw=1').replace('dl=1', 'raw=1') : ''

// Fixed seed: the official Wan docs recommend a stable seed so prompt
// iterations are comparable. Identity is still being dialed in; can
// randomise later once it locks.
const STAGE_B_SEED = 77777

// TWO-PASS pipeline. A single pass can't both match the reel
// (pose/outfit/framing) AND keep the creator's identity — feeding the
// reel frame as a person ref makes the model blend the reel girl's
// face in ("wrong girl", proven from a real failed call). So:
//
//   Pass 1 — pose/outfit/framing transfer. Figure 1 = empty room,
//     Figure 2 = reel screenshot. Put a woman in the room copying the
//     reel's pose, exact outfit and camera distance/crop. Identity is
//     irrelevant here (Pass 2 replaces it).
//   Pass 2 — identity face-swap. Figure 1 = Pass 1 output, Figures
//     2..N = the creator's AI refs. Swap ONLY the face/identity; keep
//     her pose, body, outfit, the room and framing byte-identical.
//     Face-swap is the one operation this model is reliably good at.
//
// Both prompts use the official two-part "WHAT TO DO / WHAT TO KEEP"
// structure with ordinal Figure refs (Figure N = images[N-1]).

// TWO-STEP, both wan image-edit-pro (no dedicated face-swap — user
// rejected it). Step 1 = reel creator composited into the locked room
// (pose/outfit/framing). Step 2 = take Step-1's clean composite and
// replace the PERSON with the creator's identity. Editing a clean
// composite (Step 2) is a cleaner identity task than fighting a raw
// reel screenshot in one shot.

// Step 1 — pose/outfit/framing into the room. Identity irrelevant.
function buildPosePrompt() {
  return (
    'WHAT TO DO: Figure 1 is an empty room with no person in it. Add exactly '
    + 'one woman standing in it. Copy her body pose, stance, limb positioning, '
    + 'her exact clothing and outfit (garments, colours, fabric, styling), and '
    + "the camera distance, crop and how close she is to the camera, all from "
    + 'Figure 2. Match Figure 2\'s framing exactly. Ground her realistically '
    + 'with correct contact shadows and lighting that matches the room.\n\n'
    + 'WHAT TO KEEP: Keep the room in Figure 1 completely unchanged. Do NOT '
    + "copy Figure 2's background, room or location — only the woman's pose, "
    + 'outfit and the camera framing.\n\n'
    + 'Hyper realistic, raw iPhone photo look, no text, no watermark.'
  )
}

// Step 2 — Figure 1 is the finished Step-1 composite; Figures 2..N are
// the creator. Replace the person's identity AND body to be exactly her,
// keeping pose/outfit/room/framing/lighting byte-identical.
function buildSwapPrompt(idList) {
  return (
    `WHAT TO DO: Figure 1 is a finished photo of a woman standing in a room. `
    + `Change WHO she is: her face, head, hair, skin tone and her body shape `
    + `and proportions must become EXACTLY the woman shown in ${idList} (the `
    + `same real individual across those reference photos — not a lookalike). `
    + `Reproduce her precise facial structure, eye shape and spacing, `
    + `eyebrows, nose, lips, jawline, hairline and skin tone from ${idList} `
    + `faithfully. She must be unmistakably that person.\n\n`
    + 'WHAT TO KEEP: Keep EVERYTHING ELSE in Figure 1 byte-identical — her '
    + 'exact body pose, stance and hands, her full outfit and clothing, the '
    + 'entire room and its contents, the lighting and the camera distance, '
    + 'crop and framing. Only the identity (face + body shape) changes; '
    + 'nothing else moves or re-renders.\n\n'
    + 'Hyper realistic, ultra-detailed natural skin texture, seamless, no '
    + 'text, no watermark.'
  )
}


async function pollWaveSpeed(taskId, label, maxMs) {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    const d = await pollWaveSpeedTask(taskId)
    if (d.status === 'completed') {
      const out = (d.outputs || [])[0]
      if (!out) throw new Error(`${label}: no output`)
      return out
    }
    if (d.status === 'failed') {
      const e = typeof d.error === 'string' && d.error ? d.error
        : d.error ? JSON.stringify(d.error) : 'failed'
      throw new Error(`${label}: ${e}`)
    }
    await new Promise(r => setTimeout(r, 3000))
  }
  throw new Error(`${label}: timed out`)
}

async function runWan(images, prompt, maxMs = 120000) {
  const task = await submitWaveSpeedTask(WAN_MODEL, { images, prompt, size: '1080*1920', seed: STAGE_B_SEED })
  return pollWaveSpeed(task.id, 'Wan', maxMs)
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
// Then a two-pass Wan run: Pass 1 = reel pose/outfit/framing into the
// room; Pass 2 = face-swap the creator's identity (extras + Face/Front/
// Back AI refs) onto Pass 1.
export async function POST(request) {
  try {
    await requireAdmin()
    const { creatorId, poseStreamUid, poseTime, refDropboxPaths, reelRecordId } = await request.json()
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
    // Clone): face first (identity weight), then front (body/grounding),
    // then back. Fall back to the raw multi-pose AI Ref Inputs dump only
    // for creators whose refs haven't been approved yet.
    const approvedFace = cf['AI Ref Face'] || []
    const approvedFront = cf['AI Ref Front'] || []
    const approvedBack = cf['AI Ref Back'] || []
    let onFileRefs = [...approvedFace, ...approvedFront, ...approvedBack]
    if (onFileRefs.length === 0) {
      const allRefs = cf['AI Ref Inputs'] || []
      const face = allRefs.filter(a => a.filename?.startsWith('Close Up Face input_'))
      const front = allRefs.filter(a => a.filename?.startsWith('Front View input_'))
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

    const identity = [...extraUrls, ...onFileRefs.map(a => a.url)]
    if (identity.length === 0) {
      return NextResponse.json({ error: `No identity references — upload some for this run, or set up ${aka}'s AI Super Clone refs.` }, { status: 400 })
    }

    const locName = chosenRoomName
    const folderSafe = locName.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'Room'
    const reelShort = (reelRecordId && /^rec[A-Za-z0-9]{14}$/.test(reelRecordId)) ? reelRecordId : null

    // TWO-STEP, both wan image-edit-pro (sequential; ~40-112s each, 130s
    // cap each keeps total under the 300s route budget).
    //   Step 1: room + reel frame → reel creator in the locked room.
    //   Step 2: Step-1 composite + identity refs → swap to the creator.
    const posePrompt = buildPosePrompt()
    const step1Out = await runWan([roomUrl, poseUrl], posePrompt, 130000)

    const swapImages = [step1Out, ...identity].slice(0, 9)
    const figs = []
    for (let i = 2; i <= swapImages.length; i++) figs.push(`Figure ${i}`)
    const idList = figs.length <= 1 ? (figs[0] || 'Figure 2')
      : `${figs.slice(0, -1).join(', ')} and ${figs[figs.length - 1]}`
    const swapPrompt = buildSwapPrompt(idList)
    const outUrl = await runWan(swapImages, swapPrompt, 130000)
    const prompt = `STEP 1 (${WAN_MODEL}):\n${posePrompt}\n\n---\n\nSTEP 2 (${WAN_MODEL}):\n${swapPrompt}`

    let dbxPath = '', dbxLink = ''
    try {
      const ir = await fetch(outUrl)
      if (ir.ok) {
        const buf = Buffer.from(await ir.arrayBuffer())
        dbxPath = `/Palm Ops/Stage B Outputs/${folderSafe}/${aka}-${Date.now()}.jpg`.replace(/[^ -~]/g, '')
        await uploadToDropbox(tok, ns, dbxPath, buf, { overwrite: true })
        try { dbxLink = await createDropboxSharedLink(tok, ns, dbxPath) } catch {}
      }
    } catch (e) { console.warn(`[stage-b] Dropbox save failed: ${e.message}`) }

    await createAirtableRecord(STAGE_B_OUTPUTS, {
      Name: `${aka} · ${locName} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      Creator: [creatorId],
      ...(reelShort ? { 'Source Reel': [reelShort] } : {}),
      ...(roomId ? { Room: [roomId] } : {}),
      Image: [{ url: outUrl }],
      ...(dbxPath ? { 'Dropbox Path': dbxPath } : {}),
      ...(dbxLink ? { 'Dropbox Link': dbxLink } : {}),
      'Pose Time': Number(tSec) || 0,
      ...(shotFraming ? { 'Screenshot Framing': shotFraming } : {}),
      ...(chosenFraming && chosenFraming !== 'unclassified' ? { 'Room Framing': chosenFraming } : {}),
      'Prompt Used': prompt,
      Status: 'Pending',
    })

    return NextResponse.json({
      ok: true,
      out: outUrl, dropbox: dbxLink || null,
      step1: step1Out,
      room: chosenRoomName, roomFraming: chosenFraming,
      screenshotFraming: shotFraming || 'unknown',
    })
  } catch (err) {
    if (err instanceof Response) return err
    const msg = typeof err?.message === 'string' && err.message ? err.message : String(err)
    console.error('[recreate-rooms/stage-b] error:', msg, err?.stack || '')
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
