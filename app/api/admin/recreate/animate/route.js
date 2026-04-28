import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { submitWaveSpeedTask } from '@/lib/wavespeed'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const KLING_PRO_MODEL = 'kwaivgi/kling-v3.0-pro/image-to-video'
const KLING_V3_4K_MODEL = 'kwaivgi/kling-v3.0-4k/image-to-video'
const KLING_O3_4K_MODEL = 'kwaivgi/kling-video-o3-4k/reference-to-video'
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
    if (!startUrl) return NextResponse.json({ error: 'Missing startUrl (start frame swap output)' }, { status: 400 })
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
        filterByFormula: `RECORD_ID() = '${creatorId}'`,
        fields: ['Kling Element ID', 'AKA', 'AI Ref Inputs', 'AI Ref Face', 'AI Ref Front'],
        maxRecords: 1,
      })
      elementId = records[0]?.fields?.['Kling Element ID'] || null
      aka = records[0]?.fields?.['AKA'] || ''
      aiRefInputs = records[0]?.fields?.['AI Ref Inputs'] || []
    } catch (e) {
      console.warn('[animate] could not look up creator metadata:', e.message)
    }
    const elementName = aka.replace(/\s+/g, '_').toLowerCase()
    const elementListObj = elementId ? [{ element_id: elementId, element_name: elementName }] : null

    const isProduction = quality === 'production'
    const is4k = quality === '4k'

    let model, body
    if (isProduction) {
      // O3 4K Reference-to-Video. Cap: 4 images when reference video is
      // provided, 7 without. We always use the inspo video for motion guidance,
      // so cap is 4. Slot 1 = start swap (face anchor in correct pose), slots
      // 2-4 = additional face refs from creator's AI Ref Inputs.
      model = KLING_O3_4K_MODEL
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
      quality: isProduction ? 'production' : 'pro',
      model,
      hasEndFrame: !isProduction && !!endUrl,
      usedElementId: elementId,
      refImageCount: isProduction ? body.images.length : 1,
    })
  } catch (err) {
    console.error('[recreate/animate] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
