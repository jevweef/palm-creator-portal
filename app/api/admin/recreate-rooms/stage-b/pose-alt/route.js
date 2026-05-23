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
const ROOMS_TABLE = 'Recreate Rooms'
const PHOTOS_TABLE = 'Photos'

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

// Wan 2.7 image-edit-pro prompt — three-figure reference structure.
// v1 used a single Figure 1 with strong lock language, and Wan still
// drifted the bedroom completely (regenerated to a generic hotel-style
// room). The fix here mirrors Stage B's approach: give Wan a DEDICATED
// room reference image (Figure 2) and a DEDICATED outfit reference image
// (Figure 3), and have the prompt treat those as the canonical sources
// for room + outfit instead of asking it to preserve them from Figure 1's
// background. Image-edit models reliably honor explicit reference images
// when they ignore "preserve from input" language.
//
// Figure 1: current scene render (subject + room + outfit composited)
//   → primary identity + composition reference
// Figure 2: empty bedroom (the Recreate Room Base Image used by Stage B)
//   → canonical room source — Wan should render THIS bedroom
// Figure 3: outfit flatlay (clean product shot of the picked outfit)
//   → canonical outfit source — Wan should render THIS outfit on her
function buildPoseAltPrompt(poseDirection) {
  return (
    'INPUTS:\n'
  + '• Figure 1 — a photo of a woman in a bedroom wearing an outfit. '
  + 'Use this as the IDENTITY reference for the woman herself.\n'
  + '• Figure 2 — an empty bedroom. Use this as the EXACT room the '
  + 'output must be set in. The new image must take place in THIS '
  + 'bedroom, not a different one.\n'
  + '• Figure 3 — a flat product shot of the outfit. The woman in the '
  + 'output must be wearing THIS exact outfit.\n\n'

  + 'WHAT TO GENERATE: Place the woman from Figure 1 into the bedroom '
  + 'from Figure 2, wearing the outfit from Figure 3, with a new pose '
  + 'as specified below.\n\n'

  + 'IDENTITY (from Figure 1) — keep exactly: face, hair (hairstyle, '
  + 'color, volume, bun if present), skin tone, eye color and shape, '
  + 'eyebrows, body type and proportions. Do not beautify, slim, or '
  + 'reproportion her. Same person.\n\n'

  + 'ROOM (from Figure 2) — render EXACTLY this bedroom: same walls, '
  + 'wall color, ceiling, floor, the same bed and headboard in the '
  + 'same position, same nightstands and what is on them (candles, '
  + 'lamps, books, glasses), same dresser, same plants in the same '
  + 'spots, same wall art / macrame / hangings, same window and the '
  + 'view through it, same curtains, same rug, same lighting color '
  + 'temperature and time of day. Camera angle and position match '
  + 'Figure 2. Do NOT render a different bedroom, do NOT replace any '
  + 'room element, do NOT change wall color, do NOT add or remove '
  + 'furniture, plants, or wall decor. The room is Figure 2.\n\n'

  + 'OUTFIT (from Figure 3) — she wears EXACTLY this outfit: every '
  + 'garment in Figure 3, with the exact colors, prints, cuts, lengths, '
  + 'fabric, and fit. If the bottoms in Figure 3 are SHORTS that end '
  + 'at mid-thigh, the output must show SHORTS at mid-thigh (NOT pants, '
  + 'NOT capris). If the top has no graphic, do not add one. If the top '
  + 'has a graphic, render the same graphic in the same place. Do not '
  + 'add or remove accessories not visible in Figure 3.\n\n'

  + `POSE: ${poseDirection}\n\n`

  + 'CAMERA: vertical 9:16 framing matching Figure 2\'s perspective. '
  + 'Same warm natural lighting as Figure 2 (window light, golden-hour '
  + 'tones). The woman is positioned naturally within the room — full '
  + 'or three-quarter body framing so her legs are visible from at '
  + 'least mid-thigh down.\n\n'

  + 'NEGATIVE — do NOT render a different bedroom. Do NOT change the '
  + 'outfit. Do NOT change her face. No pants instead of shorts, no '
  + 'sweatpants, no covering her legs below mid-thigh. No extra people, '
  + 'no text, no watermark, no logos.\n\n'

  + 'OUTPUT: hyper realistic raw iPhone photo, natural skin texture and '
  + 'body proportions. The woman from Figure 1, in the bedroom from '
  + 'Figure 2, wearing the outfit from Figure 3, with the new pose.'
  )
}

// POST { sceneId, outfitPhotoId, poseDirection? } — generate an alt-pose
// render of a Stage B scene for use as the upload modal's thumbnail.
// Single-shot: fires Wan with THREE reference images (subject, room,
// outfit), polls up to 70s, uploads result to Cloudflare Images, returns
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
    const outfitPhotoId = String(body.outfitPhotoId || '')
    if (!outfitPhotoId || !/^rec[A-Za-z0-9]{14}$/.test(outfitPhotoId)) {
      return NextResponse.json({ error: 'Valid outfitPhotoId required — pick an outfit from the reel\'s Selected Outfits' }, { status: 400 })
    }
    const poseDirection = (body.poseDirection || '').trim() || DEFAULT_POSE_DIRECTION

    // ── Figure 1: Stage B Image (subject + room + outfit composited).
    // We use the Image field (Stage B render) rather than TJP Output,
    // because v1 with TJP Output produced great identity preservation but
    // Wan still drifted the bedroom. With Figure 2 = empty room reference,
    // Figure 1 mainly needs to anchor identity — Stage B Image is sharp,
    // smaller (1.5MB vs 23MB), and faster for Wan to ingest. TJP fallback
    // kept for scenes generated by an older path.
    const sceneRows = await fetchAirtableRecords(STAGE_B_TABLE, {
      fields: ['Image', 'TJP Output', 'Room', 'Slug', 'Name'],
      filterByFormula: `RECORD_ID() = '${sceneId}'`,
    })
    if (!sceneRows.length) return NextResponse.json({ error: 'Scene not found' }, { status: 404 })
    const sceneF = sceneRows[0].fields || {}
    const sceneImg = sceneF['Image']?.[0] || sceneF['TJP Output']?.[0]
    if (!sceneImg?.url) {
      return NextResponse.json({ error: 'Scene has no Image / TJP Output to start from' }, { status: 400 })
    }
    const subjectUrl = sceneImg.url
    const sourceVariant = sceneF['Image']?.[0] ? 'stage-b' : 'tjp'

    // ── Figure 2: empty bedroom (Recreate Room Base Image). This is
    // the canonical room reference — Wan respects an explicit image ref
    // even when it ignores "preserve the background" prompt language.
    const roomId = (sceneF.Room || [])[0]
    if (!roomId) {
      return NextResponse.json({ error: 'Scene is not linked to a Recreate Room — cannot lock the bedroom' }, { status: 400 })
    }
    const roomRows = await fetchAirtableRecords(ROOMS_TABLE, {
      fields: ['Base Image', 'Room Name'],
      filterByFormula: `RECORD_ID() = '${roomId}'`,
    })
    const roomImg = roomRows[0]?.fields?.['Base Image']?.[0]
    if (!roomImg?.url) {
      return NextResponse.json({ error: 'Linked Room has no Base Image attachment' }, { status: 400 })
    }
    const roomUrl = roomImg.url
    const roomName = roomRows[0]?.fields?.['Room Name'] || ''

    // ── Figure 3: outfit flatlay (or original outfit photo as fallback).
    // The flatlay is the cleanest reference — pure product shot on white,
    // no body, no other clothing context. Falls back to the photo's CDN
    // URL if no flatlay has been generated.
    const outfitRows = await fetchAirtableRecords(PHOTOS_TABLE, {
      fields: ['Name', 'CDN URL', 'Flatlay CDN URL', 'Flatlay Status', 'Image'],
      filterByFormula: `RECORD_ID() = '${outfitPhotoId}'`,
    })
    const outfitF = outfitRows[0]?.fields || {}
    const flatlayReady = (outfitF['Flatlay Status']?.name || outfitF['Flatlay Status']) === 'Done' && outfitF['Flatlay CDN URL']
    const outfitUrl = flatlayReady
      ? outfitF['Flatlay CDN URL']
      : (outfitF['CDN URL'] || outfitF.Image?.[0]?.url || null)
    if (!outfitUrl) {
      return NextResponse.json({ error: 'Outfit photo has no flatlay, CDN URL, or original image' }, { status: 400 })
    }
    const outfitVariant = flatlayReady ? 'flatlay' : (outfitF['CDN URL'] ? 'cdn' : 'attachment')

    const prompt = buildPoseAltPrompt(poseDirection)

    // Submit to Wan 2.7 image-edit-pro with the three reference images
    // in [identity, room, outfit] order. Wan's prompt references them as
    // Figure 1, 2, 3 in the same order.
    let task
    try {
      task = await submitWaveSpeedTask('alibaba/wan-2.7/image-edit-pro', {
        images: [subjectUrl, roomUrl, outfitUrl],
        prompt,
        size: '1080*1920',
      })
    } catch (e) {
      return NextResponse.json({ error: `WaveSpeed submit failed: ${e.message}` }, { status: 502 })
    }
    const predictionId = task?.id || ''
    console.log(`[stage-b/pose-alt] ${sceneId} subj=${sourceVariant} room=${roomName} outfit=${outfitVariant} predictionId=${predictionId}`)

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
      // Echo the inputs so the client can show "here's what we sent to
      // Wan" in the preview panel. Useful for debugging drift cases
      // ("oh, the outfit ref was actually the original Pinterest photo,
      // not the flatlay — that's why the bottoms came out wrong").
      inputs: {
        subjectUrl,
        roomUrl,
        roomName,
        outfitUrl,
        outfitVariant,
      },
    })
  } catch (err) {
    if (err instanceof Response) return err
    const msg = typeof err?.message === 'string' ? err.message : String(err)
    console.error('[stage-b/pose-alt] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
