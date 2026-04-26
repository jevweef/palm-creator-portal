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
  for (const [key, pose] of Object.entries(POSES)) {
    const att = (f[pose.airtableOutputField] || [])[0] || null
    outputs[key] = att ? { id: att.id, url: att.url, filename: att.filename, width: att.width, height: att.height } : null
  }

  return {
    id: record.id,
    creator: f['Creator'] || '',
    aka: f['AKA'] || '',
    enabled: !!f['AI Conversions Enabled'],
    inputs,
    inputsByPose,
    outputs,
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

// DELETE — remove an input attachment.
// Body: { creatorId, attachmentId }
export async function DELETE(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorId, attachmentId } = await request.json()
    if (!creatorId || !attachmentId) return NextResponse.json({ error: 'Missing creatorId or attachmentId' }, { status: 400 })

    const records = await fetchAirtableRecords(PALM_CREATORS, {
      filterByFormula: `RECORD_ID() = '${creatorId}'`,
      fields: ['AI Ref Inputs'],
      maxRecords: 1,
    })
    if (!records.length) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })

    const next = (records[0].fields['AI Ref Inputs'] || [])
      .filter(att => att.id !== attachmentId)
      .map(att => ({ url: att.url, filename: att.filename }))

    await patchAirtableRecord(PALM_CREATORS, creatorId, { 'AI Ref Inputs': next })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[creator-ai-clone] DELETE error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
