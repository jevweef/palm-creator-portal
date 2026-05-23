import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { requireAdminOrAiEditor, fetchAirtableRecords } from '@/lib/adminAuth'
import { submitWaveSpeedTask, pollWaveSpeedTask } from '@/lib/wavespeed'
import { uploadImageBytes, buildDeliveryUrl, isCloudflareImagesConfigured } from '@/lib/cloudflareImages'
import { getDropboxAccessToken, getDropboxRootNamespaceId, createDropboxSharedLink } from '@/lib/dropbox'

// Convert any Dropbox shared link into a raw streamable URL Wan can fetch.
// Strips dl= / raw= params and re-appends raw=1 so we don't double-add.
function toDropboxRawUrl(sharedLink) {
  if (!sharedLink) return null
  const cleaned = sharedLink
    .replace(/[?&]dl=[01]/g, '')
    .replace(/[?&]raw=1/g, '')
    .replace(/\?$/, '')
  return cleaned + (cleaned.includes('?') ? '&raw=1' : '?raw=1')
}

// Resolve a Dropbox path → public raw URL. Idempotent via Dropbox's
// "shared link already exists" branch (createDropboxSharedLink handles
// 409 by fetching the existing link). Wan needs a public URL to fetch
// the bytes, and Dropbox-raw is our canonical source of truth.
async function dropboxPathToRawUrl(accessToken, namespaceId, path) {
  if (!path) return null
  const link = await createDropboxSharedLink(accessToken, namespaceId, path)
  return toDropboxRawUrl(link)
}

// Vercel function budget — Wan 2.7 image-edit-pro typically completes in
// 25-45s. We poll for up to 70s, leaving headroom for the CF Images
// upload before Vercel kills us at 90s.
export const maxDuration = 90

const STAGE_B_TABLE = 'Stage B Outputs'
const ROOMS_TABLE = 'Recreate Rooms'
const VARIATIONS_TABLE = 'Recreate Room Variations'
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

    // Resolve all three inputs from DROPBOX — the canonical source of
    // truth, full resolution, no re-encoding. Architecturally we don't
    // want Airtable serving image bytes at all; Airtable holds paths +
    // metadata only. CF Images is the downsized-delivery cache for
    // browse views, not what we feed into generation pipelines.
    //
    // Each input: fetch its Dropbox Path from Airtable, mint (or fetch
    // existing) Dropbox shared link, convert to ?raw=1 URL for Wan.

    // ── Figure 1: Stage B Image (subject + room composited, pre-TJP).
    // Also pull Time of Day + Room Framing — needed to pick the matching
    // room variation as Figure 2 (the Room link points to the PARENT
    // room, not the specific time-of-day variation that was actually
    // rendered for this scene).
    const sceneRows = await fetchAirtableRecords(STAGE_B_TABLE, {
      fields: ['Dropbox Path', 'Dropbox Link', 'Room', 'Slug', 'Name', 'Time of Day', 'Room Framing'],
      filterByFormula: `RECORD_ID() = '${sceneId}'`,
    })
    if (!sceneRows.length) return NextResponse.json({ error: 'Scene not found' }, { status: 404 })
    const sceneF = sceneRows[0].fields || {}
    const subjectPath = sceneF['Dropbox Path'] || ''
    const subjectExistingLink = sceneF['Dropbox Link'] || ''
    if (!subjectPath && !subjectExistingLink) {
      return NextResponse.json({ error: 'Scene has no Dropbox Path or Link — regenerate via the workflow to populate it' }, { status: 400 })
    }
    const sceneTimeOfDay = (sceneF['Time of Day']?.name || sceneF['Time of Day'] || null)

    // ── Figure 2: the specific room VARIATION that matches the scene's
    // Time of Day. The Stage B Output's Room link points at the parent
    // Recreate Room (which has a generic Base Image — usually daytime).
    // The Stage B render itself used one of the room's Recreate Room
    // Variations (a specific TOD render). To lock the right look, we
    // need the variation, not the parent base.
    //
    // Lookup chain:
    //   1. Load parent Room (for Recreate Room Variations link + name)
    //   2. If parent has variations, fetch them and find one matching
    //      sceneTimeOfDay + Status=Approved
    //   3. If a match is found → use its Dropbox Path/Link
    //   4. If no match (or no TOD on the scene) → fall back to Base Image
    const roomId = (sceneF.Room || [])[0]
    if (!roomId) {
      return NextResponse.json({ error: 'Scene is not linked to a Recreate Room — cannot lock the bedroom' }, { status: 400 })
    }
    const roomRows = await fetchAirtableRecords(ROOMS_TABLE, {
      fields: ['Base Dropbox Path', 'Base Dropbox Link', 'Room Name', 'Recreate Room Variations'],
      filterByFormula: `RECORD_ID() = '${roomId}'`,
    })
    const roomF = roomRows[0]?.fields || {}
    const roomName = roomF['Room Name'] || ''

    let roomPath = ''
    let roomExistingLink = ''
    let roomSourceLabel = 'base'  // for the debug preview label

    const variationIds = roomF['Recreate Room Variations'] || []
    if (sceneTimeOfDay && variationIds.length) {
      const orExpr = variationIds.map(id => `RECORD_ID()='${id}'`).join(',')
      const varRows = await fetchAirtableRecords(VARIATIONS_TABLE, {
        fields: ['Time of Day', 'Status', 'Dropbox Path', 'Dropbox Link', 'Variation'],
        filterByFormula: `OR(${orExpr})`,
      })
      // Match: TOD equals + Status Approved. If multiple match (Golden
      // Hour often has multiple shuffle variants), pick the first one
      // deterministically. Future work: store the SPECIFIC variation ID
      // on Stage B Output at generation time to remove ambiguity.
      const match = varRows.find(v => {
        const vTod = (v.fields?.['Time of Day']?.name || v.fields?.['Time of Day'] || null)
        const vStatus = (v.fields?.Status?.name || v.fields?.Status || null)
        return vTod === sceneTimeOfDay && vStatus === 'Approved'
      })
      if (match) {
        roomPath = match.fields?.['Dropbox Path'] || ''
        roomExistingLink = match.fields?.['Dropbox Link'] || ''
        roomSourceLabel = `variation (${sceneTimeOfDay})`
      }
    }

    // Fallback to parent Room's Base Image if no variation matched.
    if (!roomPath && !roomExistingLink) {
      roomPath = roomF['Base Dropbox Path'] || ''
      roomExistingLink = roomF['Base Dropbox Link'] || ''
      roomSourceLabel = sceneTimeOfDay ? `base (no '${sceneTimeOfDay}' variation found)` : 'base'
    }
    if (!roomPath && !roomExistingLink) {
      return NextResponse.json({ error: 'Linked Room has no Base Dropbox Path / Link AND no matching variation' }, { status: 400 })
    }

    // ── Figure 3: outfit flatlay (Dropbox path). Falls back to the
    // original photo's Dropbox path if no flatlay has been generated yet
    // (Wan can work with either; flatlay is cleaner).
    const outfitRows = await fetchAirtableRecords(PHOTOS_TABLE, {
      fields: ['Name', 'Dropbox Path', 'Dropbox Link', 'Flatlay Dropbox Path', 'Flatlay Status'],
      filterByFormula: `RECORD_ID() = '${outfitPhotoId}'`,
    })
    const outfitF = outfitRows[0]?.fields || {}
    const flatlayReady = (outfitF['Flatlay Status']?.name || outfitF['Flatlay Status']) === 'Done' && outfitF['Flatlay Dropbox Path']
    const outfitPath = flatlayReady
      ? outfitF['Flatlay Dropbox Path']
      : (outfitF['Dropbox Path'] || '')
    const outfitExistingLink = flatlayReady ? '' : (outfitF['Dropbox Link'] || '')
    if (!outfitPath && !outfitExistingLink) {
      return NextResponse.json({ error: 'Outfit photo has no Dropbox Path / Link / Flatlay Dropbox Path' }, { status: 400 })
    }
    const outfitVariant = flatlayReady ? 'flatlay' : 'original'

    // Mint all three shared links in parallel (each is ~100-200ms; serial
    // would be 300-600ms, parallel keeps total under 250ms). Idempotent —
    // createDropboxSharedLink handles 409 by returning the existing link.
    const dbxToken = await getDropboxAccessToken()
    const dbxNs = await getDropboxRootNamespaceId(dbxToken)
    const [subjectUrl, roomUrl, outfitUrl] = await Promise.all([
      subjectExistingLink ? toDropboxRawUrl(subjectExistingLink) : dropboxPathToRawUrl(dbxToken, dbxNs, subjectPath),
      roomExistingLink ? toDropboxRawUrl(roomExistingLink) : dropboxPathToRawUrl(dbxToken, dbxNs, roomPath),
      outfitExistingLink ? toDropboxRawUrl(outfitExistingLink) : dropboxPathToRawUrl(dbxToken, dbxNs, outfitPath),
    ])
    const sourceVariant = 'dropbox'

    // dryRun = preview the URLs without actually firing Wan. The modal
    // calls this whenever the outfit selection changes so the "Images
    // sent to Wan" preview stays in sync — same code path guarantees
    // what the preview shows is exactly what would go to Wan.
    if (body.dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        inputs: { subjectUrl, roomUrl, roomName, roomSourceLabel, outfitUrl, outfitVariant },
      })
    }

    const prompt = buildPoseAltPrompt(poseDirection)

    // Submit to Wan 2.7 image-edit-pro with the three reference images
    // in [identity, room, outfit] order. Wan's prompt references them as
    // Figure 1, 2, 3 in the same order. Output is 4:5 (1080x1350) since
    // these renders are destined for Instagram feed posts via Post Prep,
    // not reels — 4:5 is IG's tallest post format.
    let task
    try {
      task = await submitWaveSpeedTask('alibaba/wan-2.7/image-edit-pro', {
        images: [subjectUrl, roomUrl, outfitUrl],
        prompt,
        size: '1080*1350',
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
        roomSourceLabel,
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
