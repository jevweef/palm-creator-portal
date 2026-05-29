export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import {
  requireAdminOrSocialMedia,
  fetchAirtableRecords,
  patchAirtableRecord,
} from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'

const AI_ACCOUNT_PROFILE_TABLE = 'AI Account Profile'
const WARMUP_TASKS_TABLE = 'Warmup Tasks'

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const TELEGRAM_SMM_CHAT = process.env.TELEGRAM_SMM_GROUP_CHAT_ID

// POST /api/admin/smm/warmup/send-task/[id]
//
// Sends a warmup task instruction to Amin via Telegram. Critical: this NEVER
// routes through Palm Creators.Telegram IG/FB Topic ID — that's the live-
// creator pipe. Warmup posts get their own per-persona forum topic stored on
// AI Account Profile.Warmup Telegram Topic ID. If the topic doesn't exist
// yet, it's created on-demand via Telegram's createForumTopic.
//
// Body (optional): { extraNote?: string, postAt?: ISO string }
//
// On success, stamps the task with a "[YYYY-MM-DD HH:MM ET] Sent to Amin"
// line prepended to Notes. Does NOT change Status — operator marks Done
// when they see the post go live.
export async function POST(request, { params }) {
  try { await requireAdminOrSocialMedia() } catch (e) { return e }

  if (!TELEGRAM_TOKEN) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 })
  }
  if (!TELEGRAM_SMM_CHAT) {
    return NextResponse.json({ error: 'TELEGRAM_SMM_GROUP_CHAT_ID not set' }, { status: 500 })
  }

  try {
    const { id } = params
    if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
      return NextResponse.json({ error: 'Invalid task id' }, { status: 400 })
    }
    const body = await request.json().catch(() => ({}))

    // 1. Fetch the task.
    const taskRows = await fetchAirtableRecords(WARMUP_TASKS_TABLE, {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(id)}`,
      fields: ['Task Title', 'Day', 'Phase', 'Description', 'Account', 'Notes'],
    })
    if (!taskRows.length) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    const task = taskRows[0]
    const accountId = (task.fields.Account || [])[0]
    if (!accountId) {
      return NextResponse.json({ error: 'Task has no linked account' }, { status: 422 })
    }

    // 2. Fetch the account.
    const accountRows = await fetchAirtableRecords(AI_ACCOUNT_PROFILE_TABLE, {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(accountId)}`,
      fields: ['Persona Name', 'Persona Handle', 'Warmup Telegram Topic ID', 'Warmup Status'],
    })
    if (!accountRows.length) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }
    const account = accountRows[0]
    const personaName = account.fields['Persona Name'] || '(unnamed)'
    const personaHandle = account.fields['Persona Handle'] || ''
    let topicId = account.fields['Warmup Telegram Topic ID'] || ''

    // 3. Get-or-create the forum topic.
    if (!topicId) {
      const topicName = `${personaName}${personaHandle ? ` (@${personaHandle})` : ''} — Warmup`
      const createRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/createForumTopic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: parseInt(TELEGRAM_SMM_CHAT, 10),
          name: topicName.slice(0, 128),
          icon_color: 0xE87878, // palm-pink, decorative
        }),
      })
      const createData = await createRes.json()
      if (!createData.ok) {
        return NextResponse.json({
          error: 'CREATE_TOPIC_FAILED',
          telegramError: createData.description || JSON.stringify(createData),
          hint: 'TELEGRAM_SMM_GROUP_CHAT_ID must point to a supergroup with topics enabled, and the bot must be an admin with manage-topics permission.',
        }, { status: 502 })
      }
      topicId = String(createData.result.message_thread_id)

      // Persist the topic ID on the profile.
      try {
        await patchAirtableRecord(AI_ACCOUNT_PROFILE_TABLE, accountId, {
          'Warmup Telegram Topic ID': topicId,
        })
      } catch (e) {
        // Telegram already created the topic — log but don't block the send.
        console.warn('[warmup/send-task] persisted topic ID failed:', e.message)
      }
    }

    // 4. Compose the message.
    const day = task.fields.Day ?? 0
    const phase = task.fields.Phase || ''
    const title = task.fields['Task Title'] || '(untitled)'
    const description = task.fields.Description || ''
    const extra = body.extraNote ? `\n\n📝 ${body.extraNote}` : ''
    const postAtLine = body.postAt
      ? `\n\n🕒 Post by:\n  • ${formatTimeZone(body.postAt, 'America/New_York')} ET\n  • ${formatTimeZone(body.postAt, 'Asia/Kolkata')} IST`
      : ''

    const messageText = [
      `📌 *${personaName}*${personaHandle ? ` _\\@${personaHandle}_` : ''}`,
      `*Day ${day}* · ${phase}`,
      '',
      `*${escapeMd(title)}*`,
      '',
      escapeMd(description),
      extra ? escapeMd(extra) : '',
      postAtLine ? escapeMd(postAtLine) : '',
    ].filter(Boolean).join('\n')

    // 5. Send to Telegram.
    const sendRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: parseInt(TELEGRAM_SMM_CHAT, 10),
        message_thread_id: parseInt(topicId, 10),
        text: messageText,
        parse_mode: 'MarkdownV2',
      }),
    })
    const sendData = await sendRes.json()
    if (!sendData.ok) {
      return NextResponse.json({
        error: 'SEND_FAILED',
        telegramError: sendData.description || JSON.stringify(sendData),
      }, { status: 502 })
    }

    // 6. Stamp the task with a Sent-to-Amin line in Notes (prepended).
    const sentLine = `[${formatTimeZone(new Date(), 'America/New_York')} ET] Sent to Amin (topic ${topicId})`
    const existingNotes = task.fields.Notes || ''
    const newNotes = existingNotes ? `${sentLine}\n${existingNotes}` : sentLine
    try {
      await patchAirtableRecord(WARMUP_TASKS_TABLE, id, { Notes: newNotes })
    } catch (e) {
      console.warn('[warmup/send-task] stamping notes failed (non-fatal):', e.message)
    }

    return NextResponse.json({
      ok: true,
      topicId,
      messageId: sendData.result.message_id,
      personaName,
    })
  } catch (err) {
    console.error('[warmup/send-task] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// Format a date for a specific IANA timezone as "YYYY-MM-DD HH:MM".
function formatTimeZone(d, tz) {
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return String(d)
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
}

// Escape MarkdownV2 special chars — Telegram is strict about this. Misses
// here cause the entire message to fail to parse.
function escapeMd(s) {
  if (typeof s !== 'string') return ''
  return s.replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, '\\$&')
}
