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
    + 'ANCHOR THE ROOM\'S SCALE TO FIGURE 2 CONSISTENTLY: the room behind '
    + 'her appears at the same perspective and scale as in Figure 2. The '
    + 'bed headboard, wall décor, plants, window, and other landmark '
    + 'elements occupy the same relative size and same vertical position '
    + 'behind her every time — do not vary the implicit camera field-of-'
    + 'view from one generation to the next. If the bed headboard sits '
    + 'behind her shoulders, it sits behind her shoulders consistently.\n\n'
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
    const body = await request.json()
    const { creatorId, reelRecordId, model, projectId } = body
    let { subjectDropboxPath, rawScreenshotPath, upscaledScreenshotPath } = body
    const mdl = MODELS[model] || MODELS.wan

    if (!creatorId || !/^rec[A-Za-z0-9]{14}$/.test(creatorId)) {
      return NextResponse.json({ error: 'Valid creatorId required' }, { status: 400 })
    }
    // Continuing-a-project path: when projectId is set and the editor
    // has already eager-uploaded files (via /stage-b/attach), the
    // record's path fields are the source of truth. Fall back to them
    // if the client didn't include the paths in the body — covers the
    // "refresh mid-flow" case where panel state is empty but the
    // record has the files.
    if (projectId && /^rec[A-Za-z0-9]{14}$/.test(projectId)) {
      try {
        const pRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(STAGE_B_OUTPUTS)}/${projectId}`,
          { headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` }, cache: 'no-store' })
        if (pRes.ok) {
          const pf = (await pRes.json()).fields || {}
          if (!subjectDropboxPath) subjectDropboxPath = pf['TJP Output Path'] || null
          if (!rawScreenshotPath) rawScreenshotPath = pf['Raw Screenshot Path'] || null
          if (!upscaledScreenshotPath) upscaledScreenshotPath = pf['Upscaled Screenshot Path'] || null
        }
      } catch (e) { console.warn('[stage-b POST] could not preload project paths:', e.message) }
    }

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

    // Resolve optional organizational uploads (raw + upscaled). These
    // never feed the generation step — they're attached to the record
    // so the editor can find them on the project later.
    const rawScreenshotUrl = rawScreenshotPath ? await pathToUrl(rawScreenshotPath) : ''
    const upscaledScreenshotUrl = upscaledScreenshotPath ? await pathToUrl(upscaledScreenshotPath) : ''

    // Classify framing of the subject photo, then auto-pick the best-
    // matching room variation. Tight crops → tight rooms; full-body → wide.
    const shotFraming = await classifyScreenshotFraming(subjectUrl)
    const allRooms = await fetchAirtableRecords(ROOMS, { fields: ['Room Name', 'Creator', 'Framing'] })
    const myRooms = allRooms.filter(r => (r.fields?.Creator || []).includes(creatorId))
    if (myRooms.length === 0) {
      return NextResponse.json({ error: `${aka} has no rooms yet. Create & approve a room for this creator in the Rooms tab first.` }, { status: 400 })
    }
    const myRoomIds = new Set(myRooms.map(r => r.id))
    const allVars = await fetchAirtableRecords(VARS, { fields: ['Variation', 'Room', 'Status', 'Image', 'Dropbox Link', 'Time of Day'] })
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
    // Fan-out: pick N distinct room variations from the pool. When
    // count > 1, deliberately diversify by Angle (Room) + Time of Day
    // instead of pure random — the editor wants varied scenes, not
    // four near-duplicates of the same room at the same time of day.
    const requestedCount = Math.max(1, Math.min(4, Number(body.count) || 1))
    const todOf = (v) => v.fields?.['Time of Day']?.name || v.fields?.['Time of Day'] || 'Unknown'
    const roomOf = (v) => (v.fields?.Room || [])[0] || 'unknown'

    // Diversity-aware sampling: each pass through the pool picks one
    // variation per (Room, Time of Day) bucket so successive picks
    // cover as many distinct combinations as possible before any
    // repeat. Within a bucket we randomize so reruns don't always
    // produce the exact same set.
    const pickDiverse = (pool, n) => {
      const buckets = new Map() // "roomId|tod" -> [variations]
      for (const v of pool) {
        const k = `${roomOf(v)}|${todOf(v)}`
        if (!buckets.has(k)) buckets.set(k, [])
        buckets.get(k).push(v)
      }
      const bucketList = [...buckets.values()]
      for (const list of bucketList) list.sort(() => Math.random() - 0.5)
      // Shuffle bucket order each pass so the "first" bucket isn't
      // always the same room/tod combination.
      const out = []
      let pass = 0
      while (out.length < n) {
        const order = bucketList.map((list, i) => ({ list, i })).filter(({ list }) => list.length > pass)
        if (order.length === 0) {
          // Pool exhausted at this depth — loop back to the start
          // with replacement (only happens when n > pool.length).
          if (pool.length === 0) break
          out.push(pool[out.length % pool.length])
          continue
        }
        order.sort(() => Math.random() - 0.5)
        for (const { list } of order) {
          if (out.length >= n) break
          out.push(list[pass])
        }
        pass++
      }
      return out.slice(0, n)
    }
    const sampledVars = requestedCount === 1
      ? [pool[Math.floor(Math.random() * pool.length)]]
      : pickDiverse(pool, requestedCount)
    const sampled = sampledVars.map(v => {
      const vf = v.fields || {}
      const url = (vf['Dropbox Link'] && rawDbx(vf['Dropbox Link']))
        || (Array.isArray(vf.Image) && vf.Image[0]?.url) || ''
      const rid = (vf.Room || [])[0] || null
      const roomName = myRooms.find(r => r.id === rid)?.fields?.['Room Name'] || 'Room'
      const framing = framingOf(v) || 'unclassified'
      const timeOfDay = todOf(v)
      return { url, roomId: rid, roomName, framing, timeOfDay }
    })
    for (const s of sampled) {
      if (!s.url) return NextResponse.json({ error: 'Picked variation has no image' }, { status: 400 })
    }

    const reelShort = (reelRecordId && /^rec[A-Za-z0-9]{14}$/.test(reelRecordId)) ? reelRecordId : null

    // Pre-compute the (reelNum, stillNum) base. If a Started placeholder
    // exists we reuse its Still # for variation 0; otherwise we pull a
    // fresh sequence. Subsequent variations get sequential Still #s
    // (base + 1, base + 2, …) computed locally — calling
    // nextStageBSequence N times wouldn't increment between calls
    // because none of the new records have been written yet.
    let baseReelNum = null, baseStillNum = null
    let existingStartedRecord = null
    if (projectId && /^rec[A-Za-z0-9]{14}$/.test(projectId)) {
      try {
        const pRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(STAGE_B_OUTPUTS)}/${projectId}`,
          { headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` }, cache: 'no-store' })
        if (pRes.ok) {
          const ep = await pRes.json()
          const ss = ep?.fields?.Status?.name || ep?.fields?.Status
          if (ss === 'Started') {
            existingStartedRecord = ep
            baseReelNum = ep.fields?.['Reel #'] || null
            baseStillNum = ep.fields?.['Still #'] || null
          }
        }
      } catch (e) { console.warn('[stage-b POST] could not load projectId:', e.message) }
    }
    if (baseStillNum == null) {
      try {
        const seq = await nextStageBSequence({ creatorId, reelRecordId: reelShort })
        baseReelNum = seq.reelNum
        baseStillNum = seq.stillNum
      } catch (e) { console.warn('[stage-b POST] slug compute failed:', e.message) }
    }

    // Submit all N WaveSpeed tasks in PARALLEL. Each gets a different
    // room URL but the same TJP subject. submitWaveSpeedTask returns
    // immediately with a prediction id — the resolve route polls them
    // all later, in any order, regardless of how long each one takes.
    const prompt = buildScenePrompt()
    const taskResults = await Promise.allSettled(
      sampled.map(s => submitWaveSpeedTask(mdl.path, mdl.body([subjectUrl, s.url], prompt)))
    )
    const failedSubmits = taskResults
      .map((r, i) => ({ r, i })).filter(({ r }) => r.status === 'rejected')
    if (failedSubmits.length === taskResults.length) {
      return NextResponse.json({ error: `All ${taskResults.length} WaveSpeed submits failed: ${failedSubmits[0].r.reason?.message || 'unknown'}` }, { status: 502 })
    }

    // For each successfully submitted task, PATCH the Started
    // placeholder (variation 0 only) or CREATE a new sibling record.
    const variations = []
    for (let i = 0; i < sampled.length; i++) {
      const taskRes = taskResults[i]
      if (taskRes.status === 'rejected') {
        console.warn(`[stage-b POST] variation ${i} submit failed: ${taskRes.reason?.message}`)
        continue
      }
      const task = taskRes.value
      const predictionId = task?.id
      if (!predictionId) continue
      const s = sampled[i]
      const stillNum = (baseStillNum || 1) + i
      const slug = stageBSlug({ aka, reelNum: baseReelNum || 1, stillNum })

      const attachments = {}
      if (rawScreenshotUrl) attachments['Raw Screenshot'] = [{ url: rawScreenshotUrl, filename: `${slug}_raw.jpg` }]
      if (upscaledScreenshotUrl) attachments['Upscaled Screenshot'] = [{ url: upscaledScreenshotUrl, filename: `${slug}_upscaled.jpg` }]
      attachments['TJP Output'] = [{ url: subjectUrl, filename: `${slug}_tjp_output.jpg` }]

      const recordFields = {
        Name: slug,
        Creator: [creatorId],
        ...(reelShort ? { 'Source Reel': [reelShort] } : {}),
        ...(s.roomId ? { Room: [s.roomId] } : {}),
        'Prediction ID': predictionId,
        ...(shotFraming ? { 'Screenshot Framing': shotFraming } : {}),
        ...(s.framing !== 'unclassified' ? { 'Room Framing': s.framing } : {}),
        ...(s.timeOfDay && s.timeOfDay !== 'Unknown' ? { 'Time of Day': s.timeOfDay } : {}),
        'Prompt Used': prompt,
        'Reel #': baseReelNum || 1,
        'Still #': stillNum,
        Slug: slug,
        ...(subjectDropboxPath ? { 'TJP Output Path': subjectDropboxPath } : {}),
        ...(rawScreenshotPath ? { 'Raw Screenshot Path': rawScreenshotPath } : {}),
        ...(upscaledScreenshotPath ? { 'Upscaled Screenshot Path': upscaledScreenshotPath } : {}),
        ...attachments,
        Status: 'Generating',
      }

      let recordId = null
      try {
        if (i === 0 && existingStartedRecord) {
          // First variation reuses the Started placeholder.
          const upRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(STAGE_B_OUTPUTS)}/${existingStartedRecord.id}`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: recordFields, typecast: true }),
          })
          if (!upRes.ok) throw new Error(`patch ${upRes.status}: ${await upRes.text()}`)
          recordId = existingStartedRecord.id
        } else {
          const created = await createStageBRecord(recordFields)
          recordId = created?.records?.[0]?.id || null
        }
      } catch (e) {
        console.error(`[stage-b POST] record write failed for ${slug}: ${e.message}`)
        continue
      }
      variations.push({ recordId, predictionId, slug, room: s.roomName, roomFraming: s.framing, timeOfDay: s.timeOfDay })
    }

    if (variations.length === 0) {
      return NextResponse.json({ error: 'All variations failed to record — check server logs' }, { status: 500 })
    }

    // Back-compat: also surface first variation's fields at top-level so
    // older client code reading `recordId` / `room` / etc still works.
    const first = variations[0]
    return NextResponse.json({
      ok: true,
      generating: true,
      variations,
      recordId: first.recordId,
      predictionId: first.predictionId,
      slug: first.slug,
      room: first.room,
      roomFraming: first.roomFraming,
      screenshotFraming: shotFraming || 'unknown',
    })
  } catch (err) {
    if (err instanceof Response) return err
    const msg = typeof err?.message === 'string' && err.message ? err.message : String(err)
    console.error('[recreate-rooms/stage-b] error:', msg, err?.stack || '')
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
