import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { submitWaveSpeedTask } from '@/lib/wavespeed'
import { POSES } from '@/lib/aiCloneConfig'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PALM_CREATORS = 'Palm Creators'
const WAN_MODEL = 'alibaba/wan-2.7/image-edit'

// shotType → pose key in POSES → AI Ref Inputs filename prefix
const SHOT_TO_POSE = { 'close-up': 'face', 'front': 'front', 'back': 'back' }

// POST — body: { creatorId, shotType, positivePrompt }
// (frameUrl/frameDataUrl/shortcode accepted but ignored — frame is only
// used by Sonnet in Step 3, never sent to Wan)
// Returns: { ok, taskId, referenceCount, pose }
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorId, shotType, positivePrompt } = await request.json()
    if (!creatorId) return NextResponse.json({ error: 'Missing creatorId' }, { status: 400 })
    if (!positivePrompt) return NextResponse.json({ error: 'Missing positivePrompt' }, { status: 400 })

    const poseKey = SHOT_TO_POSE[shotType] || 'front'
    const poseConfig = POSES[poseKey]

    // Fetch creator AKA + AI Ref Inputs
    const records = await fetchAirtableRecords(PALM_CREATORS, {
      filterByFormula: `RECORD_ID() = '${creatorId}'`,
      fields: ['AKA', 'AI Ref Inputs'],
      maxRecords: 1,
    })
    if (!records.length) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
    const aka = records[0].fields.AKA
    if (!aka) return NextResponse.json({ error: 'Creator missing AKA' }, { status: 400 })

    const allInputs = records[0].fields['AI Ref Inputs'] || []
    const refInputs = allInputs.filter(att => att.filename?.startsWith(`${poseConfig.fileLabel} input_`))
    if (refInputs.length === 0) {
      return NextResponse.json({
        error: `No ${poseConfig.fileLabel} input photos found for ${aka}. Set up the Super Clone references first (Admin → Creators → DNA → AI Super Clone).`,
      }, { status: 400 })
    }

    // The contact's workflow does NOT send the source frame to Wan — only
    // the creator's reference photos + the scene prompt extracted from the
    // frame. Sending the source frame causes Wan to lazily reproduce the
    // original subject instead of building the scene from scratch with the
    // creator's identity. The frame's already been used by Sonnet in Step 3
    // to write the prompt; that's its only role.

    // Build images array from creator's reference inputs only — up to 9
    const referenceUrls = refInputs.slice(0, 9).map(att => att.url)
    if (referenceUrls.length === 0) {
      return NextResponse.json({ error: `No usable reference URLs for ${poseConfig.fileLabel}` }, { status: 400 })
    }

    // Submit to Wan 2.7 image-edit
    const body = {
      images: referenceUrls,
      prompt: positivePrompt,
      size: '1080*1920',
      seed: -1,
    }

    const task = await submitWaveSpeedTask(WAN_MODEL, body)
    return NextResponse.json({
      ok: true,
      taskId: task.id,
      referenceCount: referenceUrls.length,
      pose: poseKey,
    })
  } catch (err) {
    console.error('[recreate/swap-creator] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
