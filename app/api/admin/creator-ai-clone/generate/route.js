import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { submitWaveSpeedTask } from '@/lib/wavespeed'
import { POSES } from '@/lib/aiCloneConfig'

export const dynamic = 'force-dynamic'

const PALM_CREATORS = 'Palm Creators'

// POST — body: { creatorId, pose, count?: 1, customPrompt? }
// Submits `count` parallel WaveSpeed tasks (each one is one image — the API
// has no native batch parameter; the playground's batch mode does the same
// fan-out client-side). Returns an array of taskIds. The frontend polls each
// independently and renders candidates as they finish.
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorId, pose, count = 1, customPrompt } = await request.json()
    if (!creatorId) return NextResponse.json({ error: 'Missing creatorId' }, { status: 400 })
    const poseConfig = POSES[pose]
    if (!poseConfig) return NextResponse.json({ error: 'Invalid pose' }, { status: 400 })
    const n = Math.max(1, Math.min(4, parseInt(count, 10) || 1))

    const records = await fetchAirtableRecords(PALM_CREATORS, {
      filterByFormula: `RECORD_ID() = '${creatorId}'`,
      fields: ['AI Ref Inputs', 'AKA'],
      maxRecords: 1,
    })
    if (!records.length) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })

    const allInputs = records[0].fields['AI Ref Inputs'] || []
    const poseInputs = allInputs.filter(att => att.filename?.startsWith(`${poseConfig.fileLabel} input_`))
    if (poseInputs.length === 0) {
      return NextResponse.json({ error: `No input photos uploaded for ${poseConfig.label}` }, { status: 400 })
    }

    const imageUrls = poseInputs.slice(0, 9).map(att => att.url)
    const prompt = customPrompt?.trim() || poseConfig.prompt

    // Build per-task body — randomize seed per task (Wan accepts seed; Nano
    // ignores unknown params so it's harmless). This gives different outputs
    // for the same prompt + inputs.
    const buildBody = () => ({
      images: imageUrls,
      prompt,
      ...poseConfig.extraParams,
      // Override seed if the model's extraParams included one (Wan does)
      ...(poseConfig.extraParams?.seed !== undefined ? { seed: Math.floor(Math.random() * 2147483647) } : {}),
    })

    // Fire all tasks in parallel
    const submissions = await Promise.allSettled(
      Array.from({ length: n }, () => submitWaveSpeedTask(poseConfig.model, buildBody()))
    )

    const taskIds = []
    const errors = []
    for (const r of submissions) {
      if (r.status === 'fulfilled') taskIds.push(r.value.id)
      else errors.push(r.reason?.message || 'submit failed')
    }
    if (taskIds.length === 0) {
      return NextResponse.json({ error: errors[0] || 'All submissions failed' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, taskIds, errors: errors.length ? errors : undefined, pose })
  } catch (err) {
    console.error('[creator-ai-clone/generate] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
