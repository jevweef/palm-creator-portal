// iMessage ingestion endpoint. Called by the Mac daemon (~/palm-imessage-daemon)
// which polls ~/Library/Messages/chat.db every 30s and POSTs new messages here.
//
// Auth: shared secret in the X-Inbox-Secret header against IMESSAGE_INGEST_SECRET.
// Schema: same Telegram Chats / Telegram Messages tables, distinguished by
//         the Source field (telegram | imessage). Composite identity = (Source, Chat ID).
//
// Payload shape (one POST per batch — daemon batches up to N messages per run):
// {
//   messages: [
//     {
//       chatId: "+15551234567" | "iMessage;-;chat123456789..." | etc.
//       chatTitle: "Group Name" | display name | handle
//       chatType: "private" | "group"
//       messageId: "12345"  (rowid from chat.db, stringified)
//       senderHandle: "+15551234567" | "person@example.com" | "" if from me
//       senderName: "Display Name" | ""  (from CNContact lookup if available)
//       text: "..."
//       sentAt: "2026-04-29T18:00:00.000Z"  (ISO)
//       isFromMe: true | false
//       hasMedia: true | false
//       mediaType: "image" | "video" | ...
//     },
//     ...
//   ]
// }

export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import {
  fetchAirtableRecords,
  patchAirtableRecord,
  createAirtableRecord,
} from '@/lib/adminAuth'

const CHATS_TABLE = 'Telegram Chats'
const MESSAGES_TABLE = 'Telegram Messages'

// "Me" sender label for iMessage. The daemon sets isFromMe — we use that to
// label the sender on outbound messages. Hardcoded display values; the AI
// task extractor uses these to recognize "us" via username matching.
const ME_USERNAME = 'jevweef' // matches Telegram username for unified "us" detection
const ME_DISPLAY = 'Evan'

function chatKeyLookup(chatIdStr) {
  const safeId = chatIdStr.replace(/'/g, "\\'")
  return `AND({Chat ID} = '${safeId}', {Source} = 'imessage')`
}

function msgKeyLookup(key) {
  const safeKey = key.replace(/'/g, "\\'")
  return `{Telegram Msg Key} = '${safeKey}'`
}

// Normalize daemon-sent media type strings to the singleSelect options on
// Telegram Messages.Media Type. Daemon sends informal labels ('image' for
// any has_attachments=1) which would error as INVALID_MULTIPLE_CHOICE_OPTIONS.
const MEDIA_TYPE_SYNONYMS = {
  image: 'photo',
  picture: 'photo',
  jpeg: 'photo',
  jpg: 'photo',
  png: 'photo',
  mp4: 'video',
  mov: 'video',
  m4v: 'video',
  m4a: 'audio',
  mp3: 'audio',
  pdf: 'document',
  caf: 'voice',
  amr: 'voice',
  gif: 'animation',
}
const VALID_MEDIA_TYPES = new Set(['photo', 'video', 'voice', 'audio', 'document', 'sticker', 'animation', 'other'])

function normalizeMediaType(raw) {
  if (!raw) return null
  const lower = String(raw).toLowerCase()
  if (VALID_MEDIA_TYPES.has(lower)) return lower
  if (MEDIA_TYPE_SYNONYMS[lower]) return MEDIA_TYPE_SYNONYMS[lower]
  return 'other'
}

function safeRawJson(obj) {
  const json = JSON.stringify(obj)
  if (json.length > 50000) return json.slice(0, 50000) + '...[truncated]'
  return json
}

async function findChatRecord(chatIdStr) {
  const records = await fetchAirtableRecords(CHATS_TABLE, {
    filterByFormula: chatKeyLookup(chatIdStr),
    maxRecords: 1,
  })
  return records[0] || null
}

async function findMessageRecord(key) {
  const records = await fetchAirtableRecords(MESSAGES_TABLE, {
    filterByFormula: msgKeyLookup(key),
    maxRecords: 1,
  })
  return records[0] || null
}

// Process one message — returns {created, skipped, error}.
async function ingestOne(m) {
  if (!m || !m.chatId || !m.messageId) {
    return { error: 'missing chatId or messageId' }
  }

  const chatIdStr = String(m.chatId)
  const sentAtIso = m.sentAt || new Date().toISOString()
  const composite = `imsg:${chatIdStr}_${m.messageId}`

  // Look up or create chat.
  let chatRecord = await findChatRecord(chatIdStr)
  if (!chatRecord) {
    const title = m.chatTitle || m.senderName || m.senderHandle || chatIdStr
    // iMessage default: Pending Review, NOT Watching. Telegram is opt-in by
    // adding the bot to a group (implicit consent). iMessage daemon reads
    // everything by default, so admin must explicitly opt-in per chat to
    // avoid leaking personal chats to AI extraction.
    chatRecord = await createAirtableRecord(CHATS_TABLE, {
      'Chat ID': chatIdStr,
      Title: title,
      Type: m.chatType || 'private',
      Source: 'imessage',
      Status: 'Pending Review',
      'First Seen': sentAtIso,
      'Last Message At': sentAtIso,
      'Message Count': 0, // bumped to 1 by counter logic below
    })
  }

  const status = chatRecord.fields?.Status
  if (status === 'Ignored Forever') {
    // Hard block — drop, don't even bump counters.
    return { skipped: 'ignored-forever' }
  }
  // Pending Review and Ignored: store messages so admin can preview the
  // thread to make a decision. Auto-purge cron deletes them after 14 days
  // unless the chat gets promoted to Watching.
  // Watching: store forever. AI extractor processes them.

  // Dedupe — but backfill text on existing records that don't have it.
  // Catches two cases: (a) privacy-fence-era metadata-only rows, (b) rows
  // stored before the plist text parser was added (where text was empty
  // even though the message had text — fell back to [photo] in UI).
  // Don't bump counters (already counted when row was made).
  const existing = await findMessageRecord(composite)
  if (existing) {
    const hadText = !!(existing.fields?.Text)
    if (!hadText && m.text) {
      await patchAirtableRecord(MESSAGES_TABLE, existing.id, {
        Text: m.text,
        'Raw JSON': safeRawJson(m),
        'Has Media': !!m.hasMedia,
        'Media Type': normalizeMediaType(m.mediaType),
      })
      return { updated: true }
    }
    return { skipped: 'duplicate' }
  }

  // Sender labelling. From-me messages get our unified "us" username so the
  // task extractor recognizes them as Evan.
  const senderUsername = m.isFromMe ? ME_USERNAME : (m.senderHandle || '')
  const senderName = m.isFromMe ? ME_DISPLAY : (m.senderName || m.senderHandle || '')

  await createAirtableRecord(MESSAGES_TABLE, {
    'Telegram Msg Key': composite,
    Source: 'imessage',
    Chat: [chatRecord.id],
    'Sender Name': senderName,
    'Sender Username': senderUsername,
    Text: m.text || '',
    'Sent At': sentAtIso,
    'Has Media': !!m.hasMedia,
    'Media Type': normalizeMediaType(m.mediaType),
    'Raw JSON': safeRawJson(m),
  })

  // Bump chat counters.
  const currentCount = Number(chatRecord.fields?.['Message Count'] || 0)
  await patchAirtableRecord(CHATS_TABLE, chatRecord.id, {
    'Last Message At': sentAtIso,
    'Message Count': currentCount + 1,
    ...(m.chatTitle ? { Title: m.chatTitle } : {}),
  })

  return { created: true }
}

export async function POST(request) {
  // 1. Secret.
  const expected = process.env.IMESSAGE_INGEST_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'IMESSAGE_INGEST_SECRET not set' }, { status: 500 })
  }
  const incoming = request.headers.get('x-inbox-secret')
  if (incoming !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // 2. Parse.
  let body
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const messages = Array.isArray(body?.messages) ? body.messages : []
  if (messages.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 })
  }
  if (messages.length > 200) {
    return NextResponse.json({ error: 'batch too large (max 200)' }, { status: 413 })
  }

  // 3. Process serially. Most batches are small. Parallel writes to Airtable
  //    cause rate-limit pain (5 req/s per base) and we'd have to throttle anyway.
  const stats = { received: messages.length, created: 0, skipped: 0, errors: [] }
  for (const m of messages) {
    try {
      const r = await ingestOne(m)
      if (r.created) stats.created++
      else if (r.skipped) stats.skipped++
      else if (r.error) stats.errors.push(r.error)
    } catch (err) {
      stats.errors.push(err.message)
    }
  }

  return NextResponse.json({ ok: true, stats })
}

export async function GET() {
  return NextResponse.json({
    service: 'imessage-ingest',
    status: 'alive',
    secretConfigured: !!process.env.IMESSAGE_INGEST_SECRET,
  })
}
