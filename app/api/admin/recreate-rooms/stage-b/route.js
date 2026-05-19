import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, OPS_BASE } from '@/lib/adminAuth'
import { submitWaveSpeedTask } from '@/lib/wavespeed'
import { getDropboxAccessToken, getDropboxRootNamespaceId, createDropboxSharedLink } from '@/lib/dropbox'
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

// Selectable models — all take images[] + prompt; param schemas differ
// (verified against WaveSpeed docs). Decoupled submit/resolve is
// model-agnostic (poll by prediction id), so any of these "just works".
const STAGE_B_SEED = 77777
const MODELS = {
  wan: { label: 'Wan 2.7 image-edit-pro', path: WAN_MODEL,
    body: (images, prompt) => ({ images, prompt, size: '1080*1920', seed: STAGE_B_SEED }) },
  nano: { label: 'Nano-Banana 2', path: 'google/nano-banana-2/edit',
    body: (images, prompt) => ({ images, prompt, aspect_ratio: '9:16', resolution: '2k', output_format: 'jpeg' }) },
  gpt: { label: 'GPT-Image-2', path: 'openai/gpt-image-2/edit',
    body: (images, prompt) => ({ images, prompt, aspect_ratio: '9:16', resolution: '2k', quality: 'high' }) },
}

const rawDbx = (u) => u ? String(u).replace('dl=0', 'raw=1').replace('dl=1', 'raw=1') : ''

// SINGLE-PASS pipeline — this exact config produced the verified-good
// output (prediction d1750824): one wan call with [room, reel,
// ...identity] + buildSinglePrompt + seed 77777. Confirmed from the
// raw run data that the good image was this single call (NOT a chain).
// Caveat: identity adherence is reel-dependent (nailed one reel,
// failed on another with identical identity inputs).

// SINGLE-PASS prompt. The strengthened "placeholder head" framing
// solved the wrong-girl problem (verified from a real winning output:
// Amelia's face + the reel's outfit/pose/room). Refinement: pull BODY
// SHAPE from the identity refs too — earlier it took the reel girl's
// body. Pose (limb arrangement) still comes from Figure 2; body
// proportions/figure come from the identity figures.
function buildSinglePrompt(idList) {
  return (
    'WHAT TO DO: Figure 1 is the empty room — the exact location and '
    + 'background to use. Place one woman standing in it. From Figure 2 take '
    + 'ONLY: her body POSE and limb positioning, her exact outfit and '
    + 'clothing, and the camera distance and crop. The face, head AND body '
    + 'of the woman in Figure 2 are a PLACEHOLDER — discard them; she is a '
    + `DIFFERENT person, never reproduce Figure 2's face or body shape. The `
    + `final woman's face, head, hair, skin tone, identity AND her body `
    + `shape, proportions and figure must ALL come ONLY from ${idList} (the `
    + `real person). Her face must be an EXACT likeness of ${idList} — the `
    + `SAME individual, not a lookalike or "similar" face: reproduce the `
    + `precise facial structure, eye shape and spacing, eyebrows, nose, lips, `
    + `jawline, skin tone and hairline from ${idList} faithfully. Final `
    + `result = the POSE and OUTFIT of Figure 2, on the exact real person `
    + `(face and body) from ${idList}.\n\n`
    + 'WHAT TO KEEP: Keep the room in Figure 1 completely unchanged — walls, '
    + 'windows, the outside view, furniture, bed, rug, décor, plants, '
    + 'lighting and time of day identical to Figure 1. Do NOT copy Figure '
    + "2's background or location.\n\n"
    + 'Hyper realistic, ultra-detailed natural skin texture, raw iPhone '
    + 'photo look, no text, no watermark.'
  )
}


// Direct typecast POST so 'Generating' / 'Failed' auto-create as
// Status options on first use (the shared createAirtableRecord helper
// doesn't pass typecast).
async function createStageBRecord(fields) {
  const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(STAGE_B_OUTPUTS)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [{ fields }], typecast: true }),
  })
  if (!res.ok) throw new Error(`Stage B record create ${res.status}: ${await res.text()}`)
  return res.json()
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
// Then ONE wan call: [room, reel frame, ...identity refs] +
// buildSinglePrompt → the creator composited into the room in the
// reel's pose/outfit/framing.
export async function POST(request) {
  try {
    await requireAdmin()
    const { creatorId, poseStreamUid, poseTime, refDropboxPaths, reelRecordId, model } = await request.json()
    const mdl = MODELS[model] || MODELS.wan
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
    // Identity signal was just ONE face + ONE front + ONE back (the
    // approved refs) → "close, not exact". The model accepts up to 9
    // images (verified); we only used 5. Enrich it: pull MANY face
    // shots from the raw AI Ref Inputs pool too, face-weighted, so the
    // model has multiple angles of the SAME person to lock identity.
    const allRefs = cf['AI Ref Inputs'] || []
    const inFace = allRefs.filter(a => a.filename?.startsWith('Close Up Face input_'))
    const inFront = allRefs.filter(a => a.filename?.startsWith('Front View input_'))
    const inBack = allRefs.filter(a => a.filename?.startsWith('Back View input_'))
    const dedupe = arr => { const s = new Set(); return arr.filter(a => { const k = a?.url || a?.id; if (!k || s.has(k)) return false; s.add(k); return true }) }
    const faces = dedupe([...(cf['AI Ref Face'] || []), ...inFace])
    const fronts = dedupe([...(cf['AI Ref Front'] || []), ...inFront])
    const backs = dedupe([...(cf['AI Ref Back'] || []), ...inBack])
    // Fill the full 9-image budget, face-weighted (identity is the
    // bigger miss): 6 faces + 1 front (body) → with room+reel that's
    // exactly 9. Falls back gracefully if the pool is smaller.
    let onFileRefs = [...faces.slice(0, 6), ...fronts.slice(0, 1), ...backs.slice(0, 1)]

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

    // DECOUPLED: single-pass wan, but we SUBMIT and return immediately —
    // no server-side poll. WaveSpeed keeps the prediction; /stage-b/
    // resolve fetches the finished image by prediction id later, so a
    // >300s inference can't lose the result (proven: a 301s job
    // completed on WaveSpeed after the old synchronous route had died).
    // Figure 1 = room, Figure 2 = reel frame, Figures 3..N = identity.
    const images = [roomUrl, poseUrl, ...identity].slice(0, 9)
    const figs = []
    for (let i = 3; i <= images.length; i++) figs.push(`Figure ${i}`)
    const idList = figs.length <= 1 ? (figs[0] || 'Figure 3')
      : `${figs.slice(0, -1).join(', ')} and ${figs[figs.length - 1]}`
    const prompt = buildSinglePrompt(idList)

    const task = await submitWaveSpeedTask(mdl.path, mdl.body(images, prompt))
    const predictionId = task?.id
    if (!predictionId) {
      return NextResponse.json({ error: 'WaveSpeed did not return a prediction id' }, { status: 502 })
    }

    const created = await createStageBRecord({
      Name: `${aka} · ${locName} · [${mdl.label}] · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      Creator: [creatorId],
      ...(reelShort ? { 'Source Reel': [reelShort] } : {}),
      ...(roomId ? { Room: [roomId] } : {}),
      'Prediction ID': predictionId,
      'Pose Time': Number(tSec) || 0,
      ...(shotFraming ? { 'Screenshot Framing': shotFraming } : {}),
      ...(chosenFraming && chosenFraming !== 'unclassified' ? { 'Room Framing': chosenFraming } : {}),
      'Prompt Used': prompt,
      Status: 'Generating',
    })

    return NextResponse.json({
      ok: true,
      generating: true,
      recordId: created?.records?.[0]?.id || null,
      predictionId,
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
