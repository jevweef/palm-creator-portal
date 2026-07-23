import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { submitWaveSpeedTask } from '@/lib/wavespeed'
import { quoteAirtableString } from '@/lib/airtableFormula'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const KLING_PRO_MODEL = 'kwaivgi/kling-v3.0-pro/image-to-video'
const KLING_V3_4K_MODEL = 'kwaivgi/kling-v3.0-4k/image-to-video'
const KLING_O3_STD_REF_MODEL = 'kwaivgi/kling-video-o3-std/reference-to-video'
const KLING_O3_4K_MODEL = 'kwaivgi/kling-video-o3-4k/reference-to-video'
const GROK_I2V_MODEL = 'x-ai/grok-imagine-video-v1.5/image-to-video'
const GROK_REF_MODEL = 'x-ai/grok-imagine-video/reference-to-video'
const WAN_26_I2V_MODEL = 'alibaba/wan-2.6/image-to-video'
const SEEDANCE_2_I2V_MODEL = 'bytedance/seedance-2.0/image-to-video'
const PALM_CREATORS = 'Palm Creators'

// POST — body: {
//   creatorId, shortcode,
//   startUrl,           // start frame swap output
//   endUrl?,            // end frame swap output (only used in pro mode as tail_image)
//   motionPrompt,
//   motionNegative?,
//   duration?,          // 1-15s
//   quality?,           // 'pro' (V3.0 Pro, ~$1.12/10s) or 'production' (O3 4K Reference-to-Video, ~$4.20/10s)
//   inspoVideoUrl?,     // used as motion driver when quality='production'
//   extraRefUrls?,      // optional extra face refs for production mode
// }
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorId, shortcode, startUrl, endUrl, motionPrompt, motionNegative, duration, quality, inspoVideoUrl, extraRefUrls } = await request.json()
    if (!creatorId) return NextResponse.json({ error: 'Missing creatorId' }, { status: 400 })
    // grok_ref / wan26 are TEXT-to-video anchored to the creator's AI
    // reference photos — the tiers with no start-frame requirement.
    if (!startUrl && quality !== 'grok_ref' && quality !== 'wan26' && quality !== 'seedance2') return NextResponse.json({ error: 'Missing startUrl (start frame swap output)' }, { status: 400 })
    if (!motionPrompt) return NextResponse.json({ error: 'Missing motionPrompt (run Step 6 first)' }, { status: 400 })

    const parsedDur = Number(duration)
    const dur = Number.isFinite(parsedDur) && parsedDur >= 1 && parsedDur <= 15
      ? Math.round(parsedDur)
      : 10

    // Look up creator's Kling Element + AKA + AI Ref Inputs for both paths.
    let elementId = null
    let aka = ''
    let aiRefInputs = []
    try {
      const records = await fetchAirtableRecords(PALM_CREATORS, {
        filterByFormula: `RECORD_ID() = ${quoteAirtableString(creatorId)}`,
        fields: ['Kling Element ID', 'AKA', 'AI Ref Inputs', 'AI Ref Face', 'AI Ref Front', 'AI Ref Back'],
        maxRecords: 1,
      })
      elementId = records[0]?.fields?.['Kling Element ID'] || null
      aka = records[0]?.fields?.['AKA'] || ''
      aiRefInputs = records[0]?.fields?.['AI Ref Inputs'] || []
      var approvedRefs = ['AI Ref Front', 'AI Ref Face', 'AI Ref Back']
        .map((f) => records[0]?.fields?.[f]?.[0]?.url)
        .filter(Boolean)
      // REAL photos only for identity (Evan, 2026-07-23): AI Ref Inputs are her
      // actual photos (pose-prefixed); the AI Ref Front/Face/Back OUTPUTS are
      // AI-generated and feeding those back compounds artifacts. Balanced mix
      // up to Grok's 7-image cap: faces carry identity, front/back carry body.
      var realRefs = (() => {
        const by = (p) => aiRefInputs.filter((a) => (a.filename || '').startsWith(p)).map((a) => a.url).filter(Boolean)
        const face = by('Close Up Face input_'), front = by('Front View input_'), back = by('Back View input_')
        const picks = [...face.slice(0, 3), ...front.slice(0, 3), ...back.slice(0, 1)]
        for (const pool of [face.slice(3), front.slice(3), back.slice(1)]) {
          for (const u of pool) { if (picks.length >= 7) break; picks.push(u) }
        }
        return [...new Set(picks)].slice(0, 7)
      })()
    } catch (e) {
      console.warn('[animate] could not look up creator metadata:', e.message)
    }
    const elementName = aka.replace(/\s+/g, '_').toLowerCase()
    const elementListObj = elementId ? [{ element_id: elementId, element_name: elementName }] : null

    const isProduction = quality === 'production'      // O3 4K Reference-to-Video
    const isMultiRef = quality === 'multi_ref'         // O3 Std Reference-to-Video (1080p)
    const is4k = quality === '4k'                      // V3.0 4K image-to-video
    const useRefVideo = isProduction || isMultiRef

    let model, body
    if (quality === 'seedance2') {
      // Seedance 2.0 — premium tier: 1080p, native lip-synced audio, 9:16.
      // Anchors on a REAL front-view photo. NOTE: ByteDance runs a real-face
      // detector; if it blocks her photo the error surfaces in the UI.
      model = SEEDANCE_2_I2V_MODEL
      const anchor = startUrl || (realRefs || []).find((u) => aiRefInputs.some((a) => a.url === u && (a.filename || '').startsWith('Front View'))) || (realRefs || [])[0]
      if (!anchor) {
        return NextResponse.json({ error: 'No REAL reference photos on this creator (AI Ref Inputs) — upload her photos in AI Recreate first' }, { status: 400 })
      }
      body = {
        prompt: motionPrompt,
        image: anchor,
        aspect_ratio: '9:16',
        resolution: '1080p',
        duration: Math.min(15, Math.max(4, dur)),
        generate_audio: true,
      }
    } else if (quality === 'wan26') {
      // Wan 2.6 image-to-video as a text-driven engine: her primary AI ref is
      // the identity anchor, the prompt writes the scene. Wan is the loosest-
      // moderated hosted family (open-source lineage) — the engine to reach
      // for when Grok refuses. 5/10/15s, 720p/1080p, native audio.
      model = WAN_26_I2V_MODEL
      // Anchor on a REAL photo (front view best for i2v), never an AI output.
      const anchor = startUrl || (realRefs || []).find((u) => aiRefInputs.some((a) => a.url === u && (a.filename || '').startsWith('Front View'))) || (realRefs || [])[0]
      if (!anchor) {
        return NextResponse.json({ error: 'No REAL reference photos on this creator (AI Ref Inputs) — upload her photos in AI Recreate first' }, { status: 400 })
      }
      body = {
        prompt: motionPrompt,
        image: anchor,
        duration: dur >= 13 ? 15 : dur >= 8 ? 10 : 5,
        resolution: '1080p',
      }
      if (motionNegative) body.negative_prompt = motionNegative
    } else if (quality === 'grok_ref') {
      // TEXT-to-video with preserved identity: her approved AI refs (Front/
      // Face/Back) + face close-ups anchor WHO she is; the prompt alone
      // decides the scene. Up to 7 refs; duration is 6s or 10s only.
      model = GROK_REF_MODEL
      const images = []
      if (startUrl) images.push(startUrl) // optional extra anchor when present
      for (const url of (realRefs || [])) if (!images.includes(url) && images.length < 7) images.push(url)
      if (Array.isArray(extraRefUrls)) {
        for (const url of extraRefUrls) if (url && !images.includes(url) && images.length < 7) images.push(url)
      }
      if (!images.length) {
        return NextResponse.json({ error: 'No REAL reference photos on this creator (AI Ref Inputs) — upload her photos in AI Recreate first' }, { status: 400 })
      }
      body = {
        prompt: motionPrompt,
        images,
        duration: dur <= 7 ? 6 : 10,
        resolution: '720p',
      }
    } else if (quality === 'grok') {
      // xAI Grok Imagine 1.5 image-to-video — the cheap fast draft tier
      // (~$0.14/s at 720p, ~80s generation). One image + prompt only: no
      // negative prompt, no element, no tail frame. Output runs through the
      // same inspo-audio mux as the Kling standard tiers.
      model = GROK_I2V_MODEL
      body = {
        image: startUrl,
        prompt: motionPrompt,
        duration: dur,
        resolution: '720p',
      }
    } else if (useRefVideo) {
      // O3 Reference-to-Video models. Cap: 4 images when reference video is
      // provided, 7 without. We always use the inspo video for motion guidance,
      // so cap is 4. Slot 1 = start swap (face anchor in correct pose), slots
      // 2-4 = additional face refs from creator's AI Ref Inputs.
      model = isProduction ? KLING_O3_4K_MODEL : KLING_O3_STD_REF_MODEL
      // Slot 1: start swap (face in correct pose). Slots 2-4: top face
      // close-ups from AI Ref Inputs to give Kling more identity anchors.
      const images = [startUrl]
      const faceInputs = aiRefInputs.filter(att => /^Close Up Face input_/i.test(att.filename || ''))
      for (const att of faceInputs) {
        if (images.length >= 4) break
        if (att.url) images.push(att.url)
      }
      // Allow client-supplied extras to override/append
      if (Array.isArray(extraRefUrls)) {
        for (const url of extraRefUrls) {
          if (url && images.length < 4 && !images.includes(url)) images.push(url)
        }
      }
      body = {
        images,
        prompt: motionPrompt,
        duration: dur,
        aspect_ratio: '9:16',
        keep_original_sound: true,
      }
      if (inspoVideoUrl) body.video = inspoVideoUrl
      if (elementListObj) body.element_list = elementListObj
    } else {
      // V3.0 Pro image-to-video (Standard) OR V3.0 4K image-to-video (HD+).
      // Identical parameters; only the model path differs. 4K renders at
      // higher resolution for less plastic skin / sharper hair texture.
      model = is4k ? KLING_V3_4K_MODEL : KLING_PRO_MODEL
      body = {
        image: startUrl,
        prompt: motionPrompt,
        negative_prompt: motionNegative || '',
        duration: dur,
        cfg_scale: 0.7,
        sound: false,
      }
      if (endUrl) body.tail_image = endUrl
      if (elementListObj) body.element_list = elementListObj
    }

    const task = await submitWaveSpeedTask(model, body)
    return NextResponse.json({
      ok: true,
      taskId: task.id,
      durationRequested: dur,
      quality: quality || 'pro',
      model,
      hasEndFrame: !useRefVideo && !!endUrl,
      usedElementId: elementId,
      refImageCount: useRefVideo ? body.images.length : 1,
    })
  } catch (err) {
    console.error('[recreate/animate] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
