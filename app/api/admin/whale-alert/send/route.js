export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, createAirtableRecord, patchAirtableRecord } from '@/lib/adminAuth'
import { generateWhaleAlertPdf } from '@/lib/generateWhaleAlertPdf'
import { getWhaleTopicForCreator } from '@/lib/whaleAlertConfig'

const FAN_TRACKER_TABLE = 'Fan Tracker'

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN

export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorName, creatorRecordId, alert, analysis } = await request.json()

    if (!creatorName) return NextResponse.json({ error: 'Missing creatorName' }, { status: 400 })
    if (!alert) return NextResponse.json({ error: 'Missing alert data' }, { status: 400 })
    if (!TELEGRAM_TOKEN) return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 })

    const topic = getWhaleTopicForCreator(creatorName)
    if (!topic) {
      return NextResponse.json({ error: `No Telegram topic configured for "${creatorName}"` }, { status: 400 })
    }

    // Generate PDF
    const pdfBuffer = await generateWhaleAlertPdf({ creatorName, alert, analysis })

    // Build caption
    const urgencyEmoji = { critical: '\u{1F6A8}', high: '\u26A0\uFE0F', warning: '\u{1F7E1}' }
    const emoji = urgencyEmoji[alert.urgency] || '\u{1F7E1}'
    const caption = `${emoji} ${alert.fan}${alert.username ? ` (@${alert.username})` : ''} — ${alert.urgency.toUpperCase()}\n${alert.currentGap}d gap (${alert.gapRatio}x median) \u2022 $${Math.round(alert.lifetime).toLocaleString()} lifetime`

    // Send PDF to Telegram via sendDocument (multipart form)
    const form = new FormData()
    form.append('chat_id', topic.chatId)
    form.append('message_thread_id', String(topic.threadId))
    form.append('caption', caption)
    form.append('document', new Blob([pdfBuffer], { type: 'application/pdf' }), `whale-alert-${alert.fan.replace(/\s+/g, '-')}.pdf`)

    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`, {
      method: 'POST',
      body: form,
    })
    const data = await res.json()

    if (!data.ok) {
      console.error('[Whale Alert] Telegram sendDocument failed:', data)
      return NextResponse.json({ error: `Telegram error: ${data.description}` }, { status: 502 })
    }

    // Log to Fan Tracker (fire-and-forget, don't block response)
    if (creatorRecordId) {
      logAlertToFanTracker({
        fanName: alert.fan,
        ofUsername: alert.username,
        creatorRecordId,
        creatorName,
        alertData: alert,
      }).catch(err => console.error('[Whale Alert] Fan tracker log failed:', err))
    }

    return NextResponse.json({
      success: true,
      messageId: data.result?.message_id,
      sentTo: { creator: creatorName, chatId: topic.chatId, threadId: topic.threadId },
    })
  } catch (err) {
    console.error('[Whale Alert] Send error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── Fan Tracker logging ────────────────────────────────────────────────────

async function logAlertToFanTracker({ fanName, ofUsername, creatorRecordId, creatorName, alertData }) {
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

  // Find existing fan record
  let formula
  if (ofUsername) {
    formula = `AND({OF Username} = "${ofUsername}", FIND("${creatorRecordId}", ARRAYJOIN({Creator})))`
  } else {
    formula = `AND({Fan Name} = "${fanName}", FIND("${creatorRecordId}", ARRAYJOIN({Creator})))`
  }

  const existing = await fetchAirtableRecords(FAN_TRACKER_TABLE, {
    filterByFormula: formula,
    maxRecords: 1,
  })

  if (existing[0]) {
    const record = existing[0]
    let history = []
    try { history = JSON.parse(record.fields['Alert History'] || '[]') } catch {}
    history.push(alertEntry)

    await patchAirtableRecord(FAN_TRACKER_TABLE, record.id, {
      'Status': 'Alert Sent',
      'Last Alert Sent': now,
      'Alert Count': (record.fields['Alert Count'] || 0) + 1,
      'Alert History': JSON.stringify(history),
      'Lifetime Spend': alertData?.lifetime || record.fields['Lifetime Spend'] || 0,
      'Pre-Alert Spend 30d': alertData?.rolling30 || 0,
      'Effectiveness': 'Pending',
    })
  } else {
    await createAirtableRecord(FAN_TRACKER_TABLE, {
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
    })
  }
}
