// Telegram Heartbeat webhook — receives every message in every chat the
// @palmmanage_bot is a member of, routes to Airtable based on per-chat opt-in.
//
// Setup recap:
// - Bot username: @palmmanage_bot, privacy mode disabled
// - Token: process.env.TELEGRAM_HEARTBEAT_BOT_TOKEN
// - Webhook secret: process.env.TELEGRAM_WEBHOOK_SECRET (set when registering)
// - Tables in Ops base:
//     Telegram Chats    — tblSUmwkCg1opPFEL
//     Telegram Messages — tblz8x1gxPrHE6FUD
//
// Behavior per chat Status:
//   not yet in table  → create row as "Pending Review" + store message
//   "Pending Review"  → store message (so admin can see what they'd be opting into)
//   "Watching"        → store message
//   "Ignored"         → drop, do nothing
//   "Ignored Forever" → drop, do nothing
//
// Telegram retries non-200 responses, so we always return 200 unless the
// secret check fails. Errors past the secret check are logged and swallowed
// to avoid retry storms.

export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { NextResponse } from 'next/server'
import {
  fetchAirtableRecords,
  patchAirtableRecord,
  createAirtableRecord,
} from '@/lib/adminAuth'
import { fetchHqRecords } from '@/lib/hqAirtable'

const CHATS_TABLE = 'Telegram Chats'
const MESSAGES_TABLE = 'Telegram Messages'
const HQ_CREATORS_TABLE = 'Creators'

// Match titles like "PALM x SUNNY", "Palm × Taby", "PALM x Gracey", etc.
// Captures the creator name in group 1. Trailing words (e.g. "PALM x SUNNY VIP")
// are tolerated — we take the first word after the x and look it up.
const PALM_X_PATTERN = /^\s*PALM\s*[x×]\s*([A-Za-z][A-Za-z0-9'’\-]+)/i

// In-memory cache of creator lookups (resets on cold start).
// Avoids hitting HQ Airtable on every message in an established chat.
const creatorCache = new Map() // key: lower-case AKA → { hqId, aka }

async function lookupCreatorByAka(rawName) {
  if (!rawName) return null
  const key = rawName.trim().toLowerCase()
  if (creatorCache.has(key)) return creatorCache.get(key)

  // Try AKA exact match first, then fall back to Creator (full name) starts-with.
  const escaped = key.replace(/'/g, "\\'")
  const formula = `OR(LOWER({AKA}) = '${escaped}', LOWER(LEFT({Creator}, ${key.length})) = '${escaped}')`
  try {
    const records = await fetchHqRecords(HQ_CREATORS_TABLE, {
      filterByFormula: formula,
      maxRecords: 1,
      fields: ['Creator', 'AKA'],
    })
    const r = records[0]
    if (!r) {
      creatorCache.set(key, null)
      return null
    }
    const result = {
      hqId: r.id,
      aka: r.fields?.AKA || r.fields?.Creator || rawName,
    }
    creatorCache.set(key, result)
    return result
  } catch (err) {
    console.error('[telegram-heartbeat] creator lookup failed', err)
    return null // Soft fail — chat still gets created, just without creator mapping
  }
}

// Parse "PALM x SUNNY" → "SUNNY" → look up in HQ Creators → return {hqId, aka}
async function autoMapCreator(chatTitle) {
  if (!chatTitle) return null
  const match = chatTitle.match(PALM_X_PATTERN)
  if (!match) return null
  return lookupCreatorByAka(match[1])
}

// Returns the message object from any Telegram update shape we care about.
// Telegram sends: message, edited_message, channel_post, edited_channel_post.
function extractMessage(update) {
  return (
    update.message ||
    update.edited_message ||
    update.channel_post ||
    update.edited_channel_post ||
    null
  )
}

// Detect media type. Telegram puts each media kind in its own field.
function detectMedia(msg) {
  if (msg.photo) return { hasMedia: true, mediaType: 'photo' }
  if (msg.video) return { hasMedia: true, mediaType: 'video' }
  if (msg.voice) return { hasMedia: true, mediaType: 'voice' }
  if (msg.audio) return { hasMedia: true, mediaType: 'audio' }
  if (msg.document) return { hasMedia: true, mediaType: 'document' }
  if (msg.sticker) return { hasMedia: true, mediaType: 'sticker' }
  if (msg.animation) return { hasMedia: true, mediaType: 'animation' }
  if (msg.video_note || msg.contact || msg.location || msg.poll) {
    return { hasMedia: true, mediaType: 'other' }
  }
  return { hasMedia: false, mediaType: null }
}

function buildSenderName(from) {
  if (!from) return ''
  const parts = [from.first_name, from.last_name].filter(Boolean)
  return parts.join(' ') || from.username || ''
}

// Telegram chat IDs are negative for groups/supergroups/channels and can be
// large negative integers. Airtable singleLineText keys handle this fine as
// strings. Always coerce to string for lookup/storage.
function chatIdString(chat) {
  return String(chat.id)
}

function msgKey(chat, message) {
  return `${chatIdString(chat)}_${message.message_id}`
}

async function findChatRecord(chatIdStr) {
  // Filter by Chat ID (primary field). One record per chat.
  const formula = `{Chat ID} = '${chatIdStr.replace(/'/g, "\\'")}'`
  const records = await fetchAirtableRecords(CHATS_TABLE, {
    filterByFormula: formula,
    maxRecords: 1,
  })
  return records[0] || null
}

async function findMessageRecord(key) {
  const formula = `{Telegram Msg Key} = '${key.replace(/'/g, "\\'")}'`
  const records = await fetchAirtableRecords(MESSAGES_TABLE, {
    filterByFormula: formula,
    maxRecords: 1,
  })
  return records[0] || null
}

// Truncate raw JSON if it's huge (e.g. forwarded media payloads). Airtable
// long text caps around 100k chars; we keep it well under.
function safeRawJson(obj) {
  const json = JSON.stringify(obj)
  if (json.length > 50000) return json.slice(0, 50000) + '...[truncated]'
  return json
}

export async function POST(request) {
  // 1. Verify the secret. Telegram sends our secret back in the
  //    X-Telegram-Bot-Api-Secret-Token header on every webhook call.
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!expectedSecret) {
    console.error('[telegram-heartbeat] TELEGRAM_WEBHOOK_SECRET not set')
    return NextResponse.json({ error: 'misconfigured' }, { status: 500 })
  }
  const incomingSecret = request.headers.get('x-telegram-bot-api-secret-token')
  if (incomingSecret !== expectedSecret) {
    console.warn('[telegram-heartbeat] secret mismatch — rejecting')
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // 2. Parse the update.
  let update
  try {
    update = await request.json()
  } catch (err) {
    console.error('[telegram-heartbeat] bad JSON', err)
    return NextResponse.json({ ok: true }) // 200 to avoid retry storm
  }

  const message = extractMessage(update)
  if (!message || !message.chat) {
    // Other update types (callback_query, my_chat_member, etc.). Nothing to do
    // here — return 200 so Telegram doesn't retry.
    return NextResponse.json({ ok: true })
  }

  const chat = message.chat
  const chatIdStr = chatIdString(chat)
  const isEdit = !!(update.edited_message || update.edited_channel_post)
  const sentAtIso = new Date((message.date || Math.floor(Date.now() / 1000)) * 1000).toISOString()

  try {
    // 3. Look up or create the chat record.
    let chatRecord = await findChatRecord(chatIdStr)

    if (!chatRecord) {
      // Default to Watching + auto-map creator from "PALM x [NAME]" pattern.
      const title = chat.title || chat.username || buildSenderName(chat) || chatIdStr
      const creator = await autoMapCreator(title)
      const created = await createAirtableRecord(CHATS_TABLE, {
        'Chat ID': chatIdStr,
        Title: title,
        Type: chat.type || 'group',
        Source: 'telegram',
        Status: 'Watching',
        'First Seen': sentAtIso,
        'Last Message At': sentAtIso,
        'Message Count': 1,
        ...(creator ? { 'Creator AKA': creator.aka, 'Creator HQ ID': creator.hqId } : {}),
      })
      chatRecord = created
    }

    const status = chatRecord.fields?.Status
    if (status === 'Ignored' || status === 'Ignored Forever') {
      // User opted out. Drop on the floor, don't even bump counters.
      return NextResponse.json({ ok: true, dropped: 'ignored' })
    }

    // 4. Store the message (Watching or Pending Review). Dedupe by key so
    //    Telegram retries don't create dupes.
    const key = msgKey(chat, message)
    const existing = await findMessageRecord(key)

    const text = message.text || message.caption || ''
    const { hasMedia, mediaType } = detectMedia(message)
    const senderName = buildSenderName(message.from)
    const senderUsername = message.from?.username || ''

    const messageFields = {
      'Telegram Msg Key': key,
      Chat: [chatRecord.id], // plain string array — REST API requirement
      'Topic ID': message.message_thread_id ?? null,
      'Sender Name': senderName,
      'Sender Username': senderUsername,
      Text: text,
      'Sent At': sentAtIso,
      'Has Media': hasMedia,
      'Media Type': mediaType,
      'Raw JSON': safeRawJson(update),
    }

    if (existing) {
      // Edit — update text + raw, leave Extracted To Task alone in case the
      // task extractor already ran on the prior version.
      await patchAirtableRecord(MESSAGES_TABLE, existing.id, {
        Text: text,
        'Raw JSON': safeRawJson(update),
      })
    } else {
      await createAirtableRecord(MESSAGES_TABLE, { ...messageFields, Source: 'telegram' })
    }

    // 5. Bump the chat's last-message timestamp + count (skip on edits to
    //    avoid double-counting).
    if (!existing && !isEdit) {
      const currentCount = Number(chatRecord.fields?.['Message Count'] || 0)
      await patchAirtableRecord(CHATS_TABLE, chatRecord.id, {
        'Last Message At': sentAtIso,
        'Message Count': currentCount + 1,
        // Refresh title in case the group was renamed
        ...(chat.title ? { Title: chat.title } : {}),
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    // Log but return 200. Telegram retries are aggressive and will hammer us
    // if we 500 — better to drop one message and investigate via logs.
    console.error('[telegram-heartbeat] handler error', err)
    return NextResponse.json({ ok: true, error: 'logged' })
  }
}

// GET for casual healthcheck (e.g. browser visit). Doesn't expose anything
// sensitive — just confirms the route is alive.
export async function GET() {
  return NextResponse.json({
    service: 'telegram-heartbeat',
    status: 'alive',
    secretConfigured: !!process.env.TELEGRAM_WEBHOOK_SECRET,
  })
}
