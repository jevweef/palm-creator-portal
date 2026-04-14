export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, createAirtableRecord, patchAirtableRecord } from '@/lib/adminAuth'

const TABLE = 'Fan Tracker'

// GET — list tracked fans for a creator (or all)
export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }

  const { searchParams } = new URL(request.url)
  const creator = searchParams.get('creator') // creator AKA name
  const status = searchParams.get('status') // optional status filter

  try {
    const filters = []
    if (creator) filters.push(`FIND("${creator}", ARRAYJOIN({Creator}))`)
    if (status) filters.push(`{Status} = "${status}"`)

    const formula = filters.length > 1
      ? `AND(${filters.join(', ')})`
      : filters[0] || ''

    const records = await fetchAirtableRecords(TABLE, {
      filterByFormula: formula,
      sort: [{ field: 'Last Alert Sent', direction: 'desc' }],
    })

    const fans = records.map(r => ({
      id: r.id,
      fanName: r.fields['Fan Name'] || '',
      ofUsername: r.fields['OF Username'] || '',
      creator: r.fields['Creator'] || [],
      status: r.fields['Status'] || '',
      firstFlagged: r.fields['First Flagged'] || null,
      lastAlertSent: r.fields['Last Alert Sent'] || null,
      alertCount: r.fields['Alert Count'] || 0,
      alertHistory: parseJSON(r.fields['Alert History']),
      lifetimeSpend: r.fields['Lifetime Spend'] || 0,
      preAlertSpend30d: r.fields['Pre-Alert Spend 30d'] || 0,
      postAlertSpend30d: r.fields['Post-Alert Spend 30d'] || 0,
      effectiveness: r.fields['Effectiveness'] || '',
      timesGoneCold: r.fields['Times Gone Cold'] || 0,
      dropboxChatPath: r.fields['Dropbox Chat Path'] || '',
      lastChatUpload: r.fields['Last Chat Upload'] || null,
      notes: r.fields['Notes'] || '',
      analyses: r.fields['Analyses'] || [],
    }))

    return NextResponse.json({ fans })
  } catch (err) {
    console.error('[Fan Tracker] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST — create or update a fan tracker record
// Actions: 'log_alert', 'log_analysis', 'update_status', 'upsert'
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const body = await request.json()
    const { action } = body

    if (action === 'log_alert') {
      return await logAlert(body)
    } else if (action === 'log_analysis') {
      return await logAnalysis(body)
    } else if (action === 'update_status') {
      return await updateStatus(body)
    } else if (action === 'update_effectiveness') {
      return await updateEffectiveness(body)
    } else if (action === 'upsert') {
      return await upsertFan(body)
    } else {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (err) {
    console.error('[Fan Tracker] POST error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── Actions ────────────────────────────────────────────────────────────────

async function logAlert({ fanName, ofUsername, creatorRecordId, creatorName, alertData }) {
  if (!fanName || !creatorRecordId) {
    return NextResponse.json({ error: 'Missing fanName or creatorRecordId' }, { status: 400 })
  }

  // Find or create fan record
  let record = await findFanRecord(fanName, ofUsername, creatorRecordId)
  const now = new Date().toISOString()

  const alertEntry = {
    date: now,
    urgency: alertData?.urgency || 'warning',
    medianGap: alertData?.medianGap || 0,
    currentGap: alertData?.currentGap || 0,
    rolling30: alertData?.rolling30 || 0,
    lifetime: alertData?.lifetime || 0,
    sentTo: creatorName || '',
  }

  if (record) {
    // Update existing record
    const history = parseJSON(record.fields['Alert History']) || []
    history.push(alertEntry)
    const alertCount = (record.fields['Alert Count'] || 0) + 1
    const timesGoneCold = record.fields['Times Gone Cold'] || 1

    const updates = {
      'Status': 'Alert Sent',
      'Last Alert Sent': now,
      'Alert Count': alertCount,
      'Alert History': JSON.stringify(history),
      'Lifetime Spend': alertData?.lifetime || record.fields['Lifetime Spend'] || 0,
      'Pre-Alert Spend 30d': alertData?.rolling30 || 0,
      'Effectiveness': 'Pending',
    }

    const updated = await patchAirtableRecord(TABLE, record.id, updates)
    return NextResponse.json({ success: true, recordId: record.id, action: 'updated', alertCount })
  } else {
    // Create new fan record
    const fields = {
      'Fan Name': fanName,
      'OF Username': ofUsername || '',
      'Creator': [creatorRecordId],
      'Status': 'Alert Sent',
      'First Flagged': now,
      'Last Alert Sent': now,
      'Alert Count': 1,
      'Alert History': JSON.stringify([alertEntry]),
      'Lifetime Spend': alertData?.lifetime || 0,
      'Pre-Alert Spend 30d': alertData?.rolling30 || 0,
      'Effectiveness': 'Pending',
      'Times Gone Cold': 1,
    }

    const created = await createAirtableRecord(TABLE, fields)
    return NextResponse.json({ success: true, recordId: created.id, action: 'created' })
  }
}

async function logAnalysis({ fanName, ofUsername, creatorRecordId, analysisRecordId }) {
  if (!fanName || !creatorRecordId) {
    return NextResponse.json({ error: 'Missing fanName or creatorRecordId' }, { status: 400 })
  }

  let record = await findFanRecord(fanName, ofUsername, creatorRecordId)

  if (record) {
    const existingAnalyses = record.fields['Analyses'] || []
    const analyses = [...existingAnalyses]
    if (analysisRecordId && !analyses.includes(analysisRecordId)) {
      analyses.push(analysisRecordId)
    }
    await patchAirtableRecord(TABLE, record.id, { 'Analyses': analyses })
    return NextResponse.json({ success: true, recordId: record.id })
  } else {
    const fields = {
      'Fan Name': fanName,
      'OF Username': ofUsername || '',
      'Creator': [creatorRecordId],
      'Status': 'Going Cold',
      'First Flagged': new Date().toISOString(),
      'Times Gone Cold': 1,
      'Analyses': analysisRecordId ? [analysisRecordId] : [],
    }
    const created = await createAirtableRecord(TABLE, fields)
    return NextResponse.json({ success: true, recordId: created.id, action: 'created' })
  }
}

async function updateStatus({ recordId, status }) {
  if (!recordId || !status) {
    return NextResponse.json({ error: 'Missing recordId or status' }, { status: 400 })
  }
  await patchAirtableRecord(TABLE, recordId, { 'Status': status })
  return NextResponse.json({ success: true })
}

async function updateEffectiveness({ recordId, effectiveness, postAlertSpend30d }) {
  if (!recordId) {
    return NextResponse.json({ error: 'Missing recordId' }, { status: 400 })
  }
  const updates = {}
  if (effectiveness) updates['Effectiveness'] = effectiveness
  if (postAlertSpend30d !== undefined) updates['Post-Alert Spend 30d'] = postAlertSpend30d
  await patchAirtableRecord(TABLE, recordId, updates)
  return NextResponse.json({ success: true })
}

async function upsertFan({ fanName, ofUsername, creatorRecordId, fields: extraFields }) {
  if (!fanName || !creatorRecordId) {
    return NextResponse.json({ error: 'Missing fanName or creatorRecordId' }, { status: 400 })
  }

  let record = await findFanRecord(fanName, ofUsername, creatorRecordId)

  if (record) {
    if (extraFields && Object.keys(extraFields).length > 0) {
      await patchAirtableRecord(TABLE, record.id, extraFields)
    }
    return NextResponse.json({ success: true, recordId: record.id, action: 'exists' })
  } else {
    const fields = {
      'Fan Name': fanName,
      'OF Username': ofUsername || '',
      'Creator': [creatorRecordId],
      'First Flagged': new Date().toISOString(),
      'Times Gone Cold': 1,
      'Status': 'Going Cold',
      ...(extraFields || {}),
    }
    const created = await createAirtableRecord(TABLE, fields)
    return NextResponse.json({ success: true, recordId: created.id, action: 'created' })
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function findFanRecord(fanName, ofUsername, creatorRecordId) {
  // Try username match first (more reliable), then fall back to name
  let formula
  if (ofUsername) {
    formula = `AND({OF Username} = "${ofUsername}", FIND("${creatorRecordId}", ARRAYJOIN(RECORD_ID({Creator}))))`
  } else {
    formula = `AND({Fan Name} = "${fanName}", FIND("${creatorRecordId}", ARRAYJOIN(RECORD_ID({Creator}))))`
  }

  const records = await fetchAirtableRecords(TABLE, {
    filterByFormula: formula,
    maxRecords: 1,
  })

  return records[0] || null
}

function parseJSON(str) {
  if (!str) return null
  try { return JSON.parse(str) } catch { return null }
}
