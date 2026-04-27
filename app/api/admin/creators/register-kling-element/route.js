import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'
import { submitWaveSpeedTask, pollWaveSpeedTask } from '@/lib/wavespeed'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PALM_CREATORS = 'Palm Creators'
const KLING_ELEMENTS_MODEL = 'kwaivgi/kling-elements'

// POST — body: { creatorId, preview?: boolean }
// preview=true → returns the 4 refs that WOULD be used, no Kling call.
// preview=false (default) → actually registers with Kling, saves element_id.
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorId, preview } = await request.json()
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

    // Kling Elements caps at 4 total reference images (1 primary + up to 3 in
    // element_refer_list). For face accuracy, we use all 4 slots on face
    // close-ups — body context comes from the Step 5 start-frame swap.
    // If face inputs aren't available, fall back to front then back.
    const faceInputs = allInputs.filter(att => /^Close Up Face input_/i.test(att.filename || ''))
    const frontInputs = allInputs.filter(att => /^Front View input_/i.test(att.filename || ''))
    const backInputs = allInputs.filter(att => /^Back View input_/i.test(att.filename || ''))

    if (faceInputs.length === 0 && frontInputs.length === 0 && backInputs.length === 0) {
      return NextResponse.json({ error: 'No Close Up Face, Front View, or Back View inputs found on creator.' }, { status: 400 })
    }

    // Pick up to 4 face shots; fill remaining slots from front/back if needed.
    const refs = [
      ...faceInputs.slice(0, 4),
      ...frontInputs.slice(0, Math.max(0, 4 - faceInputs.length)),
      ...backInputs.slice(0, Math.max(0, 4 - faceInputs.length - frontInputs.length)),
    ].slice(0, 4)
    if (refs.length === 0) {
      return NextResponse.json({ error: 'No reference images available.' }, { status: 400 })
    }

    const primary = refs[0]
    const remaining = refs.slice(1)

    // Preview mode: surface what we'd send before committing the paid call.
    if (preview) {
      return NextResponse.json({
        ok: true,
        preview: true,
        refs: refs.map(r => ({
          url: r.url,
          filename: r.filename,
          width: r.width,
          height: r.height,
        })),
        primaryFilename: primary.filename,
      })
    }

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

    const usedFace = refs.filter(r => /^Close Up Face input_/i.test(r.filename || '')).length
    const usedFront = refs.filter(r => /^Front View input_/i.test(r.filename || '')).length
    const usedBack = refs.filter(r => /^Back View input_/i.test(r.filename || '')).length

    return NextResponse.json({
      ok: true,
      elementId,
      referenceCount: refs.length,
      faceCount: usedFace,
      frontCount: usedFront,
      backCount: usedBack,
    })
  } catch (err) {
    console.error('[register-kling-element] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
