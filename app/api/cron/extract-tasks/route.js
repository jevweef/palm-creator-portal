// Cron: every 5 min, scan Watching chats and surface tasks for Evan.
//
// Architecture:
// - Per-chat logic lives in extractForChat() — reusable so the chat-PATCH
//   endpoint can trigger immediate extraction on a new Watch click.
// - For iMessage chats, messages are read LIVE from the Mac daemon (always
//   fresh, includes backfill for newly-Watched chats). For Telegram, read
//   from Airtable (the bot is the source of truth).
// - De-dupes by sourceMessageKey: if an existing open task already references
//   the same source message, UPDATE it instead of creating a duplicate.
//   This means re-running with a better prompt cleanly replaces stale tasks.
// - Resolution detection: existing open tasks are sent to Claude alongside
//   the conversation; Claude returns which are now resolved.

export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import {
  fetchAirtableRecords,
  patchAirtableRecord,
  createAirtableRecord,
} from '@/lib/adminAuth'
import { fetchHqRecords } from '@/lib/hqAirtable'
import { fetchDaemonMessages, isDaemonConfigured } from '@/lib/inboxDaemon'

const CHATS_TABLE = 'Telegram Chats'
const MESSAGES_TABLE = 'Telegram Messages'
const TASKS_TABLE = 'Inbox Tasks'

// Conversation context window per chat. Big enough to detect resolution of
// week-old tasks; small enough to keep each Claude call fast + cheap.
const MESSAGES_PER_CHAT = 80

const CLAUDE_MODEL = 'claude-sonnet-4-6'
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── helpers ─────────────────────────────────────────────────────────

function normPhone(s) {
  if (!s) return ''
  const digits = String(s).replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : digits
}

const US_USERNAMES = new Set(['jevweef', 'whoisjoshvoto'])
function isUsUsername(u) {
  return u && US_USERNAMES.has(String(u).toLowerCase())
}

function buildSystemPrompt(yourName = 'Evan', nowIso = '') {
  return `You are ${yourName}'s personal assistant — chief-of-staff for his inbox. You think in CONVERSATION FLOW (not single messages) and you reason about REAL-WORLD ACTION CHAINS, not just literal words.

CURRENT TIME (use this to reason about deferral and overdue): ${nowIso}

Each conversation has these participants (declared in CONTEXT):
- ${yourName} (the user) — sends BLUE messages (isFromMe=true)
- Optionally a CREATOR — labelled with their AKA
- Other team members or contacts

# RULES OF ENGAGEMENT

## 1. The task must reflect THE REAL ACTION, not the literal step.
Translate mechanical events into the underlying business action:
- "Sent the invoice" → task is **"Check if [person] paid invoice"** (defer 2-3 days)
- "Asked her to upload SM clips" → task is **"Follow up if [person] uploaded SM clips"** (defer 1d)
- "Set call for Friday 3pm" → task is **"Show up + prep for [person] call Friday 3pm"** (defer until 2h before)
- "Promised to send guidelines tomorrow" → task is **"Send [person] the guidelines"** (active commitment, no defer)
- "Asked for a quote" → task is **"Decide pricing + send [person] a quote"** (don't restate the ask)

## 2. Defer follow-ups by realistic time — AND flag OVERDUE promises.
Use CURRENT TIME above to reason about elapsed vs promised.

For NEW commitments still within reasonable window — set deferUntilIso:
- Invoice payment → defer 2-3 days from invoice send
- Content upload promised "today" → defer 18-24 hours
- Reply expected "next week" → defer 5-7 days
- "Will get back to you tomorrow" → defer 24-30 hours
- Time-bound calls/meetings → defer until 2 hours before
If the action is immediate (someone's waiting NOW), don't defer.

For OVERDUE commitments — promise time has passed and no follow-up:
- "Said she'd send tmr" + 3+ days elapsed = OVERDUE → urgency: Now, no defer
- Include the elapsed time in the task copy: "Follow up — promised 5 days ago"
- Example: "Follow up with MG — custom item promised 5/1 (5 days overdue)"
This is one of the highest-value behaviors: surface slipped promises.

## 3. Owner is whoever does the action.
- "Follow up with Sunny" → owner: ${yourName} (he's the follower)
- "Send Taby the guidelines" → owner: ${yourName} (he's the sender)
- Tasks for OTHERS don't go in this inbox — this is ${yourName}'s todo list

## 4. Decision tree per conversation:

(A) Did ${yourName} commit to do something + still pending?
    → Task FOR ${yourName}: do the thing.

(B) Did someone ask ${yourName} for something + he hasn't responded?
    → Task FOR ${yourName}: respond / decide.

(C) Did ${yourName} ask someone for something + they committed but haven't delivered?
    → Task FOR ${yourName}: follow up to verify [person] delivered [thing].
    → DEFER until reasonable time has passed (or NOW if overdue).

(D) Was a meeting/call/deadline set? → Task FOR ${yourName}: prep + show up.

(E) Did ${yourName} (or his team) take an action that requires a follow-up check?
    e.g. "Sent invoice" → check payment landed in 2-3d.
    → Task FOR ${yourName}: verify [outcome of action].
    → DEFER appropriately.

(F) Has a PRIOR task been resolved by later messages?
    Look for explicit ("got it", "done", "thanks") OR IMPLICIT signals:
    - Help-offer → person took the action successfully = resolved
    - Question → answer was given and confirmed = resolved
    - Ask → fulfilled in conversation = resolved
    Return resolvedTaskId + the quote that resolved it.

## DO NOT extract:
- Pure social chatter, jokes, reactions, "haha", emoji-only
- Banter / restaurant orders / casual catching-up unless ${yourName} committed
- Things clearly already complete in the conversation

## DEDUPLICATION
EXISTING_TASKS lists current open tasks for this chat with their sourceMessageKey.
- If you would generate a task for the SAME source message, REUSE that messageKey
  in the new task — the system will UPDATE the existing task with your new wording
  rather than create a duplicate.
- If the conversation now warrants a different framing of an old task, output the
  NEW task with the old sourceMessageKey AND mark the old taskId as resolved
  (with reason "superseded").

# OUTPUT SHAPE

For each task (new OR refreshed):
{
  "task": "imperative summary, ≤80 chars, REAL action — DON'T include 'Evan' or doer's name (UI shows it)",
  "doerName": "FRIENDLY name of who needs to act: 'Evan', 'Josh', a creator AKA ('MG', 'Sunny'), or a contact name ('Meeps')",
  "owner": "Evan" | "Josh" | "Other"  (broad bucket — Doer Name is the human-readable label)",
  "sourceQuote": "exact quoted text proving this is actionable, ≤200 chars",
  "sourceMessageKey": "the messageKey from the message",
  "urgency": "Now" | "Soon" | "Later",
  "deferUntilIso": "ISO datetime or OMIT",
  "confidence": 0.0-1.0
}

Doer choice rule: who must take the next action to complete this task?
- "Follow up with X re: Y" → doer is Evan (he follows up)
- "X said she'd send Y" → doer is X (she sends)
- "Pay invoice" → doer is the person paying
- "Show up to call" → doer is Evan

For each RESOLVED prior task:
{
  "resolvedTaskId": "recXXX...",
  "resolvedQuote": "exact text or context showing resolution",
  "resolvedMessageKey": "the messageKey"
}

Return ONE JSON object: {"newTasks": [...], "resolvedTasks": [...]}.
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
      ? openTasks.map(t => `  - taskId=${t.id} | sourceKey=${t.sourceMessageKey || '?'} | "${t.task}" | quote: "${t.sourceQuote.slice(0, 120)}"`).join('\n')
      : '  (none)',
    '',
    `MESSAGES (oldest to newest, last ${messages.length} of conversation):`,
    ...messages.map(m => {
      const sender = m.isFromMe ? 'Evan (YOU)' : (m.senderName || m.senderUsername || 'unknown')
      const time = m.sentAt
        ? new Date(m.sentAt).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' })
        : ''
      return `[${m.messageKey}] ${sender} @ ${time}: ${m.text || '(no text — media)'}`
    }),
    '',
    `Read the whole conversation. Identify NEW tasks. Identify EXISTING tasks now RESOLVED. Reuse sourceMessageKey of an existing task to UPDATE its wording. Return the JSON object.`,
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

let _creatorPhonesCache = null
let _creatorPhonesCacheTs = 0
async function loadCreatorPhoneMap() {
  // Cache for 5 min — Phone field doesn't change often.
  if (_creatorPhonesCache && Date.now() - _creatorPhonesCacheTs < 5 * 60 * 1000) {
    return _creatorPhonesCache
  }
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
    _creatorPhonesCache = map
    _creatorPhonesCacheTs = Date.now()
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
        sourceMessageKey: (r.fields?.['Source Messages'] || [])[0]?.name || null,
        // Fallback: parse the message key from Notes or use the linked record name
      }))
  } catch {
    return []
  }
}

// Pull messages for a chat. iMessage → daemon (live). Telegram → Airtable.
async function loadMessagesForChat(chat) {
  const source = chat.fields?.Source || 'telegram'
  const chatId = chat.fields?.['Chat ID']
  if (!chatId) return []

  if (source === 'imessage' && isDaemonConfigured()) {
    const dmsgs = await fetchDaemonMessages(chatId, MESSAGES_PER_CHAT)
    if (!dmsgs) return []
    return dmsgs.map(d => ({
      messageKey: d.messageKey,
      text: d.text || '',
      senderUsername: d.senderHandle || (d.isFromMe ? 'jevweef' : ''),
      senderName: d.isFromMe ? 'Evan' : (d.senderName || ''),
      isFromMe: !!d.isFromMe,
      sentAt: d.sentAt,
      airtableRecordId: null, // not in Airtable
    }))
  }

  // Telegram → Airtable
  const records = await fetchAirtableRecords(MESSAGES_TABLE, {
    filterByFormula: `{Chat} = '${String(chatId).replace(/'/g, "\\'")}'`,
    sort: [{ field: 'Sent At', direction: 'desc' }],
    maxRecords: MESSAGES_PER_CHAT,
  })
  return records.reverse().map(m => {
    const username = (m.fields?.['Sender Username'] || '').toLowerCase()
    return {
      messageKey: m.fields?.['Telegram Msg Key'] || m.id,
      text: m.fields?.Text || '',
      senderUsername: m.fields?.['Sender Username'] || '',
      senderName: m.fields?.['Sender Name'] || '',
      isFromMe: isUsUsername(username),
      sentAt: m.fields?.['Sent At'],
      airtableRecordId: m.id,
    }
  })
}

// ─── per-chat extraction (also called by chat PATCH on Watch) ────────

export async function extractForChat(chat, { creatorPhones } = {}) {
  if (!chat) return { error: 'no chat' }
  const stats = { messagesScanned: 0, tasksCreated: 0, tasksUpdated: 0, tasksResolved: 0 }

  const phones = creatorPhones || await loadCreatorPhoneMap()
  const messages = await loadMessagesForChat(chat)
  if (messages.length === 0) return { ...stats, reason: 'no messages' }
  stats.messagesScanned = messages.length

  const chatTitle = chat.fields?.Title || '(untitled)'
  const creatorAka = chat.fields?.['Creator AKA'] || null

  // Resolve creator names on incoming senders via phone map
  const messagesForPrompt = messages.map(m => {
    let name = m.senderName
    if (!m.isFromMe && m.senderUsername) {
      const phone = normPhone(m.senderUsername)
      if (phone && phones.has(phone)) name = `${phones.get(phone)} (creator)`
    }
    return { ...m, senderName: name }
  }).filter(m => m.text)
  if (messagesForPrompt.length === 0) return { ...stats, reason: 'no text messages' }

  const openTasks = await loadOpenTasksForChat(chat.id)

  let parsed
  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 3000,
      system: buildSystemPrompt('Evan', new Date().toISOString()),
      messages: [{
        role: 'user',
        content: buildUserPrompt({ chatTitle, creatorAka, messages: messagesForPrompt, openTasks }),
      }],
    })
    const content = response.content?.[0]?.text || ''
    parsed = parseJsonObject(content) || { newTasks: [], resolvedTasks: [] }
  } catch (err) {
    return { ...stats, error: `Claude: ${err.message}` }
  }

  const detectedAt = new Date().toISOString()
  const keyToMsg = new Map(messages.map(m => [m.messageKey, m]))
  // Index existing tasks by their sourceMessageKey for de-dup
  const openByKey = new Map()
  for (const t of openTasks) {
    if (t.sourceMessageKey) openByKey.set(t.sourceMessageKey, t)
  }

  // New OR updated tasks
  for (const t of (parsed.newTasks || [])) {
    if (!t || !t.task) continue
    if (typeof t.confidence === 'number' && t.confidence < 0.5) continue

    let deferUntil = null
    if (t.deferUntilIso) {
      const d = new Date(t.deferUntilIso)
      if (!isNaN(d.getTime()) && d.getTime() > Date.now()) deferUntil = d.toISOString()
    }

    const existing = openByKey.get(t.sourceMessageKey)
    const sourceMsg = keyToMsg.get(t.sourceMessageKey)
    const fields = {
      Task: String(t.task).slice(0, 200),
      'Source Quote': String(t.sourceQuote || '').slice(0, 1000),
      Urgency: ['Now', 'Soon', 'Later'].includes(t.urgency) ? t.urgency : 'Soon',
      'AI Confidence': typeof t.confidence === 'number' ? Math.round(t.confidence * 100) / 100 : null,
      ...(deferUntil ? { 'Defer Until': deferUntil } : {}),
      ...(t.doerName ? { 'Doer Name': String(t.doerName).slice(0, 80) } : {}),
      ...(sourceMsg?.sentAt ? { 'Source Sent At': sourceMsg.sentAt } : {}),
    }

    try {
      if (existing) {
        // Update wording in place — keep original Detected At + Source links
        await patchAirtableRecord(TASKS_TABLE, existing.id, fields)
        stats.tasksUpdated++
      } else {
        await createAirtableRecord(TASKS_TABLE, {
          ...fields,
          Status: 'Open',
          Owner: ['Evan', 'Josh', 'Other'].includes(t.owner) ? t.owner : 'Evan',
          'Owner Username': sourceMsg?.senderUsername || '',
          'Creator AKA': creatorAka || '',
          'Source Chat': [chat.id],
          'Source Messages': sourceMsg?.airtableRecordId ? [sourceMsg.airtableRecordId] : [],
          'Detected At': detectedAt,
        })
        stats.tasksCreated++
      }
    } catch (err) {
      console.warn(`[extract] task write failed in ${chatTitle}:`, err.message)
    }
  }

  // Resolved
  for (const r of (parsed.resolvedTasks || [])) {
    if (!r?.resolvedTaskId) continue
    if (!openTasks.find(t => t.id === r.resolvedTaskId)) continue
    try {
      await patchAirtableRecord(TASKS_TABLE, r.resolvedTaskId, {
        Status: 'Done',
        Notes: `🤖 Auto-resolved ${detectedAt}\nResolving message: "${String(r.resolvedQuote || '').slice(0, 500)}"`,
      })
      stats.tasksResolved++
    } catch (err) {
      console.warn(`[extract] resolve failed:`, err.message)
    }
  }

  return stats
}

// ─── cron entry ─────────────────────────────────────────────────────

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
    tasksUpdated: 0,
    tasksResolved: 0,
    errors: [],
  }

  try {
    const allWatching = await fetchAirtableRecords(CHATS_TABLE, {
      filterByFormula: `{Status} = 'Watching'`,
    })
    stats.watchingChatsTotal = allWatching.length

    const watching = allWatching.filter(c => {
      const cat = c.fields?.Category
      const source = c.fields?.Source
      if (source === 'telegram' && cat === 'Chat Team') {
        stats.chatsSkippedChatTeam++
        return false
      }
      return true
    })

    if (watching.length === 0) {
      return NextResponse.json({ ok: true, idle: true, stats })
    }

    const phones = await loadCreatorPhoneMap()

    for (const chat of watching) {
      try {
        const r = await extractForChat(chat, { creatorPhones: phones })
        stats.chatsProcessed++
        stats.messagesScanned += r.messagesScanned || 0
        stats.tasksCreated += r.tasksCreated || 0
        stats.tasksUpdated += r.tasksUpdated || 0
        stats.tasksResolved += r.tasksResolved || 0
        if (r.error) stats.errors.push(`${chat.fields?.Title}: ${r.error}`)
      } catch (err) {
        stats.errors.push(`${chat.fields?.Title}: ${err.message}`)
      }
    }

    return NextResponse.json({ ok: true, stats, durationMs: Date.now() - startTs })
  } catch (err) {
    console.error('[extract-tasks] fatal', err)
    return NextResponse.json({ error: err.message, stats }, { status: 500 })
  }
}
