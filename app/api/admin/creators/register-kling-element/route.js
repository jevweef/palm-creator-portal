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
      fields: ['AKA', 'AI Ref Front', 'AI Ref Back', 'AI Ref Face', 'AI Ref Inputs'],
      maxRecords: 1,
    })
    if (!records.length) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })

    const aka = records[0].fields.AKA
    if (!aka) return NextResponse.json({ error: 'Creator missing AKA' }, { status: 400 })

    // Prefer the locked-in AI-generated references (clean, identity-locked,
    // pre-approved) over the raw input photos. Face is the primary anchor.
    // Kling Element supports up to 4 refs (1 primary + 3 additional) — we
    // pack the 4th slot with one raw face close-up so all 4 slots are used.
    const faceRef = (records[0].fields['AI Ref Face'] || [])[0]
    const frontRef = (records[0].fields['AI Ref Front'] || [])[0]
    const backRef = (records[0].fields['AI Ref Back'] || [])[0]
    const allInputs = records[0].fields['AI Ref Inputs'] || []
    const rawFaceInputs = allInputs.filter(att => /^Close Up Face input_/i.test(att.filename || ''))
    const rawFrontInputs = allInputs.filter(att => /^Front View input_/i.test(att.filename || ''))
    const rawBackInputs = allInputs.filter(att => /^Back View input_/i.test(att.filename || ''))

    // Build a 4-slot pack: 3 locked AI refs + 1 best-available raw face shot.
    let refs = [faceRef, frontRef, backRef].filter(Boolean)
    const extraFaceCandidate = rawFaceInputs[0]
    if (extraFaceCandidate && refs.length < 4) refs.push(extraFaceCandidate)

    // Fallback when the AI references aren't locked yet — use raw inputs only.
    if (refs.length === 0) {
      if (rawFaceInputs.length === 0 && rawFrontInputs.length === 0 && rawBackInputs.length === 0) {
        return NextResponse.json({ error: 'No AI references found on creator. Lock in the AI Super Clone references first.' }, { status: 400 })
      }
      refs = [
        ...rawFaceInputs.slice(0, 4),
        ...rawFrontInputs.slice(0, Math.max(0, 4 - rawFaceInputs.length)),
        ...rawBackInputs.slice(0, Math.max(0, 4 - rawFaceInputs.length - rawFrontInputs.length)),
      ].slice(0, 4)
    }
    refs = refs.slice(0, 4)
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

    // Description capped at 100 chars by Kling. Kling extracts visual
    // features from the images themselves — description is just metadata.
    const description = `${aka} character reference set`.slice(0, 100)

    const body = {
      name: aka.replace(/\s+/g, '_').toLowerCase(),
      description,
      image: primary.url,
      element_refer_list: remaining.map(att => att.url),
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

    // Match both locked AI refs ("Close Up Face AI Reference.*") and raw
    // input fallbacks ("Close Up Face input_*").
    const usedFace = refs.filter(r => /^Close Up Face/i.test(r.filename || '')).length
    const usedFront = refs.filter(r => /^Front View/i.test(r.filename || '')).length
    const usedBack = refs.filter(r => /^Back View/i.test(r.filename || '')).length

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
