export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { generateWhaleAlertPdf } from '@/lib/generateWhaleAlertPdf'
import { getWhaleTopicForCreator } from '@/lib/whaleAlertConfig'

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN

export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorName, alert, analysis } = await request.json()

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
