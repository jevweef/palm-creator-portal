// Cron: every 5 min, scan unprocessed Telegram Messages and pull out action
// items committed by Evan or Josh (the "us" set), or asks made of them.
// Writes one row per task to Inbox Tasks, marks source messages processed.
//
// Scoped intentionally narrow: only commitments / asks / decisions worth
// remembering. Social chatter, banter, file/photo dumps without text → skip.

export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import {
  fetchAirtableRecords,
  patchAirtableRecord,
  createAirtableRecord,
  batchUpdateRecords,
} from '@/lib/adminAuth'

const CHATS_TABLE = 'Telegram Chats'
const MESSAGES_TABLE = 'Telegram Messages'
const TASKS_TABLE = 'Inbox Tasks'

// "Us" — messages from these usernames represent commitments by us.
// Anything else is "them" (creator, team, etc.) — those are asks of us.
const US = {
  jevweef: 'Evan',
  whoisjoshvoto: 'Josh',
}

// How far back to look on each run. We process anything not yet extracted,
// but cap the total messages per run to keep Claude calls bounded.
const MAX_MESSAGES_PER_RUN = 200
const MAX_MESSAGES_PER_CHAT = 30

// Newer model = better instruction following on the JSON shape.
// Match the model used elsewhere in the codebase (refine, critique-video, etc.)
const CLAUDE_MODEL = 'claude-sonnet-4-6'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── helpers ─────────────────────────────────────────────────────────

function ownerFromUsername(username) {
  if (!username) return 'Other'
  return US[username.toLowerCase()] || 'Other'
}

function buildSystemPrompt() {
  return `You are an assistant that watches a small management agency's chat history and surfaces things that need to be remembered as tasks.

The agency manages OnlyFans creators. The "us" team is Evan (@jevweef) and Josh (@whoisjoshvoto). Everyone else in chats is either a creator, a chat manager, or another team member.

Your job: read a conversation and identify discrete action items. An action item is one of:
1. **Commitment by us** — Evan or Josh said they'd do something ("I'll send that," "I'll reach out," "I'll get back to you," "let me check," "I'll handle it," "I'll schedule a call," "yeah I can do that")
2. **Ask of us** — Someone asked Evan or Josh to do something explicitly ("can you send me X," "can you set this up," "we need you to...") AND it wasn't already answered with "no" or a completion in the same conversation
3. **Decision/plan** — A concrete next step the team agreed to ("we'll launch Tuesday," "let's do the call Friday")

DO NOT extract:
- Social chatter, jokes, reactions, emojis-only messages
- Things that were clearly already completed in the conversation
- Vague aspirations without a concrete action ("we should think about that sometime")
- Things said by the creator that are about themselves, not requests of us
- Duplicate items already captured in earlier batches

For each task, return:
- "task": short imperative summary, max 80 chars (e.g. "Send Sunny the new edit guidelines", "Schedule call with Taby")
- "owner": "Evan" | "Josh" | "Other" — who needs to do it
- "ownerUsername": telegram username of who committed/was-asked
- "sourceQuote": exact text snippet from the message that proves this is a task (≤200 chars, the actual quote not paraphrase)
- "sourceMessageKey": the messageKey of the message containing the quote
- "urgency": "Now" | "Soon" | "Later" — based on context (explicit deadlines, "ASAP", or none)
- "confidence": 0.0-1.0 — how sure you are this is a real, actionable, uncompleted task

Return ONLY a JSON array of task objects, no prose:
[{"task": "...", "owner": "...", "ownerUsername": "...", "sourceQuote": "...", "sourceMessageKey": "...", "urgency": "...", "confidence": 0.85}]

If there are no actionable items in the batch, return [].`
}

function buildUserPrompt(chatTitle, creatorAka, messages) {
  const lines = [
    `CHAT: ${chatTitle}`,
    creatorAka ? `CREATOR CONTEXT: This chat is about creator "${creatorAka}".` : `CREATOR CONTEXT: No specific creator (team-wide chat).`,
    '',
    'MESSAGES (oldest to newest):',
    ...messages.map(m => {
      const sender = m.username ? `@${m.username}` : (m.name || 'unknown')
      const usTag = US[m.username?.toLowerCase()] ? ` (${US[m.username.toLowerCase()]} — us)` : ''
      const time = m.sentAt ? new Date(m.sentAt).toLocaleString('en-US', { timeZone: 'America/New_York' }) : ''
      return `[${m.messageKey}] ${sender}${usTag} @ ${time}: ${m.text || '(no text)'}`
    }),
    '',
    'Extract action items from the above per the rules in your system prompt. Return JSON array only.',
  ]
  return lines.join('\n')
}

function parseJsonArray(content) {
  // Claude may wrap in ```json ... ``` or include a stray prefix.
  const text = (content || '').trim()
  // First try direct parse
  try { return JSON.parse(text) } catch {}
  // Try fenced
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) {
    try { return JSON.parse(fenced[1]) } catch {}
  }
  // Try first [ to last ]
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)) } catch {}
  }
  return null
}

// ─── main ────────────────────────────────────────────────────────────

export async function POST(request) { return GET(request) }

export async function GET(request) {
  // Vercel cron sends Authorization: Bearer <CRON_SECRET>
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  if (expectedAuth) {
    const actual = request.headers.get('authorization')
    if (actual !== expectedAuth) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 })
  }

  const startTs = Date.now()
  const stats = { messagesScanned: 0, chatsProcessed: 0, tasksCreated: 0, watchingChats: 0, errors: [] }

  try {
    // 1. Pull Watching chats first. We only ever extract from these — pulling
    //    by status avoids loading 200 messages from Pending Review chats and
    //    discovering nothing actionable (they're skipped by design).
    const watchingChats = await fetchAirtableRecords(CHATS_TABLE, {
      filterByFormula: `{Status} = 'Watching'`,
    })
    stats.watchingChats = watchingChats.length

    if (watchingChats.length === 0) {
      return NextResponse.json({ ok: true, idle: true, reason: 'no Watching chats', stats })
    }

    // 2. For each Watching chat, fetch its unprocessed messages.
    //    Airtable filterByFormula can't filter by linked record IDs, so we
    //    pull recent unprocessed messages and filter client-side. Cap by
    //    Sent At descending then reverse for chronological-per-chat ordering.
    const messageRecords = await fetchAirtableRecords(MESSAGES_TABLE, {
      filterByFormula: `NOT({Extracted To Task})`,
      sort: [{ field: 'Sent At', direction: 'desc' }],
      maxRecords: MAX_MESSAGES_PER_RUN,
    })
    stats.messagesScanned = messageRecords.length

    if (messageRecords.length === 0) {
      return NextResponse.json({ ok: true, idle: true, reason: 'no unprocessed messages', stats })
    }

    // 3. Filter to Watching chats only, group by chat.
    const watchingChatIds = new Set(watchingChats.map(c => c.id))
    const chatById = new Map(watchingChats.map(c => [c.id, c]))
    const byChat = new Map()
    for (const m of messageRecords) {
      const chatLink = m.fields?.Chat?.[0]
      if (!chatLink || !watchingChatIds.has(chatLink)) continue
      if (!byChat.has(chatLink)) byChat.set(chatLink, [])
      byChat.get(chatLink).push(m)
    }

    // 4. For each chat, sort by date asc + extract.
    const messageIdsToMark = []

    for (const [chatId, msgsDesc] of byChat) {
      const chatRecord = chatById.get(chatId)
      if (!chatRecord) continue
      // We pulled descending; flip to ascending for chronological context
      const msgs = [...msgsDesc].reverse()

      // Cap per-chat to keep prompts under control. Take the most recent N.
      const recent = msgs.slice(-MAX_MESSAGES_PER_CHAT)
      const chatTitle = chatRecord.fields?.Title || '(untitled)'
      const creatorAka = chatRecord.fields?.['Creator AKA'] || null

      const messagesForPrompt = recent.map(m => ({
        id: m.id,
        messageKey: m.fields?.['Telegram Msg Key'] || m.id,
        username: m.fields?.['Sender Username'] || '',
        name: m.fields?.['Sender Name'] || '',
        text: m.fields?.Text || '',
        sentAt: m.fields?.['Sent At'],
      })).filter(m => m.text) // skip pure-media messages with no text

      if (messagesForPrompt.length === 0) {
        recent.forEach(m => messageIdsToMark.push(m.id))
        continue
      }

      // 5. Call Claude.
      let extracted
      try {
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 2048,
          system: buildSystemPrompt(),
          messages: [{
            role: 'user',
            content: buildUserPrompt(chatTitle, creatorAka, messagesForPrompt),
          }],
        })
        const content = response.content?.[0]?.text || ''
        extracted = parseJsonArray(content) || []
      } catch (err) {
        stats.errors.push(`Claude error in chat ${chatId}: ${err.message}`)
        // Don't mark as processed — let the next run retry.
        continue
      }

      // 6. Write tasks back. Map sourceMessageKey to the Airtable message record.
      const keyToRecord = new Map(recent.map(m => [m.fields?.['Telegram Msg Key'], m]))
      const detectedAt = new Date().toISOString()

      for (const t of extracted) {
        if (!t || !t.task) continue
        if (typeof t.confidence === 'number' && t.confidence < 0.4) continue // skip low-confidence

        const sourceMsg = keyToRecord.get(t.sourceMessageKey)
        const ownerName = t.owner === 'Evan' || t.owner === 'Josh' ? t.owner : ownerFromUsername(t.ownerUsername)

        try {
          await createAirtableRecord(TASKS_TABLE, {
            Task: String(t.task).slice(0, 200),
            Status: 'Open',
            Owner: ownerName,
            'Owner Username': t.ownerUsername || '',
            'Creator AKA': creatorAka || '',
            'Source Quote': String(t.sourceQuote || '').slice(0, 1000),
            'Source Chat': [chatId],
            'Source Messages': sourceMsg ? [sourceMsg.id] : [],
            Urgency: ['Now', 'Soon', 'Later'].includes(t.urgency) ? t.urgency : 'Soon',
            'AI Confidence': typeof t.confidence === 'number' ? Math.round(t.confidence * 100) / 100 : null,
            'Detected At': detectedAt,
          })
          stats.tasksCreated++
        } catch (err) {
          stats.errors.push(`Task write failed: ${err.message}`)
        }
      }

      // Mark all the messages we sent to Claude as processed (even if no tasks
      // came out — we don't want to re-process the same window forever).
      recent.forEach(m => messageIdsToMark.push(m.id))
      stats.chatsProcessed++
    }

    // 7. Mark messages as processed in batches of 10.
    if (messageIdsToMark.length > 0) {
      const updates = messageIdsToMark.map(id => ({ id, fields: { 'Extracted To Task': true } }))
      await batchUpdateRecords(MESSAGES_TABLE, updates)
    }

    return NextResponse.json({
      ok: true,
      stats,
      durationMs: Date.now() - startTs,
    })
  } catch (err) {
    console.error('[extract-tasks] fatal', err)
    return NextResponse.json({ error: err.message, stats }, { status: 500 })
  }
}
