import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { requireAdminOrAiEditor, fetchAirtableRecords } from '@/lib/adminAuth'
import { submitWaveSpeedTask, pollWaveSpeedTask } from '@/lib/wavespeed'
import { uploadImageBytes, buildDeliveryUrl, isCloudflareImagesConfigured } from '@/lib/cloudflareImages'

// Vercel function budget — Wan 2.7 image-edit-pro typically completes in
// 25-45s. We poll for up to 70s, leaving headroom for the CF Images
// upload before Vercel kills us at 90s.
export const maxDuration = 90

const STAGE_B_TABLE = 'Stage B Outputs'

// Default pose direction. Surfaced as the textarea's prefill in the modal
// so the editor can edit it per-scene without having to type the whole
// thing every time. Tuned for: body-conscious standing pose that proves
// the bottoms are shorts (legs visible), still feels candid not staged.
const DEFAULT_POSE_DIRECTION = (
  'Confident, body-conscious standing pose — weight shifted onto one hip, '
+ 'one knee slightly bent, one hand resting at her waist or hip, the other '
+ 'relaxed at her side. Body angled slightly off-axis to the camera (~15°) '
+ 'so the silhouette of her hips and waist reads. Soft neutral expression, '
+ 'lips slightly parted, looking directly into the camera. Full-body framed '
+ 'so her legs are visible from at least mid-thigh down to her feet — the '
+ 'bottoms she is wearing must read unambiguously as shorts, not pants.'
)

// Wan 2.7 image-edit-pro prompt. Heavy emphasis on the LOCKS because Wan
// happily drifts unspecified anchors (the headboard moves, the macrame
// disappears, etc.) without explicit "do not change" language for every
// room element. Stage B's prompt has the same shape — this mirrors it.
function buildPoseAltPrompt(poseDirection) {
  return (
    'WHAT TO DO: Figure 1 is a photo of a woman standing in a bedroom. '
  + 'Generate a new image of the SAME woman, in the SAME outfit, in the '
  + 'SAME bedroom, with ONLY her pose changed.\n\n'

  + 'KEEP HER IDENTITY EXACTLY: same face, hair (including hairstyle and '
  + 'volume), skin tone, eye color and shape, eyebrows, body type and '
  + 'proportions. Do not restyle, beautify, slim, or reproportion her.\n\n'

  + 'KEEP THE OUTFIT EXACTLY as worn in Figure 1: every garment, including '
  + 'the exact colors, prints, cuts, lengths, fabric, and fit. If she is '
  + 'wearing SHORTS in Figure 1, she must still be wearing those exact '
  + 'shorts (NOT pants, NOT capris, NOT a longer cut). If her top has no '
  + 'graphic, do not add one. If it has a graphic, keep the same graphic '
  + 'in the same place. Do not add or remove accessories.\n\n'

  + 'KEEP THE BEDROOM EXACTLY UNCHANGED: every wall, the wooden bed and '
  + 'headboard (same position, same height), nightstand, dresser, candle, '
  + 'lamp, hanging plants (both sides), macrame wall hanging, window, '
  + 'curtains, time of day, lighting color temperature and direction, rug '
  + 'and floor — all unchanged. The room is LOCKED. Do not move, replace, '
  + 'restyle, add, or remove any room element. Same camera position. '
  + 'Landmarks (headboard top, macrame, window) must appear at the same '
  + 'positions in the frame as in Figure 1.\n\n'

  + `CHANGE ONLY HER POSE AND BODY POSITION:\n${poseDirection}\n\n`

  + 'CAMERA: same handheld vertical 9:16 framing as Figure 1. Same eye '
  + 'level, same warm natural lighting (golden-hour through window). She '
  + 'remains positioned roughly where she was in Figure 1 (centered '
  + 'between the bed and the camera).\n\n'

  + 'NEGATIVE — do NOT change the bedroom, do NOT change the outfit, do '
  + 'NOT change her face. No skyline graphic, no pants, no sweatpants, '
  + 'no covering her legs below mid-thigh. No extra people, no text, '
  + 'no watermark, no logos.\n\n'

  + 'OUTPUT: hyper realistic raw iPhone photo, natural skin texture, '
  + 'realistic body proportions. Same woman from Figure 1, same outfit, '
  + 'same bedroom, new pose only.'
  )
}

// POST { sceneId, poseDirection? } — generate an alt-pose render of a
// Stage B scene for use as the upload modal's thumbnail. Single-shot:
// fires Wan, polls up to 70s, uploads result to Cloudflare Images, returns
// the CDN URL. Ephemeral by design — no Airtable persistence on the scene
// record; the modal hands the resulting URL straight to the upload finalize
// as `thumbnailSourceUrl` if the editor accepts the result.
export async function POST(request) {
  try {
    await requireAdminOrAiEditor()
    const body = await request.json()
    const sceneId = String(body.sceneId || '')
    if (!sceneId || !/^rec[A-Za-z0-9]{14}$/.test(sceneId)) {
      return NextResponse.json({ error: 'Valid sceneId required' }, { status: 400 })
    }
    const poseDirection = (body.poseDirection || '').trim() || DEFAULT_POSE_DIRECTION

    // Load the Stage B Output. TJP Output (the composited subject + room
    // + outfit after the editor ran TJP) is the best input — it's the
    // closest visual match to what the finished video looks like, so the
    // alt-pose result reads as "same shot, different stance." Fall back
    // to the raw Stage B Image (subject + room without outfit) if TJP
    // hasn't run yet.
    const rows = await fetchAirtableRecords(STAGE_B_TABLE, {
      fields: ['Image', 'TJP Output', 'Slug', 'Name'],
      filterByFormula: `RECORD_ID() = '${sceneId}'`,
    })
    if (!rows.length) return NextResponse.json({ error: 'Scene not found' }, { status: 404 })
    const f = rows[0].fields || {}

    const tjp = f['TJP Output']?.[0]
    const stage = f['Image']?.[0]
    const sourceUrl = tjp?.url || stage?.url || null
    const sourceVariant = tjp ? 'tjp' : stage ? 'stage-b' : 'none'
    if (!sourceUrl) {
      return NextResponse.json({ error: 'Scene has no TJP Output or Stage B Image to start from' }, { status: 400 })
    }

    const prompt = buildPoseAltPrompt(poseDirection)

    // Submit to Wan 2.7 image-edit-pro. Same model path as the flatlay
    // route's "wan" option. 1080x1920 fits the 9:16 scene aspect; Wan
    // sizes are width*height format separated by an asterisk.
    let task
    try {
      task = await submitWaveSpeedTask('alibaba/wan-2.7/image-edit-pro', {
        images: [sourceUrl],
        prompt,
        size: '1080*1920',
      })
    } catch (e) {
      return NextResponse.json({ error: `WaveSpeed submit failed: ${e.message}` }, { status: 502 })
    }
    const predictionId = task?.id || ''
    console.log(`[stage-b/pose-alt] ${sceneId} source=${sourceVariant} predictionId=${predictionId}`)

    // Poll up to 70s. Leaves 20s of Vercel budget for the CF upload below.
    const t0 = Date.now()
    let outputUrl = null
    let lastError = null
    while (Date.now() - t0 < 70000) {
      const d = await pollWaveSpeedTask(task.id)
      if (d.status === 'completed') {
        outputUrl = (d.outputs || [])[0]
        if (!outputUrl) { lastError = 'WaveSpeed completed with no outputs'; break }
        break
      }
      if (d.status === 'failed') {
        const raw = d.error
        lastError = typeof raw === 'string' ? raw
          : raw?.message ? raw.message
          : raw ? JSON.stringify(raw)
          : 'WaveSpeed reported failed'
        break
      }
      await new Promise(r => setTimeout(r, 2500))
    }
    if (!outputUrl) {
      // Not a hard error — the prediction is probably still cooking, just
      // past our budget. Return the predictionId so a v2 client could poll
      // a resume route. For v1 the modal just shows "try again."
      return NextResponse.json(
        { error: lastError || 'Pose generation timed out — try again', predictionId },
        { status: 504 }
      )
    }

    // Pull bytes, sharp-coerce to JPEG (Wan returns PNG even at .jpg
    // hints), upload to CF Images. Using a timestamped CF id lets the
    // editor regenerate multiple alt-poses for the same scene without
    // hitting the 5409 "already exists" branch.
    const imgRes = await fetch(outputUrl)
    if (!imgRes.ok) {
      return NextResponse.json({ error: `Couldn't fetch Wan output: HTTP ${imgRes.status}` }, { status: 502 })
    }
    const rawBuf = Buffer.from(await imgRes.arrayBuffer())
    let buf
    try {
      buf = await sharp(rawBuf).jpeg({ quality: 92, mozjpeg: true }).toBuffer()
    } catch (e) {
      console.warn('[stage-b/pose-alt] jpeg re-encode failed, using raw bytes:', e.message)
      buf = rawBuf
    }

    let cdnUrl = null
    if (isCloudflareImagesConfigured()) {
      try {
        // Timestamped ID so re-runs accumulate (not idempotent here —
        // that's intentional; the editor often clicks Generate twice
        // hoping for a better result).
        const cfId = `pose-alt-${sceneId}-${Date.now()}`.toLowerCase().replace(/[^a-z0-9-]/g, '-')
        const r = await uploadImageBytes(buf, cfId)
        cdnUrl = buildDeliveryUrl(r.id, 'public')
      } catch (e) {
        console.warn('[stage-b/pose-alt] CF Images upload failed:', e.message)
        // Fall through with the raw Wavespeed URL — it's still valid for
        // a short window so the modal can preview it; just won't survive
        // longer term. Better than failing the whole generation.
      }
    }

    return NextResponse.json({
      ok: true,
      imageUrl: cdnUrl || outputUrl,
      cdnUrl,
      predictionId,
      sourceVariant,
    })
  } catch (err) {
    if (err instanceof Response) return err
    const msg = typeof err?.message === 'string' ? err.message : String(err)
    console.error('[stage-b/pose-alt] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
