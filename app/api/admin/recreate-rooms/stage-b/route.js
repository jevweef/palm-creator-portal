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

// Two-part prompt per the official Wan image-edit guidance ("what to
// do / what to keep") with ordinal Figure refs mapped to the images
// array order. NO pose image — a pose ref carries the reel girl's face
// and the model blends it in ("wrong girl"); motion is driven from the
// reel video off-site, so the still only needs THIS woman in her room.
// images[] is capped at 3 (the model's hard API max): Figure 1 = room,
// Figures 2..N = identity.
function buildPrompt(idList) {
  return (
    `WHAT TO DO: Figure 1 is an empty room with no person in it. Add exactly `
    + 'one woman standing on the open floor in front of the bed, at realistic '
    + 'human scale, properly grounded with correct contact shadows, lit to '
    + 'match the room\'s existing light direction and warmth. She stands '
    + 'naturally and relaxed, facing the camera, full body in frame, in '
    + `simple casual everyday clothing. ${idList} are reference photos of the `
    + 'SAME real woman — she is the only person who may appear. Copy her face, '
    + `facial features, skin tone, hair and body shape EXACTLY from ${idList}; `
    + 'do not beautify, average, stylise or substitute a different face. She '
    + 'must be unmistakably that same woman.\n\n'
    + 'WHAT TO KEEP: Keep the room in Figure 1 completely unchanged — walls, '
    + 'windows, the outside view, furniture, bed, rug, décor, wall hangings, '
    + 'plants, lighting, time of day, camera angle and framing all identical '
    + 'to Figure 1. Do not move, restyle, re-render or re-light the room.\n\n'
    + 'Hyper realistic, ultra-detailed natural skin texture, true-to-life '
    + 'colors, raw iPhone photo look, seamless blend, no text, no watermark.'
  )
}

async function runWan(images, prompt) {
  const task = await submitWaveSpeedTask(WAN_MODEL, { images, prompt, size: '1080*1920', seed: STAGE_B_SEED })
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

    // Image count is NOT a hard limit — empirically the endpoint accepts
    // and completes 9 images fine (the docs' "up to 3" is guidance, not
    // enforced). The PROVEN cause of the "wrong girl" was a pose/reel
    // screenshot fed as a person ref (now removed entirely). Identity =
    // uploaded extras + the creator's on-file face/front/back; capped at
    // 9 only because that's the largest count we've verified works.
    const identity = [...extraUrls, ...onFileRefs.map(a => a.url)]
    if (identity.length === 0) {
      return NextResponse.json({ error: `No identity references — upload some for this run, or set up ${aka}'s AI Super Clone refs.` }, { status: 400 })
    }
    const images = [roomUrl, ...identity].slice(0, 9)
    const figs = []
    for (let i = 2; i <= images.length; i++) figs.push(`Figure ${i}`)
    const idList = figs.length <= 1
      ? (figs[0] || 'Figure 2')
      : `${figs.slice(0, -1).join(', ')} and ${figs[figs.length - 1]}`
    const prompt = buildPrompt(idList)
    const outUrl = await runWan(images, prompt)

    const locName = chosenRoomName
    const folderSafe = locName.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'Room'
    const reelShort = (reelRecordId && /^rec[A-Za-z0-9]{14}$/.test(reelRecordId)) ? reelRecordId : null
    let dbxPath = '', dbxLink = ''
    try {
      const ir = await fetch(outUrl)
      if (ir.ok) {
        const buf = Buffer.from(await ir.arrayBuffer())
        dbxPath = `/Palm Ops/Stage B Outputs/${folderSafe}/${aka}-${Date.now()}.jpg`.replace(/[^ -~]/g, '')
        await uploadToDropbox(tok, ns, dbxPath, buf, { overwrite: true })
        try { dbxLink = await createDropboxSharedLink(tok, ns, dbxPath) } catch {}
      }
    } catch (e) {
      console.warn(`[recreate-rooms/stage-b] Dropbox save failed: ${e.message}`)
    }

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
