import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'
import { POSES, poseFromFilename } from '@/lib/aiCloneConfig'

export const dynamic = 'force-dynamic'

const PALM_CREATORS = 'Palm Creators'
const FIELDS = [
  'Creator', 'AKA', 'Status',
  'AI Conversions Enabled',
  'AI Ref Inputs',
  'AI Ref Front', 'AI Ref Back', 'AI Ref Face',
  'AI Ref Front Candidates', 'AI Ref Back Candidates', 'AI Ref Face Candidates',
]

// Shape the Airtable record for the UI.
function buildState(record) {
  const f = record.fields || {}
  // Dedupe by filename — pre-fix uploads could overwrite an existing Dropbox
  // file at the same path and leave Airtable with two attachment records
  // pointing at the same shared link.
  const seen = new Set()
  const inputs = (f['AI Ref Inputs'] || [])
    .filter(att => {
      const key = att.filename || att.url
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map(att => ({
      id: att.id,
      url: att.url,
      filename: att.filename,
      pose: poseFromFilename(att.filename),
      width: att.width,
      height: att.height,
      type: att.type,
    }))

  const inputsByPose = { front: [], back: [], face: [] }
  for (const att of inputs) {
    if (att.pose && inputsByPose[att.pose]) inputsByPose[att.pose].push(att)
  }

  const outputs = {}
  const candidates = {}
  for (const [key, pose] of Object.entries(POSES)) {
    const att = (f[pose.airtableOutputField] || [])[0] || null
    outputs[key] = att ? { id: att.id, url: att.url, filename: att.filename, width: att.width, height: att.height } : null
    candidates[key] = (f[pose.airtableCandidatesField] || []).map(a => ({
      id: a.id, url: a.url, filename: a.filename, width: a.width, height: a.height,
    }))
  }

  return {
    id: record.id,
    creator: f['Creator'] || '',
    aka: f['AKA'] || '',
    enabled: !!f['AI Conversions Enabled'],
    inputs,
    inputsByPose,
    outputs,
    candidates,
  }
}

// GET /api/admin/creator-ai-clone?creatorId=recXXX  → state for one creator.
// GET /api/admin/creator-ai-clone                    → list of toggled-on creators (lightweight).
export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }

  const { searchParams } = new URL(request.url)
  const creatorId = searchParams.get('creatorId')

  try {
    if (creatorId) {
      const records = await fetchAirtableRecords(PALM_CREATORS, {
        filterByFormula: `RECORD_ID() = '${creatorId}'`,
        fields: FIELDS,
        maxRecords: 1,
      })
      if (!records.length) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
      return NextResponse.json({ state: buildState(records[0]) })
    }

    const records = await fetchAirtableRecords(PALM_CREATORS, {
      filterByFormula: `{AI Conversions Enabled} = TRUE()`,
      fields: ['Creator', 'AKA', 'AI Conversions Enabled'],
      sort: [{ field: 'Creator', direction: 'asc' }],
    })
    return NextResponse.json({
      creators: records.map(r => ({ id: r.id, creator: r.fields.Creator, aka: r.fields.AKA })),
    })
  } catch (err) {
    console.error('[creator-ai-clone] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH — flip the AI Conversions Enabled toggle.
// Body: { creatorId, enabled }
export async function PATCH(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorId, enabled } = await request.json()
    if (!creatorId) return NextResponse.json({ error: 'Missing creatorId' }, { status: 400 })

    await patchAirtableRecord(PALM_CREATORS, creatorId, { 'AI Conversions Enabled': !!enabled })
    return NextResponse.json({ ok: true, enabled: !!enabled })
  } catch (err) {
    console.error('[creator-ai-clone] PATCH error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE — remove an attachment, or clear the whole field.
// Body:
//   { creatorId, target?: 'inputs' | 'candidates', pose?, clearAll: true }
//     → wipes the entire field
//   { creatorId, target?, pose?, filename }
//     → removes the attachment matching filename (stable across re-attachments)
//   { creatorId, attachmentId, target?, pose? }
//     → legacy: matches by attachment ID (NOTE: IDs change every time a
//       multipleAttachments field is re-PATCHed without IDs, so prefer
//       filename for candidates that may have been re-attached)
export async function DELETE(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorId, attachmentId, filename, target = 'inputs', pose, clearAll } = await request.json()
    if (!creatorId) return NextResponse.json({ error: 'Missing creatorId' }, { status: 400 })

    let fieldName = 'AI Ref Inputs'
    if (target === 'candidates') {
      if (!pose || !POSES[pose]) return NextResponse.json({ error: 'Missing/invalid pose for candidates delete' }, { status: 400 })
      fieldName = POSES[pose].airtableCandidatesField
    }

    if (clearAll) {
      await patchAirtableRecord(PALM_CREATORS, creatorId, { [fieldName]: [] })
      return NextResponse.json({ ok: true, cleared: true })
    }

    if (!attachmentId && !filename) {
      return NextResponse.json({ error: 'Missing attachmentId or filename' }, { status: 400 })
    }

    const records = await fetchAirtableRecords(PALM_CREATORS, {
      filterByFormula: `RECORD_ID() = '${creatorId}'`,
      fields: [fieldName],
      maxRecords: 1,
    })
    if (!records.length) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })

    const matches = (att) => filename ? att.filename === filename : att.id === attachmentId
    const next = (records[0].fields[fieldName] || [])
      .filter(att => !matches(att))
      .map(att => ({ url: att.url, filename: att.filename }))

    await patchAirtableRecord(PALM_CREATORS, creatorId, { [fieldName]: next })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[creator-ai-clone] DELETE error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
