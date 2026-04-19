export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, createAirtableRecord, patchAirtableRecord } from '@/lib/adminAuth'
import { generateWhaleAlertPdf } from '@/lib/generateWhaleAlertPdf'
import { getWhaleTopicForCreator } from '@/lib/whaleAlertConfig'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink, createDropboxFolder } from '@/lib/dropbox'

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
    const topic = getWhaleTopicForCreator(creatorAka) || getWhaleTopicForCreator(creatorName)
    if (!topic) {
      return NextResponse.json({
        error: `No Telegram topic configured for "${creatorAka || creatorName}" — check lib/whaleAlertConfig.js`,
      }, { status: 400 })
    }

    // Generate PDF (full analysis only, no manager brief)
    const pdfBuffer = await generateWhaleAlertPdf({ creatorName, creatorAka, alert, analysis })

    // Upload PDF to Dropbox — same folder as chat transcripts and analysis JSONs
    const accessToken = await getDropboxAccessToken()
    const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)
    // Match getChatBasePath() slug logic from analyze-chat route
    const fanSlug = (alert.username || alert.fan || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_')
    const creatorSlug = creatorName.replace(/[^a-zA-Z0-9_-]/g, '_')
    const fanFolder = `/Palm Ops/Chat Logs/${creatorSlug}/${fanSlug}`

    // Use chat window dates for PDF filename (matches transcript/analysis naming)
    const cleanDate = (d) => {
      if (!d) return null
      const dateOnly = d.replace(/,?\s*\d{1,2}:\d{2}\s*(am|pm)?\s*$/i, '').trim()
      return dateOnly.replace(/[,]/g, '').replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '') || null
    }
    const chatStart = cleanDate(chatWindow?.firstMessageDate)
    const chatEnd = cleanDate(chatWindow?.lastMessageDate)
    const dateSuffix = chatStart && chatEnd ? `${chatStart}_to_${chatEnd}` : new Date().toISOString().slice(0, 10)
    const dropboxPath = `${fanFolder}/whale-alert-${dateSuffix}.pdf`

    // Ensure folder hierarchy exists before uploading
    await createDropboxFolder(accessToken, rootNamespaceId, `/Palm Ops/Chat Logs`)
    await createDropboxFolder(accessToken, rootNamespaceId, `/Palm Ops/Chat Logs/${creatorSlug}`)
    await createDropboxFolder(accessToken, rootNamespaceId, fanFolder)
    console.log('[Whale Alert] Uploading PDF to', dropboxPath)
    await uploadToDropbox(accessToken, rootNamespaceId, dropboxPath, pdfBuffer, { overwrite: true })
    console.log('[Whale Alert] Upload complete')
    const shareLink = await createDropboxSharedLink(accessToken, rootNamespaceId, dropboxPath)

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

    // Dropbox link to full analysis PDF
    message += `\n\u{1F4CE} Full analysis: ${shareLink}`

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

    // Log to Fan Tracker — await so the client refresh picks up the new alert history
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
        console.error('[Whale Alert] Fan tracker log failed:', err)
      }
    }

    return NextResponse.json({
      success: true,
      messageId: data.result?.message_id,
      sentTo: { creator: creatorName, chatId: topic.chatId, threadId: topic.threadId },
      dropboxLink: shareLink,
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
    formula = `{OF Username} = "${ofUsername}"`
  } else {
    formula = `{Fan Name} = "${fanName}"`
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
      ...(telegramMessageId ? { 'Last Alert Message ID': telegramMessageId } : {}),
      ...(telegramChatId ? { 'Last Alert Chat ID': telegramChatId } : {}),
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
      ...(telegramMessageId ? { 'Last Alert Message ID': telegramMessageId } : {}),
      ...(telegramChatId ? { 'Last Alert Chat ID': telegramChatId } : {}),
    })
  }
}
