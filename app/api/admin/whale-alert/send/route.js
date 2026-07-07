export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, createAirtableRecord, patchAirtableRecord } from '@/lib/adminAuth'
import { getWhaleTopicForCreator, resolveWhaleTopic } from '@/lib/whaleAlertConfig'
import { quoteAirtableString } from '@/lib/airtableFormula'

const FAN_TRACKER_TABLE = 'Fan Tracker'

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN

function fmtMoney(n) {
  if (n == null) return '$0'
  return '$' + Math.round(n).toLocaleString('en-US')
}

export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorName, creatorAka, creatorRecordId, alert, analysis, chatWindow } = await request.json()

    if (!creatorName) return NextResponse.json({ error: 'Missing creatorName' }, { status: 400 })
    if (!alert) return NextResponse.json({ error: 'Missing alert data' }, { status: 400 })
    if (!TELEGRAM_TOKEN) return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 })

    // Telegram topic routing is keyed on AKA (Sunny, Taby, MG, Laurel), not full legal name.
    // Try AKA first, fall back to full name for backwards compat / Laurel where AKA == first name.
    const topic = (getWhaleTopicForCreator(creatorAka) || getWhaleTopicForCreator(creatorName))
      || await resolveWhaleTopic({ creatorAka, creatorName, creatorRecordId })
    if (!topic) {
      return NextResponse.json({
        error: `Couldn't resolve a Telegram topic for "${creatorAka || creatorName}" — is her Chat Team set in HQ Creators?`,
      }, { status: 400 })
    }

    // Portal link instead of a PDF: full analyses live on /chat-team (role-
    // gated web view) — legible, searchable, and no PDF/Dropbox render chain
    // (which was both low-res and the #1 send-timeout cause).
    const portalLink = `https://app.palm-mgmt.com/chat-manager/whale-hunting?creator=${encodeURIComponent(creatorRecordId || '')}&fan=${encodeURIComponent(alert.username || alert.fan || '')}`

    // Build Telegram text message
    const urgencyEmoji = { critical: '\u{1F6A8}', high: '\u26A0\uFE0F', warning: '\u{1F7E1}' }
    const emoji = urgencyEmoji[alert.urgency] || '\u{1F7E1}'

    let message = `${emoji} @${alert.username || alert.fan} — ${alert.fan}\n\n`

    // Key spending stats in layman's terms
    const peak = alert.peakMonthlyAvg ? fmtMoney(alert.peakMonthlyAvg) + '/mo' : null
    const peakRange = alert.peakRange || ''
    const last30 = fmtMoney(alert.rolling30)
    const lifetime = fmtMoney(alert.lifetime)

    if (peak) {
      message += `Peak: ${peak}${peakRange ? ` (${peakRange})` : ''}\n`
    }
    message += `Last 30 days: ${last30}\n`
    message += `Lifetime: ${lifetime}\n`

    // Manager brief as the message body
    if (analysis?.managerBrief) {
      // Strip markdown bold markers for Telegram
      const briefText = analysis.managerBrief
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .trim()
      message += `\n${briefText}\n`
    }

    // Portal link to the full analysis (chat-team page)
    message += `\n\u{1F4CE} Full analysis: ${portalLink}`

    // Send text message to Telegram
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: topic.chatId,
        message_thread_id: topic.threadId,
        text: message,
        disable_web_page_preview: false,
      }),
    })
    const data = await res.json()

    if (!data.ok) {
      console.error('[Whale Alert] Telegram sendMessage failed:', data)
      return NextResponse.json({ error: `Telegram error: ${data.description}` }, { status: 502 })
    }

    // Log to Fan Tracker — await so the client refresh picks up the new alert history.
    // If this fails (bad linked record, missing field, etc.) the Telegram message already
    // went out, so we don't want to mask the send as a failure — but we DO surface the
    // tracker error to the client so the UI can flag "sent but not tracked" instead of
    // silently showing stale status.
    let trackerError = null
    if (creatorRecordId) {
      try {
        await logAlertToFanTracker({
          fanName: alert.fan,
          ofUsername: alert.username,
          creatorRecordId,
          creatorName,
          alertData: alert,
          telegramMessageId: data.result?.message_id,
          telegramChatId: topic.chatId,
        })
      } catch (err) {
        console.error('[Whale Alert] Fan tracker log failed:', err?.stack || err)
        trackerError = err?.message || String(err)
      }
    } else {
      trackerError = 'Missing creatorRecordId — nothing was logged in Fan Tracker'
    }

    return NextResponse.json({
      success: true,
      messageId: data.result?.message_id,
      sentTo: { creator: creatorName, chatId: topic.chatId, threadId: topic.threadId },
      dropboxLink: shareLink,
      trackerError, // null on success; string with reason if the Fan Tracker write failed
    })
  } catch (err) {
    console.error('[Whale Alert] Send error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── Fan Tracker logging ────────────────────────────────────────────────────

async function logAlertToFanTracker({ fanName, ofUsername, creatorRecordId, creatorName, alertData, telegramMessageId, telegramChatId }) {
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

  // Find existing fan record — match by OF Username or Fan Name (simpler than ARRAYJOIN on linked records)
  let formula
  if (ofUsername) {
    formula = `{OF Username} = ${quoteAirtableString(ofUsername)}`
  } else {
    formula = `{Fan Name} = ${quoteAirtableString(fanName)}`
  }

  console.log('[Whale Alert] Tracker lookup formula:', formula)
  const existing = await fetchAirtableRecords(FAN_TRACKER_TABLE, {
    filterByFormula: formula,
    maxRecords: 1,
  })
  console.log('[Whale Alert] Tracker lookup found:', existing.length, 'records; first id=', existing[0]?.id)

  if (existing[0]) {
    const record = existing[0]
    let history = []
    try { history = JSON.parse(record.fields['Alert History'] || '[]') } catch {}
    history.push(alertEntry)

    console.log('[Whale Alert] Patching tracker record', record.id, 'with Status=Alert Sent')
    await patchAirtableRecord(FAN_TRACKER_TABLE, record.id, {
      'Status': 'Alert Sent',
      'Last Alert Sent': now,
      'Alert Count': (record.fields['Alert Count'] || 0) + 1,
      'Alert History': JSON.stringify(history),
      'Lifetime Spend': alertData?.lifetime || record.fields['Lifetime Spend'] || 0,
      'Pre-Alert Spend 30d': alertData?.rolling30 || 0,
      'Effectiveness': 'Pending',
      ...(telegramMessageId ? { 'Last Alert Message ID': Number(telegramMessageId) } : {}),
      ...(telegramChatId ? { 'Last Alert Chat ID': Number(telegramChatId) } : {}),
    })
    console.log('[Whale Alert] Patch call returned without throwing for record', record.id)

    // Verify-after-patch: re-read the record and confirm Status actually flipped.
    // If Airtable silently ignored the write (shouldn't, but we've seen cases where it
    // did), throw so the caller surfaces the trackerError to the UI.
    const verify = await fetchAirtableRecords(FAN_TRACKER_TABLE, {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(record.id)}`,
      maxRecords: 1,
    })
    const verifiedStatus = verify[0]?.fields?.['Status']
    console.log('[Whale Alert] Post-patch verify: Status =', verifiedStatus)
    if (verifiedStatus !== 'Alert Sent') {
      throw new Error(`Patch appeared to succeed but Status is "${verifiedStatus || 'empty'}" instead of "Alert Sent". Check Airtable field write permissions on record ${record.id}.`)
    }
    return { action: 'patched', recordId: record.id }
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
      ...(telegramMessageId ? { 'Last Alert Message ID': Number(telegramMessageId) } : {}),
      ...(telegramChatId ? { 'Last Alert Chat ID': Number(telegramChatId) } : {}),
    })
    console.log('[Whale Alert] Created new tracker record for', fanName)
    return { action: 'created' }
  }
}
