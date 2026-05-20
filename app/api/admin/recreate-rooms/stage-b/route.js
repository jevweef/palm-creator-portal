import { NextResponse } from 'next/server'
import { requireAdminOrAiEditor, fetchAirtableRecords, OPS_BASE } from '@/lib/adminAuth'
import { submitWaveSpeedTask } from '@/lib/wavespeed'
import { getDropboxAccessToken, getDropboxRootNamespaceId, createDropboxSharedLink } from '@/lib/dropbox'
import Anthropic from '@anthropic-ai/sdk'
import { nextStageBSequence, stageBSlug } from '@/lib/recreateSlug'

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

// SCENE PROMPT — Figure 1 is the finished TJP photo of the creator
// (identity, pose, outfit already right). Figure 2 is her saved room.
// The portal's one job: keep the person exactly as-is and swap the
// background to her room, relit to match. Everything else (composite,
// outfit transfer, motion) happens in TJP off-site.
function buildScenePrompt() {
  return (
    'WHAT TO DO: Figure 1 is a finished photo of a woman. Keep the woman '
    + 'in Figure 1 EXACTLY as she is — her exact face, hair, skin tone, '
    + 'body and proportions, her exact pose, stance, hands and expression, '
    + 'and her full outfit/clothing — do not alter, restyle, beautify or '
    + 'reproportion her in any way. Replace ONLY the background behind her '
    + 'with the room in Figure 2.\n\n'
    + 'KEEP HER FRAMING IDENTICAL TO FIGURE 1: she must stay the SAME size, '
    + 'the SAME closeness to the camera, and the SAME position in the frame '
    + 'as in Figure 1 — large and close, filling the frame the same amount. '
    + 'Do NOT shrink her, do NOT push her deeper/further back into the '
    + 'room, do NOT zoom out. The room is just the environment directly '
    + 'behind her at that same close camera distance.\n\n'
    + 'RELIGHT HER FOR THE SCENE: remove the original bright/flat lighting '
    + 'from Figure 1 and relight her entirely to match Figure 2 — same '
    + 'warmth, color temperature, dimness/brightness, and light direction '
    + 'as the room; add a realistic grounded contact shadow. She must look '
    + 'genuinely photographed IN that room, lit by its lamps/windows, not '
    + 'pasted on.\n\n'
    + 'WHAT TO KEEP: Keep the room in Figure 2 unchanged — walls, windows, '
    + 'the outside view, furniture, bed, rug, décor, plants, lighting and '
    + 'time of day. Do NOT keep or copy Figure 1\'s original background.\n\n'
    + 'Result = the EXACT woman from Figure 1, same close framing, properly '
    + 'relit, in the Figure 2 room. Hyper realistic, raw iPhone photo, no '
    + 'text, no watermark.'
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



// POST { creatorId, reelRecordId, subjectDropboxPath, model? }
//  - creatorId: the creator whose saved room becomes the new background.
//  - reelRecordId: which inspo reel this scene belongs to (for slug +
//    Source Reel tracking + bulk-ZIP pairing).
//  - subjectDropboxPath: REQUIRED — Dropbox path of the TJP image-to-
//    image output (creator-in-reel-environment). This is the photo we
//    drop into her room.
//
// The system Sonnet-classifies the framing of the subject photo and
// auto-picks the creator's room ANGLE whose framing best matches
// (full-body → Wide, cropped → Tight), then a random approved variation
// of it. Then ONE wan call: [subject photo, room] → creator dropped
// into her room with the same pose/outfit/framing, relit to match.
export async function POST(request) {
  try {
    await requireAdminOrAiEditor()
    const { creatorId, reelRecordId, model, subjectDropboxPath } = await request.json()
    const mdl = MODELS[model] || MODELS.wan

    if (!creatorId || !/^rec[A-Za-z0-9]{14}$/.test(creatorId)) {
      return NextResponse.json({ error: 'Valid creatorId required' }, { status: 400 })
    }
    // The portal does ONE generation step: take the TJP image-to-image
    // output (creator-in-reel-environment) and swap the background to
    // her saved room. The TJP photo is the subject; the room variation
    // is the new background. No more from-scratch composite via Wan —
    // that work happens in TJP now (image-to-image with creator refs).
    if (!subjectDropboxPath || typeof subjectDropboxPath !== 'string') {
      return NextResponse.json({ error: 'subjectDropboxPath is required — upload the TJP image-to-image output first' }, { status: 400 })
    }

    const cRecs = await fetchAirtableRecords(PALM_CREATORS, {
      filterByFormula: `RECORD_ID() = '${creatorId}'`,
      fields: ['AKA'],
      maxRecords: 1,
    })
    if (!cRecs.length) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
    const aka = cRecs[0].fields?.AKA || 'Creator'

    const tok = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(tok)
    const pathToUrl = async (p) => {
      try { return rawDbx(await createDropboxSharedLink(tok, ns, p)) } catch { return '' }
    }
    const subjectUrl = await pathToUrl(subjectDropboxPath)
    if (!subjectUrl) return NextResponse.json({ error: 'Could not resolve the subject photo' }, { status: 400 })

    // Classify framing of the subject photo, then auto-pick the best-
    // matching room variation. Tight crops → tight rooms; full-body → wide.
    const shotFraming = await classifyScreenshotFraming(subjectUrl)
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

    const locName = chosenRoomName
    const reelShort = (reelRecordId && /^rec[A-Za-z0-9]{14}$/.test(reelRecordId)) ? reelRecordId : null

    // DECOUPLED: submit + return immediately; /stage-b/resolve fetches
    // the finished image by prediction id later (no timeout possible).
    // Figure 1 = the finished TJP person (keep EXACTLY); Figure 2 =
    // her saved room → drop that exact person into the room and relight.
    const images = [subjectUrl, roomUrl]
    const prompt = buildScenePrompt()

    const task = await submitWaveSpeedTask(mdl.path, mdl.body(images, prompt))
    const predictionId = task?.id
    if (!predictionId) {
      return NextResponse.json({ error: 'WaveSpeed did not return a prediction id' }, { status: 502 })
    }

    // Canonical naming: a sequential (Reel #, Still #) per creator → a
    // single slug that travels with the work through outfit fan-out,
    // TJP, upload, and review.
    let reelNum = null, stillNum = null, slug = null
    try {
      const seq = await nextStageBSequence({ creatorId, reelRecordId: reelShort })
      reelNum = seq.reelNum
      stillNum = seq.stillNum
      slug = stageBSlug({ aka, reelNum, stillNum })
    } catch (e) {
      console.warn('[stage-b POST] slug compute failed:', e.message)
    }

    const created = await createStageBRecord({
      Name: slug || `${aka} · ${locName} · [${mdl.label}] · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      Creator: [creatorId],
      ...(reelShort ? { 'Source Reel': [reelShort] } : {}),
      ...(roomId ? { Room: [roomId] } : {}),
      'Prediction ID': predictionId,
      ...(shotFraming ? { 'Screenshot Framing': shotFraming } : {}),
      ...(chosenFraming && chosenFraming !== 'unclassified' ? { 'Room Framing': chosenFraming } : {}),
      'Prompt Used': prompt,
      ...(reelNum != null ? { 'Reel #': reelNum } : {}),
      ...(stillNum != null ? { 'Still #': stillNum } : {}),
      ...(slug ? { Slug: slug } : {}),
      Status: 'Generating',
    })

    return NextResponse.json({
      ok: true,
      generating: true,
      recordId: created?.records?.[0]?.id || null,
      predictionId,
      slug,
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
