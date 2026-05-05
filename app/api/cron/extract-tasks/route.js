// Cron: every 5 min, scan Watching iMessage chats and surface tasks that
// need Evan's attention. Runs as a personal assistant: looks at the WHOLE
// conversation (not just unprocessed messages), tracks resolution of prior
// tasks, attributes senders correctly using contact + Palm Creators data.
//
// Behavior summary:
// - Default scope: iMessage Watching chats, plus Telegram chats whose
//   Category is NOT "Chat Team" (those are noisy ops chats handled by team).
// - Each run rebuilds context from last N messages per chat (window of recent
//   activity), even messages already extracted, so we can detect resolution.
// - Sends Claude: messages + existing OPEN tasks for that chat → Claude
//   returns {newTasks, resolvedTaskIds, updatedTaskIds}.

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
import { fetchHqRecords } from '@/lib/hqAirtable'

const CHATS_TABLE = 'Telegram Chats'
const MESSAGES_TABLE = 'Telegram Messages'
const TASKS_TABLE = 'Inbox Tasks'

// Conversation context window — last N messages per chat fed to Claude.
// Big enough to detect resolution of week-old tasks; small enough to keep
// each Claude call fast + cheap.
const MESSAGES_PER_CHAT = 60

// Match the model used elsewhere in the codebase.
const CLAUDE_MODEL = 'claude-sonnet-4-6'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── helpers ─────────────────────────────────────────────────────────

// Phone normalization for matching iMessage handles → Palm Creators.
function normPhone(s) {
  if (!s) return ''
  const digits = String(s).replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : digits
}

// "Us" detection. Telegram users matched by username; iMessage senders
// matched by Sender Username field which the daemon sets to "jevweef" for
// is_from_me=true messages.
const US_USERNAMES = new Set(['jevweef', 'whoisjoshvoto'])
function isUsUsername(u) {
  return u && US_USERNAMES.has(String(u).toLowerCase())
}

function buildSystemPrompt(yourName = 'Evan') {
  return `You are ${yourName}'s personal assistant. You watch his messaging conversations and surface what he needs to do — like a chief-of-staff for his inbox.

You think in terms of CONVERSATION FLOW, not individual messages. Read the whole exchange end-to-end before deciding anything.

Each conversation has these participants (declared in CONTEXT):
- ${yourName} (the user) — sends BLUE messages (isFromMe=true)
- Optionally a CREATOR — labelled with their AKA
- Other team members or contacts

For each thread of activity, decide:

(A) DID ${yourName.toUpperCase()} COMMIT TO DO SOMETHING?
    "I'll send that," "let me check," "I'll handle it," "I'll get back to you"
    → Task FOR ${yourName.toUpperCase()}: do the thing.

(B) DID SOMEONE ASK ${yourName.toUpperCase()} FOR SOMETHING + HE HASN'T RESPONDED?
    They asked, conversation moved on or stopped, no answer from him.
    → Task FOR ${yourName.toUpperCase()}: respond / decide.

(C) DID ${yourName.toUpperCase()} ASK SOMEONE FOR SOMETHING + THEY COMMITTED BUT HAVEN'T DELIVERED?
    He asked → they said "yes I'll send" → no follow-up.
    → Task FOR ${yourName.toUpperCase()}: follow up with [person] re: [thing].

(D) WAS A MEETING/CALL/DEADLINE SET?
    Specific time agreed.
    → Task FOR ${yourName.toUpperCase()}: confirm/show up at [time].

(E) HAS A PRIOR TASK BEEN RESOLVED?
    The EXISTING_TASKS section lists open tasks from prior runs. If the
    conversation now shows resolution (someone said "got it / thanks /
    confirmed / done / I'll do it / no need / cancelled"), mark resolved.
    Quote the exact resolving message.

DO NOT extract:
- Pure social chatter, jokes, reactions, "haha", emoji-only
- Restaurant orders, golf logistics with friends, casual catching-up
  unless ${yourName} explicitly committed to something concrete
- Duplicates of existing OPEN tasks (skip — they're already tracked)
- Tasks that are clearly already complete in the conversation

For each NEW task return:
{
  "task": "imperative summary, ≤80 chars (e.g. 'Follow up with Sunny re: edit guidelines she promised')",
  "owner": "${yourName}" (almost always — assistant tracks ${yourName}'s todos),
  "sourceQuote": "exact quoted text proving this is actionable, ≤200 chars",
  "sourceMessageKey": "the messageKey from the message containing the quote",
  "urgency": "Now" | "Soon" | "Later",
  "confidence": 0.0-1.0
}

For each RESOLVED prior task return its taskId:
{
  "resolvedTaskId": "recXXX...",
  "resolvedQuote": "exact text showing resolution",
  "resolvedMessageKey": "the messageKey"
}

Return ONE JSON object:
{
  "newTasks": [...],
  "resolvedTasks": [...]
}

If nothing actionable AND nothing resolved, return {"newTasks": [], "resolvedTasks": []}.`
}

function buildUserPrompt({ chatTitle, creatorAka, messages, openTasks }) {
  const lines = [
    `CHAT: ${chatTitle}`,
    creatorAka
      ? `CREATOR CONTEXT: This chat is about creator "${creatorAka}".`
      : `CREATOR CONTEXT: No specific creator (internal team or non-creator chat).`,
    '',
    `EXISTING OPEN TASKS for this chat (from prior runs):`,
    openTasks.length > 0
      ? openTasks.map(t => `  - taskId=${t.id} | ${t.task} | quote: "${t.sourceQuote.slice(0, 120)}"`).join('\n')
      : '  (none)',
    '',
    `MESSAGES (oldest to newest, last ${messages.length} of conversation):`,
    ...messages.map(m => {
      const sender = m.isFromMe ? 'Evan (YOU)' : (m.senderName || m.senderUsername || 'unknown')
      const time = m.sentAt
        ? new Date(m.sentAt).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' })
        : ''
      return `[${m.messageKey}] ${sender} @ ${time}: ${m.text || '(no text — media or system message)'}`
    }),
    '',
    `Read the whole conversation. Identify NEW tasks (not duplicates of existing). Identify any EXISTING tasks that are now RESOLVED. Return the JSON object.`,
  ]
  return lines.join('\n')
}

function parseJsonObject(content) {
  const text = (content || '').trim()
  try { return JSON.parse(text) } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) { try { return JSON.parse(fenced[1]) } catch {} }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)) } catch {}
  }
  return null
}

// ─── data loaders ────────────────────────────────────────────────────

async function loadCreatorPhoneMap() {
  // {normalized phone digits → AKA}. Used to attribute incoming iMessages
  // to a known creator instead of "+15551234567".
  try {
    const records = await fetchHqRecords('Creators', {
      filterByFormula: `AND(OR({Status}='Active', {Status}='Onboarding'), NOT({Phone}=''))`,
      fields: ['Creator', 'AKA', 'Phone'],
    })
    const map = new Map()
    for (const r of records) {
      const phone = normPhone(r.fields?.Phone)
      const aka = r.fields?.AKA || r.fields?.Creator
      if (phone && aka) map.set(phone, aka)
    }
    return map
  } catch (err) {
    console.warn('[extract-tasks] creator phone map failed:', err.message)
    return new Map()
  }
}

async function loadOpenTasksForChat(chatRecordId) {
  try {
    const all = await fetchAirtableRecords(TASKS_TABLE, {
      filterByFormula: `{Status} = 'Open'`,
      sort: [{ field: 'Detected At', direction: 'desc' }],
      maxRecords: 200,
    })
    return all
      .filter(r => (r.fields?.['Source Chat'] || []).includes(chatRecordId))
      .map(r => ({
        id: r.id,
        task: r.fields?.Task || '',
        sourceQuote: r.fields?.['Source Quote'] || '',
      }))
  } catch {
    return []
  }
}

// ─── main ────────────────────────────────────────────────────────────

export async function POST(request) { return GET(request) }

export async function GET(request) {
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
  const stats = {
    watchingChatsTotal: 0,
    chatsProcessed: 0,
    chatsSkippedChatTeam: 0,
    messagesScanned: 0,
    tasksCreated: 0,
    tasksResolved: 0,
    errors: [],
  }

  try {
    // 1. Load creator phone map (for attributing iMessage senders to creator AKAs).
    const creatorPhones = await loadCreatorPhoneMap()

    // 2. Pull all Watching chats; filter out Telegram Chat Team category.
    const allWatching = await fetchAirtableRecords(CHATS_TABLE, {
      filterByFormula: `{Status} = 'Watching'`,
    })
    stats.watchingChatsTotal = allWatching.length

    const watchingChats = allWatching.filter(c => {
      const cat = c.fields?.Category
      const source = c.fields?.Source
      // Skip Telegram chats categorized as Chat Team — handled by ops team
      if (source === 'telegram' && cat === 'Chat Team') {
        stats.chatsSkippedChatTeam++
        return false
      }
      return true
    })

    if (watchingChats.length === 0) {
      return NextResponse.json({ ok: true, idle: true, reason: 'no eligible Watching chats', stats })
    }

    // 3. For each chat, pull recent messages window (regardless of Extracted flag).
    //    Pull existing open tasks too so Claude can detect resolution.
    const messageIdsToMark = []

    for (const chat of watchingChats) {
      const chatPrimaryValue = chat.fields?.['Chat ID']
      if (!chatPrimaryValue) continue

      let recentMsgs
      try {
        recentMsgs = await fetchAirtableRecords(MESSAGES_TABLE, {
          filterByFormula: `{Chat} = '${String(chatPrimaryValue).replace(/'/g, "\\'")}'`,
          sort: [{ field: 'Sent At', direction: 'desc' }],
          maxRecords: MESSAGES_PER_CHAT,
        })
      } catch (err) {
        stats.errors.push(`fetch ${chat.fields?.Title}: ${err.message}`)
        continue
      }

      if (recentMsgs.length === 0) continue
      stats.messagesScanned += recentMsgs.length

      // Reverse so oldest first for chronological context
      const msgs = [...recentMsgs].reverse()
      const chatTitle = chat.fields?.Title || '(untitled)'
      const creatorAka = chat.fields?.['Creator AKA'] || null

      // Existing open tasks for this chat
      const openTasks = await loadOpenTasksForChat(chat.id)

      // Build prompt-ready message objects with sender attribution
      const messagesForPrompt = msgs.map(m => {
        const username = (m.fields?.['Sender Username'] || '').toLowerCase()
        const handle = m.fields?.['Sender Username'] || ''
        const isFromMe = isUsUsername(username)
        // For iMessage incoming messages, try mapping phone to creator
        let resolvedName = m.fields?.['Sender Name'] || ''
        if (!isFromMe && handle) {
          const phone = normPhone(handle)
          if (phone && creatorPhones.has(phone)) {
            resolvedName = `${creatorPhones.get(phone)} (creator)`
          }
        }
        return {
          id: m.id,
          messageKey: m.fields?.['Telegram Msg Key'] || m.id,
          senderUsername: handle,
          senderName: resolvedName,
          isFromMe,
          text: m.fields?.Text || '',
          sentAt: m.fields?.['Sent At'],
        }
      }).filter(m => m.text)

      if (messagesForPrompt.length === 0) {
        msgs.forEach(m => messageIdsToMark.push(m.id))
        continue
      }

      // Call Claude
      let parsed
      try {
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 3000,
          system: buildSystemPrompt('Evan'),
          messages: [{
            role: 'user',
            content: buildUserPrompt({ chatTitle, creatorAka, messages: messagesForPrompt, openTasks }),
          }],
        })
        const content = response.content?.[0]?.text || ''
        parsed = parseJsonObject(content) || { newTasks: [], resolvedTasks: [] }
      } catch (err) {
        stats.errors.push(`Claude in ${chatTitle}: ${err.message}`)
        continue
      }

      const keyToRecord = new Map(msgs.map(m => [m.fields?.['Telegram Msg Key'], m]))
      const detectedAt = new Date().toISOString()

      // Write new tasks
      for (const t of (parsed.newTasks || [])) {
        if (!t || !t.task) continue
        if (typeof t.confidence === 'number' && t.confidence < 0.5) continue

        const sourceMsg = keyToRecord.get(t.sourceMessageKey)
        const ownerName = ['Evan', 'Josh', 'Other'].includes(t.owner) ? t.owner : 'Evan'
        try {
          await createAirtableRecord(TASKS_TABLE, {
            Task: String(t.task).slice(0, 200),
            Status: 'Open',
            Owner: ownerName,
            'Owner Username': sourceMsg?.fields?.['Sender Username'] || '',
            'Creator AKA': creatorAka || '',
            'Source Quote': String(t.sourceQuote || '').slice(0, 1000),
            'Source Chat': [chat.id],
            'Source Messages': sourceMsg ? [sourceMsg.id] : [],
            Urgency: ['Now', 'Soon', 'Later'].includes(t.urgency) ? t.urgency : 'Soon',
            'AI Confidence': typeof t.confidence === 'number' ? Math.round(t.confidence * 100) / 100 : null,
            'Detected At': detectedAt,
          })
          stats.tasksCreated++
        } catch (err) {
          stats.errors.push(`Task write: ${err.message}`)
        }
      }

      // Mark prior tasks as resolved (status=Done with note)
      for (const r of (parsed.resolvedTasks || [])) {
        if (!r?.resolvedTaskId) continue
        // Verify the taskId is in our openTasks list (don't trust AI to make up IDs)
        if (!openTasks.find(t => t.id === r.resolvedTaskId)) continue
        try {
          await patchAirtableRecord(TASKS_TABLE, r.resolvedTaskId, {
            Status: 'Done',
            Notes: `🤖 Auto-resolved ${detectedAt}\nResolving message: "${String(r.resolvedQuote || '').slice(0, 500)}"`,
          })
          stats.tasksResolved++
        } catch (err) {
          stats.errors.push(`Task resolve: ${err.message}`)
        }
      }

      // Mark all messages in this window as processed (so the cron doesn't
      // keep doing pointless work — but we still RE-process via the window
      // approach above on each run since we use {Chat}=X not NOT({Extracted}))
      msgs.forEach(m => messageIdsToMark.push(m.id))
      stats.chatsProcessed++
    }

    // Mark messages processed (best-effort flag for any future schema use)
    if (messageIdsToMark.length > 0) {
      const updates = messageIdsToMark.map(id => ({ id, fields: { 'Extracted To Task': true } }))
      try { await batchUpdateRecords(MESSAGES_TABLE, updates) } catch (err) {
        stats.errors.push(`mark processed: ${err.message}`)
      }
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
