import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, deleteDropboxFile } from '@/lib/dropbox'
import { POSES, poseFromFilename, AI_REF_FOLDER } from '@/lib/aiCloneConfig'

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

// DELETE — remove an attachment (or clear the whole field) AND delete the
// underlying Dropbox file(s) so we don't accumulate orphans.
// Body shapes:
//   { creatorId, target?: 'inputs' | 'candidates', pose?, clearAll: true }
//     → wipes the entire field + deletes every file in Dropbox
//   { creatorId, target?, pose?, filename }
//     → removes the attachment matching filename + deletes the Dropbox file
//   { creatorId, attachmentId, target?, pose? }
//     → legacy match by attachment ID (filename preferred; IDs are unstable)
export async function DELETE(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorId, attachmentId, filename, target = 'inputs', pose, clearAll } = await request.json()
    if (!creatorId) return NextResponse.json({ error: 'Missing creatorId' }, { status: 400 })

    let fieldName = 'AI Ref Inputs'
    let isCandidates = false
    if (target === 'candidates') {
      if (!pose || !POSES[pose]) return NextResponse.json({ error: 'Missing/invalid pose for candidates delete' }, { status: 400 })
      fieldName = POSES[pose].airtableCandidatesField
      isCandidates = true
    }

    // Fetch current state — need AKA for Dropbox path + current attachments
    const records = await fetchAirtableRecords(PALM_CREATORS, {
      filterByFormula: `RECORD_ID() = '${creatorId}'`,
      fields: ['AKA', fieldName],
      maxRecords: 1,
    })
    if (!records.length) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
    const aka = records[0].fields.AKA
    const current = records[0].fields[fieldName] || []

    // Decide which attachments to remove
    let toRemove = []
    let next = []
    if (clearAll) {
      toRemove = current
      next = []
    } else {
      if (!attachmentId && !filename) {
        return NextResponse.json({ error: 'Missing attachmentId or filename' }, { status: 400 })
      }
      const matches = (att) => filename ? att.filename === filename : att.id === attachmentId
      toRemove = current.filter(matches)
      next = current.filter(att => !matches(att)).map(att => ({ url: att.url, filename: att.filename }))
    }

    // PATCH Airtable first (most important — UI source of truth)
    await patchAirtableRecord(PALM_CREATORS, creatorId, { [fieldName]: next })

    // Then delete the Dropbox files. Errors here are non-fatal — log and
    // continue. (Orphan files in Dropbox aren't great but better than a
    // failed delete from the user's perspective.)
    const dropboxResults = { deleted: 0, failed: 0 }
    if (aka && toRemove.length) {
      try {
        const accessToken = await getDropboxAccessToken()
        const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)
        const baseFolder = AI_REF_FOLDER(aka) + (isCandidates ? '/candidates' : '')
        for (const att of toRemove) {
          if (!att.filename) continue
          const path = `${baseFolder}/${att.filename}`
          try {
            await deleteDropboxFile(accessToken, rootNamespaceId, path)
            dropboxResults.deleted++
          } catch (e) {
            console.warn('[creator-ai-clone] Dropbox delete failed:', path, e.message)
            dropboxResults.failed++
          }
        }
      } catch (e) {
        console.error('[creator-ai-clone] Dropbox setup failed:', e.message)
      }
    }

    return NextResponse.json({ ok: true, cleared: clearAll || undefined, dropbox: dropboxResults })
  } catch (err) {
    console.error('[creator-ai-clone] DELETE error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
