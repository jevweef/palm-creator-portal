// Send a message back to a watched chat. Routes by source:
//   - Telegram → bot API (sends as @palmmanage_bot, clearly labeled)
//   - iMessage → Mac daemon AppleScript (sends as your iMessage account)
//
// Body: { text: string, markTaskDone?: string (taskId) }

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import {
  requireInboxOwner,
  fetchAirtableRecords,
  patchAirtableRecord,
} from '@/lib/adminAuth'
import { sendDaemonMessage } from '@/lib/inboxDaemon'

const CHATS_TABLE = 'Telegram Chats'
const TASKS_TABLE = 'Inbox Tasks'

async function sendTelegram(chatIdStr, text) {
  const token = process.env.TELEGRAM_HEARTBEAT_BOT_TOKEN
  if (!token) return { error: 'TELEGRAM_HEARTBEAT_BOT_TOKEN not set' }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatIdStr, text }),
    })
    const data = await res.json()
    if (!data.ok) return { error: data.description || 'Telegram error', telegram: data }
    return { ok: true, messageId: data.result?.message_id }
  } catch (err) {
    return { error: err.message }
  }
}

export async function POST(request, { params }) {
  const auth = await requireInboxOwner()
  if (auth instanceof NextResponse) return auth

  const { id } = params
  if (!id) return NextResponse.json({ error: 'missing chat id' }, { status: 400 })

  let body
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const text = String(body.text || '').trim()
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 })
  if (text.length > 4000) return NextResponse.json({ error: 'text too long' }, { status: 400 })

  // Look up chat to get source + chat ID
  const chatRecordId = id.startsWith('daemon:') ? null : id
  let chatRecord
  if (chatRecordId) {
    try {
      const records = await fetchAirtableRecords(CHATS_TABLE, {
        filterByFormula: `RECORD_ID() = '${chatRecordId}'`,
        maxRecords: 1,
      })
      chatRecord = records[0]
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: 500 })
    }
    if (!chatRecord) return NextResponse.json({ error: 'chat not found' }, { status: 404 })
  }

  const source = id.startsWith('daemon:') ? 'imessage' : (chatRecord.fields?.Source || 'telegram')
  const chatIdStr = id.startsWith('daemon:') ? id.slice('daemon:'.length) : chatRecord.fields?.['Chat ID']
  if (!chatIdStr) return NextResponse.json({ error: 'chat has no Chat ID' }, { status: 500 })

  let sendResult
  if (source === 'telegram') {
    sendResult = await sendTelegram(chatIdStr, text)
  } else {
    sendResult = await sendDaemonMessage(chatIdStr, text)
  }

  if (sendResult.error) {
    return NextResponse.json({ error: sendResult.error, details: sendResult }, { status: 500 })
  }

  // Optionally mark a task done
  if (body.markTaskDone && String(body.markTaskDone).startsWith('rec')) {
    try {
      await patchAirtableRecord(TASKS_TABLE, body.markTaskDone, {
        Status: 'Done',
        Notes: `✉️ Replied via Inbox at ${new Date().toISOString()}\n"${text.slice(0, 500)}"`,
      })
    } catch (err) {
      // Send succeeded; task update failed. Return 200 with a warning.
      return NextResponse.json({ ok: true, source, sent: sendResult, taskUpdateError: err.message })
    }
  }

  return NextResponse.json({ ok: true, source, sent: sendResult })
}
