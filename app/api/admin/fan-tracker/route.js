export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, createAirtableRecord, patchAirtableRecord } from '@/lib/adminAuth'

const TABLE = 'Fan Tracker'
const FAN_ANALYSIS_TABLE = 'tblNMtOEg2AIzvLDK'
const OPS_BASE = 'applLIT2t83plMqNx'
const AIRTABLE_HEADERS = { Authorization: `Bearer ${process.env.AIRTABLE_PAT}`, 'Content-Type': 'application/json' }

// GET — list tracked fans for a creator (or all)
// Merges Fan Tracker records + Fan Analysis records so analyzed fans always show up
export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }

  const { searchParams } = new URL(request.url)
  const creator = searchParams.get('creator') // creator AKA name
  const status = searchParams.get('status') // optional status filter

  try {
    // Fetch Fan Tracker records
    const trackerFilters = []
    if (creator) trackerFilters.push(`FIND("${creator}", ARRAYJOIN({Creator}))`)
    if (status && status !== 'all') trackerFilters.push(`{Status} = "${status}"`)

    const trackerFormula = trackerFilters.length > 1
      ? `AND(${trackerFilters.join(', ')})`
      : trackerFilters[0] || ''

    // Fetch Fan Analysis records for this creator
    // Creator field stores full name (e.g. "Laurel Driskill") but we filter by AKA (e.g. "Laurel")
    const analysisFormula = creator
      ? `FIND("${creator.replace(/"/g, '\\"')}", {Creator})`
      : ''

    const [trackerRecords, analysisRecords] = await Promise.all([
      fetchAirtableRecords(TABLE, {
        filterByFormula: trackerFormula,
        sort: [{ field: 'Last Alert Sent', direction: 'desc' }],
      }),
      fetchAnalysisRecords(analysisFormula),
    ])

    // Build map from tracker records (keyed by OF Username or Fan Name)
    const fanMap = new Map()
    for (const r of trackerRecords) {
      const key = (r.fields['OF Username'] || r.fields['Fan Name'] || '').toLowerCase()
      fanMap.set(key, {
        id: r.id,
        source: 'tracker',
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
        analysisRecords: [],
      })
    }

    // Merge analysis records — add to existing tracker entries or create new "Analyzed" entries
    for (const a of analysisRecords) {
      const key = (a.ofUsername || a.fanName || '').toLowerCase()
      if (fanMap.has(key)) {
        fanMap.get(key).analysisRecords.push(a)
      } else {
        // Fan has analysis but no tracker record — show as "Analyzed"
        if (status && status !== 'all' && status !== 'analyzed') continue
        fanMap.set(key, {
          id: `analysis-${a.id}`,
          source: 'analysis',
          fanName: a.fanName,
          ofUsername: a.ofUsername,
          creator: [],
          status: 'Analyzed',
          firstFlagged: a.analyzedDate,
          lastAlertSent: null,
          alertCount: 0,
          alertHistory: [],
          lifetimeSpend: a.lifetimeSpend || 0,
          preAlertSpend30d: 0,
          postAlertSpend30d: 0,
          effectiveness: '',
          timesGoneCold: 0,
          dropboxChatPath: '',
          lastChatUpload: null,
          notes: '',
          analyses: [],
          analysisRecords: [a],
        })
      }
    }

    // Attach analysis summaries to each fan
    const fans = Array.from(fanMap.values()).map(f => ({
      ...f,
      analysisRecords: f.analysisRecords.map(a => ({
        id: a.id,
        date: a.analyzedDate,
        type: a.analysisType,
        brief: a.managerBrief,
      })),
    }))

    // Sort: active statuses first, then by most recent activity
    fans.sort((a, b) => {
      const order = { 'Going Cold': 0, 'Alert Sent': 1, 'Analyzed': 2, 'Recovering': 3, 'Monitoring': 4, 'Reactivated': 5, 'Lost': 6 }
      const diff = (order[a.status] ?? 99) - (order[b.status] ?? 99)
      if (diff !== 0) return diff
      return (b.lastAlertSent || b.firstFlagged || '') > (a.lastAlertSent || a.firstFlagged || '') ? 1 : -1
    })

    return NextResponse.json({ fans })
  } catch (err) {
    console.error('[Fan Tracker] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

async function fetchAnalysisRecords(formula) {
  try {
    const params = new URLSearchParams()
    if (formula) params.set('filterByFormula', formula)
    params.set('sort[0][field]', 'Analyzed Date')
    params.set('sort[0][direction]', 'desc')
    const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${FAN_ANALYSIS_TABLE}?${params}`, {
      headers: AIRTABLE_HEADERS, cache: 'no-store',
    })
    const data = await res.json()
    return (data.records || []).map(r => ({
      id: r.id,
      fanName: r.fields['Fan Name'] || '',
      ofUsername: r.fields['OF Username'] || '',
      lifetimeSpend: r.fields['Lifetime Spend'] || 0,
      analysisType: r.fields['Analysis Type'] || '',
      managerBrief: r.fields['Manager Brief'] || '',
      analyzedDate: r.fields['Analyzed Date'] || '',
    }))
  } catch (err) {
    console.error('[Fan Tracker] Failed to fetch analyses:', err)
    return []
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
    formula = `AND({OF Username} = "${ofUsername}", FIND("${creatorRecordId}", ARRAYJOIN({Creator})))`
  } else {
    formula = `AND({Fan Name} = "${fanName}", FIND("${creatorRecordId}", ARRAYJOIN({Creator})))`
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
