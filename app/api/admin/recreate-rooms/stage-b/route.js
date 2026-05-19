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
    + 'background to use. Place one woman in it. COPY FROM FIGURE 2 EXACTLY: '
    + 'her full body pose and stance, the precise position of her arms, '
    + 'hands, legs and head tilt, her exact outfit and clothing, AND the '
    + 'camera distance / zoom / crop — frame her at the SAME distance and '
    + 'size as in Figure 2. If she is close to the camera / cropped (e.g. '
    + 'thigh-up or waist-up) in Figure 2, she must be equally close and '
    + 'cropped here — do NOT default to a small far-away full-body figure. '
    + 'Her pose and the framing must visibly match Figure 2.\n\n'
    + 'The face, head AND body of the woman in Figure 2 are a PLACEHOLDER — '
    + `discard them; she is a DIFFERENT person, never reproduce Figure 2's `
    + `face or body shape. The final woman's face, head, hair, skin tone, `
    + `identity AND her body shape, proportions, bust and figure must ALL `
    + `come ONLY from ${idList} (the real person) — match her real `
    + `proportions, do not exaggerate or enlarge the chest. Her face must be `
    + `an EXACT likeness of ${idList} — the SAME individual, not a lookalike: `
    + `reproduce the precise facial structure, eye shape and spacing, `
    + `eyebrows, nose, lips, jawline, skin tone and hairline from ${idList} `
    + `faithfully. Final = the POSE, FRAMING and OUTFIT of Figure 2, on the `
    + `exact real person (face and true body) from ${idList}.\n\n`
    + 'WHAT TO KEEP: Keep the room and its contents in Figure 1 unchanged — '
    + 'walls, windows, the outside view, furniture, bed, rug, décor, plants, '
    + 'lighting and time of day. The camera may move closer/reframe to match '
    + "Figure 2's crop, but it is the same room. Do NOT copy Figure 2's "
    + 'background or location.\n\n'
    + 'Hyper realistic, ultra-detailed natural skin texture, raw iPhone '
    + 'photo look, no text, no watermark.'
  )
}

// SUBJECT MODE prompt — Figure 1 is a finished, correct photo of the
// person (identity, pose, outfit already right, from TJP). Only the
// background changes. This is background compositing, not generation.
function buildScenePrompt() {
  return (
    'WHAT TO DO: Figure 1 is a finished photo of a woman. Keep the woman '
    + 'in Figure 1 EXACTLY as she is — her exact face, hair, skin tone, '
    + 'body and proportions, her exact pose, stance, hands and expression, '
    + 'and her full outfit/clothing — do not alter, restyle, beautify or '
    + 'reproportion her in any way. Replace ONLY her surroundings: place '
    + 'her, unchanged, standing in the room shown in Figure 2. Match her '
    + 'scale and perspective to that room, ground her with realistic '
    + 'contact shadows, and relight her to match the room\'s existing '
    + 'light direction and warmth so she blends in naturally.\n\n'
    + 'WHAT TO KEEP: Keep the room in Figure 2 completely unchanged — '
    + 'walls, windows, the outside view, furniture, bed, rug, décor, '
    + 'plants, lighting and time of day. Do NOT keep or copy Figure 1\'s '
    + 'original background/location at all.\n\n'
    + 'The result = the EXACT woman from Figure 1, standing in the room '
    + 'from Figure 2. Hyper realistic, raw iPhone photo look, no text, '
    + 'no watermark.'
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
    const { creatorId, poseStreamUid, poseTime, refDropboxPaths, reelRecordId, model, subjectDropboxPath } = await request.json()
    const mdl = MODELS[model] || MODELS.wan
    // SUBJECT MODE: a finished TJP photo (identity+pose+outfit already
    // correct) → just composite that exact person into our room. Far
    // easier than reconstructing her; no reel/identity refs needed.
    const subjectMode = !!(subjectDropboxPath && typeof subjectDropboxPath === 'string')
    if (!creatorId || !/^rec[A-Za-z0-9]{14}$/.test(creatorId)) {
      return NextResponse.json({ error: 'Valid creatorId required' }, { status: 400 })
    }
    if (!subjectMode && !poseStreamUid) {
      return NextResponse.json({ error: 'A captured pose frame is required (reel has no Stream video)' }, { status: 400 })
    }
    // CF Stream thumbnails 404 on fit=scale-down with width-only and on
    // time=0 — use fit=crop and a non-zero floor (matches what the UI shows).
    const tSec = Math.max(0.1, Number(poseTime) || 0)
    const poseUrl = subjectMode ? null : buildStreamPosterUrl(poseStreamUid, { time: `${tSec}s`, width: 1080, fit: 'crop' })
    if (!subjectMode && !poseUrl) return NextResponse.json({ error: 'Could not build pose frame URL' }, { status: 400 })

    const cRecs = await fetchAirtableRecords(PALM_CREATORS, {
      filterByFormula: `RECORD_ID() = '${creatorId}'`,
      fields: ['AKA', 'AI Ref Inputs'],
      maxRecords: 1,
    })
    if (!cRecs.length) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
    const cf = cRecs[0].fields
    const aka = cf.AKA || 'Creator'
    // Identity = ONLY the creator's REAL photos (the `*_input_` shots in
    // AI Ref Inputs). The `AI Ref Face/Front/Back` fields are the AI
    // Super Clone's GENERATED renders ("… AI Reference.*") — driving
    // identity off a synthetic image just propagates its errors, so we
    // exclude them entirely. Sort each set by the `input_N` number
    // DESCENDING — the newest/highest-numbered shots are the curated
    // good ones (older low ones were getting picked by attachment order
    // and missing the best). Face-weighted, fills the 9-image budget
    // (6 faces + 1 front + 1 back → first 7 kept after room+reel).
    const allRefs = cf['AI Ref Inputs'] || []
    const dedupe = arr => { const s = new Set(); return arr.filter(a => { const k = a?.url || a?.id; if (!k || s.has(k)) return false; s.add(k); return true }) }
    const inputNo = a => { const m = (a.filename || '').match(/input_(\d+)/i); return m ? parseInt(m[1], 10) : 0 }
    const pick = (prefix) => dedupe(allRefs.filter(a => a.filename?.startsWith(prefix)))
      .sort((a, b) => inputNo(b) - inputNo(a))
    const faces = pick('Close Up Face input_')
    const fronts = pick('Front View input_')
    // 4 face + 3 front: face is locked enough now; more FRONT shots give
    // the model her real body/proportions (was inheriting the reel
    // girl's body / oversized chest). 4+3 = 7 → fills 9 w/ room+reel;
    // back dropped (least useful for a front-facing standing shot).
    let onFileRefs = [...faces.slice(0, 4), ...fronts.slice(0, 3)]

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
    let subjectUrl = ''
    if (subjectMode) {
      subjectUrl = await pathToUrl(subjectDropboxPath)
      if (!subjectUrl) return NextResponse.json({ error: 'Could not resolve the subject photo' }, { status: 400 })
    }

    // Classify framing (subject photo in subject mode, else the reel
    // screenshot), then auto-pick the best-matching room variation.
    const shotFraming = await classifyScreenshotFraming(subjectMode ? subjectUrl : poseUrl)
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
    if (!subjectMode && identity.length === 0) {
      return NextResponse.json({ error: `No identity references — upload some for this run, or set up ${aka}'s AI Super Clone refs.` }, { status: 400 })
    }

    const locName = chosenRoomName
    const folderSafe = locName.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'Room'
    const reelShort = (reelRecordId && /^rec[A-Za-z0-9]{14}$/.test(reelRecordId)) ? reelRecordId : null

    // DECOUPLED: submit + return immediately; /stage-b/resolve fetches
    // the finished image by prediction id later (no timeout possible).
    let images, prompt
    if (subjectMode) {
      // Figure 1 = the finished TJP person (keep EXACTLY); Figure 2 =
      // our room → just place that exact person into the room.
      images = [subjectUrl, roomUrl]
      prompt = buildScenePrompt()
    } else {
      // Figure 1 = room, Figure 2 = reel frame, Figures 3..N = identity.
      images = [roomUrl, poseUrl, ...identity].slice(0, 9)
      const figs = []
      for (let i = 3; i <= images.length; i++) figs.push(`Figure ${i}`)
      const idList = figs.length <= 1 ? (figs[0] || 'Figure 3')
        : `${figs.slice(0, -1).join(', ')} and ${figs[figs.length - 1]}`
      prompt = buildSinglePrompt(idList)
    }

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
