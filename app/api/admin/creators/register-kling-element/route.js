import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'
import { submitWaveSpeedTask, pollWaveSpeedTask } from '@/lib/wavespeed'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PALM_CREATORS = 'Palm Creators'
const KLING_ELEMENTS_MODEL = 'kwaivgi/kling-elements'

// POST — body: { creatorId }
// Pulls the creator's AI Ref Inputs (Close Up Face + a few Front View),
// registers them as a Kling Element, saves the element_id to the creator
// record. Returns { ok, elementId }.
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorId } = await request.json()
    if (!creatorId) return NextResponse.json({ error: 'Missing creatorId' }, { status: 400 })

    const records = await fetchAirtableRecords(PALM_CREATORS, {
      filterByFormula: `RECORD_ID() = '${creatorId}'`,
      fields: ['AKA', 'AI Ref Inputs'],
      maxRecords: 1,
    })
    if (!records.length) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })

    const aka = records[0].fields.AKA
    if (!aka) return NextResponse.json({ error: 'Creator missing AKA' }, { status: 400 })

    const allInputs = records[0].fields['AI Ref Inputs'] || []
    if (!allInputs.length) return NextResponse.json({ error: 'No AI Ref Inputs on creator. Set up the AI Super Clone first.' }, { status: 400 })

    // Prefer face close-ups for identity lock; round out with a couple of
    // front-body shots so Kling has head-to-body proportion context.
    const faceInputs = allInputs.filter(att => /^Close Up Face input_/i.test(att.filename || ''))
    const frontInputs = allInputs.filter(att => /^Front View input_/i.test(att.filename || ''))

    if (faceInputs.length === 0 && frontInputs.length === 0) {
      return NextResponse.json({ error: 'No Close Up Face or Front View inputs found on creator.' }, { status: 400 })
    }

    // Cap at ~12 total references. Kling Elements supports many; we cap to
    // keep request size bounded and noise low.
    const refs = [...faceInputs.slice(0, 9), ...frontInputs.slice(0, 3)]
    if (refs.length === 0) {
      return NextResponse.json({ error: 'No reference images available.' }, { status: 400 })
    }

    const primary = refs[0]
    const remaining = refs.slice(1)

    // Generic identity description. Kling extracts visual features from the
    // images themselves; the description is mostly for the element's own
    // metadata / future "type element name in prompt" use.
    const description = `${aka} — OnlyFans creator. Identity locked from ${refs.length} reference photos covering face close-ups and front-body angles.`

    const body = {
      name: aka.replace(/\s+/g, '_').toLowerCase(),
      description,
      image: primary.url,
      element_refer_list: remaining.map(att => att.url),
      tag_list: ['creator', aka.toLowerCase().replace(/\s+/g, '-')],
    }

    const task = await submitWaveSpeedTask(KLING_ELEMENTS_MODEL, body)

    // Poll for completion. Element creation is fast (~$0.01) — should finish
    // in seconds, but we give it up to 50s before giving up.
    let elementId = null
    const MAX_MS = 50_000
    const startedAt = Date.now()
    while (Date.now() - startedAt < MAX_MS) {
      await new Promise(r => setTimeout(r, 2000))
      const result = await pollWaveSpeedTask(task.id)
      if (result.status === 'completed') {
        // The element_id can land in outputs[0] (string), or directly in result.element_id,
        // or in result.outputs as an object — try a few shapes.
        const out0 = Array.isArray(result.outputs) ? result.outputs[0] : null
        if (typeof out0 === 'string') elementId = out0
        else if (out0?.element_id) elementId = out0.element_id
        else if (out0?.id) elementId = out0.id
        else if (result.element_id) elementId = result.element_id
        break
      }
      if (result.status === 'failed') {
        return NextResponse.json({ error: result.error || 'Element creation failed' }, { status: 500 })
      }
    }

    if (!elementId) {
      return NextResponse.json({ error: 'Element creation timed out or returned no element_id', taskId: task.id }, { status: 500 })
    }

    await patchAirtableRecord(PALM_CREATORS, creatorId, {
      'Kling Element ID': elementId,
    })

    return NextResponse.json({
      ok: true,
      elementId,
      referenceCount: refs.length,
      faceCount: Math.min(faceInputs.length, 9),
      frontCount: Math.min(frontInputs.length, 3),
    })
  } catch (err) {
    console.error('[register-kling-element] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
