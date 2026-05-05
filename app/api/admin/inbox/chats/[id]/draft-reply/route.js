// Draft a suggested reply for a chat. Sends Claude the last N messages
// + optionally the task it should address, returns a casual short text
// the admin can edit + send.

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import {
  requireInboxOwner,
  fetchAirtableRecords,
} from '@/lib/adminAuth'
import { fetchDaemonMessages } from '@/lib/inboxDaemon'

const CHATS_TABLE = 'Telegram Chats'
const MESSAGES_TABLE = 'Telegram Messages'
const CLAUDE_MODEL = 'claude-sonnet-4-6'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const US_USERNAMES = new Set(['jevweef', 'whoisjoshvoto'])

export async function POST(request, { params }) {
  const auth = await requireInboxOwner()
  if (auth instanceof NextResponse) return auth

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 })
  }

  const { id } = params
  let body
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const taskContext = body.taskContext || null  // optional {task, sourceQuote}
  const userHint = (body.hint || '').slice(0, 500)  // optional admin nudge

  // Resolve chat info
  let chatRecord, chatIdentifier, source, chatTitle, creatorAka
  if (id.startsWith('daemon:')) {
    chatIdentifier = id.slice('daemon:'.length)
    source = 'imessage'
    chatTitle = chatIdentifier
  } else {
    try {
      const records = await fetchAirtableRecords(CHATS_TABLE, {
        filterByFormula: `RECORD_ID() = '${id}'`,
        maxRecords: 1,
      })
      chatRecord = records[0]
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: 500 })
    }
    if (!chatRecord) return NextResponse.json({ error: 'chat not found' }, { status: 404 })
    chatIdentifier = chatRecord.fields?.['Chat ID']
    source = chatRecord.fields?.Source || 'telegram'
    chatTitle = chatRecord.fields?.Title || ''
    creatorAka = chatRecord.fields?.['Creator AKA'] || null
  }

  // Get last 12 messages for context. Telegram from Airtable; iMessage from daemon.
  let recentText = ''
  try {
    if (source === 'imessage') {
      const dmsgs = await fetchDaemonMessages(chatIdentifier, 12)
      if (dmsgs) {
        recentText = dmsgs.map(m => {
          const sender = m.isFromMe ? 'Evan (YOU)' : (m.senderName || m.senderHandle || 'them')
          return `${sender}: ${m.text || '(media)'}`
        }).join('\n')
      }
    } else {
      const msgs = await fetchAirtableRecords(MESSAGES_TABLE, {
        filterByFormula: `{Chat} = '${String(chatIdentifier).replace(/'/g, "\\'")}'`,
        sort: [{ field: 'Sent At', direction: 'desc' }],
        maxRecords: 12,
      })
      recentText = msgs.reverse().map(m => {
        const username = (m.fields?.['Sender Username'] || '').toLowerCase()
        const isUs = US_USERNAMES.has(username)
        const sender = isUs ? 'Evan (YOU)' : (m.fields?.['Sender Name'] || username || 'them')
        return `${sender}: ${m.fields?.Text || '(media)'}`
      }).join('\n')
    }
  } catch (err) {
    return NextResponse.json({ error: `couldn't load messages: ${err.message}` }, { status: 500 })
  }

  const system = `You draft short, casual replies for Evan to send via iMessage or Telegram. Match his tone — relaxed, direct, lowercase-friendly, no emoji unless the conversation has them.

Rules:
- ≤2 short sentences usually
- No greeting if mid-conversation (no "Hey!" — just respond)
- Don't pretend you (the AI) know things you don't; if a question needs Evan's input, leave a [bracket] placeholder
- Match the formality level of the recent messages

Return ONLY the message text, no quotes, no explanation.`

  const user = [
    chatTitle ? `Chat: ${chatTitle}` : null,
    creatorAka ? `Creator: ${creatorAka}` : null,
    '',
    'Recent messages:',
    recentText || '(no recent messages)',
    '',
    taskContext?.task ? `Task to address: ${taskContext.task}` : null,
    taskContext?.sourceQuote ? `Source quote: "${taskContext.sourceQuote}"` : null,
    userHint ? `\nEvan wants to convey: ${userHint}` : null,
    '',
    'Draft a reply for Evan to send. Output the message text only.',
  ].filter(Boolean).join('\n')

  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 400,
      system,
      messages: [{ role: 'user', content: user }],
    })
    const draft = (response.content?.[0]?.text || '').trim()
    return NextResponse.json({ draft })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
