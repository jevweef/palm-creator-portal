import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { submitWaveSpeedTask } from '@/lib/wavespeed'
import { POSES } from '@/lib/aiCloneConfig'

export const dynamic = 'force-dynamic'

const PALM_CREATORS = 'Palm Creators'

// POST — body: { creatorId, pose, customPrompt? }
// Submits a WaveSpeed task using the creator's pose-specific input photos.
// Returns the task id + the polling URL. Frontend polls /poll until completion.
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorId, pose, customPrompt } = await request.json()
    if (!creatorId) return NextResponse.json({ error: 'Missing creatorId' }, { status: 400 })
    const poseConfig = POSES[pose]
    if (!poseConfig) return NextResponse.json({ error: 'Invalid pose' }, { status: 400 })

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

    // WaveSpeed needs publicly accessible URLs. Airtable attachment URLs ARE public
    // (signed CDN URLs with multi-hour validity). Use those directly.
    const imageUrls = poseInputs.slice(0, 9).map(att => att.url)
    const prompt = customPrompt?.trim() || poseConfig.prompt

    const body = {
      images: imageUrls,
      prompt,
      ...poseConfig.extraParams,
    }

    const task = await submitWaveSpeedTask(poseConfig.model, body)
    return NextResponse.json({
      ok: true,
      taskId: task.id,
      pose,
      status: task.status,
      pollUrl: task.urls?.get,
    })
  } catch (err) {
    console.error('[creator-ai-clone/generate] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
