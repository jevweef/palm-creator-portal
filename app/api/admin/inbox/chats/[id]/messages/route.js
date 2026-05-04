// Returns messages for a single chat. Two paths:
//   1. Synthetic id "daemon:<chatId>" → fetch directly from daemon (chat
//      isn't in Airtable yet, no records to read).
//   2. Real Airtable record id (rec...) → look up the chat record. If
//      Watching, read from Airtable Messages (those are the persisted ones).
//      Otherwise, fetch from daemon by the chat's Chat ID.
//
// Daemon fallback keeps the local-first model: nothing is in Airtable
// until the user explicitly Watches a chat.

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireInboxOwner, fetchAirtableRecords } from '@/lib/adminAuth'
import { fetchDaemonMessages } from '@/lib/inboxDaemon'

const CHATS_TABLE = 'Telegram Chats'
const MESSAGES_TABLE = 'Telegram Messages'
const US_USERNAMES = new Set(['jevweef'])

function shapeAirtableMessage(r) {
  const username = (r.fields?.['Sender Username'] || '').toLowerCase()
  return {
    id: r.id,
    msgKey: r.fields?.['Telegram Msg Key'] || '',
    text: r.fields?.Text || '',
    senderName: r.fields?.['Sender Name'] || '',
    senderUsername: r.fields?.['Sender Username'] || '',
    sentAt: r.fields?.['Sent At'] || null,
    hasMedia: !!r.fields?.['Has Media'],
    mediaType: r.fields?.['Media Type'] || null,
    source: r.fields?.['Source'] || 'telegram',
    isFromMe: US_USERNAMES.has(username),
  }
}

function shapeDaemonMessage(d) {
  return {
    id: d.messageKey,
    msgKey: d.messageKey,
    text: d.text || '',
    senderName: d.senderName || '',
    senderUsername: d.senderHandle || '',
    sentAt: d.sentAt,
    hasMedia: !!d.hasMedia,
    mediaType: d.mediaType,
    source: 'imessage',
    isFromMe: !!d.isFromMe,
  }
}

export async function GET(request, { params }) {
  const auth = await requireInboxOwner()
  if (auth instanceof NextResponse) return auth

  const { id } = params
  const url = new URL(request.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200'), 500)

  // Synthetic daemon id: "daemon:<chatId>" — chat isn't in Airtable
  if (id?.startsWith('daemon:')) {
    const chatId = id.slice('daemon:'.length)
    const dmsgs = await fetchDaemonMessages(chatId, limit)
    if (dmsgs == null) {
      return NextResponse.json({ error: 'daemon unreachable', messages: [] }, { status: 502 })
    }
    return NextResponse.json({
      messages: dmsgs.map(shapeDaemonMessage),
      total: dmsgs.length,
      source: 'daemon',
    })
  }

  if (!id?.startsWith('rec')) {
    return NextResponse.json({ error: 'invalid chat id' }, { status: 400 })
  }

  // Real Airtable record. Look it up to know status + source + chatId.
  let chatRecord
  try {
    const records = await fetchAirtableRecords(CHATS_TABLE, {
      filterByFormula: `RECORD_ID() = '${id}'`,
      maxRecords: 1,
    })
    chatRecord = records[0]
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
  if (!chatRecord) {
    return NextResponse.json({ error: 'chat not found' }, { status: 404 })
  }

  const status = chatRecord.fields?.Status
  const source = chatRecord.fields?.Source || 'telegram'
  const chatIdentifier = chatRecord.fields?.['Chat ID']

  // For Watching chats OR Telegram (always Airtable-backed): use Airtable.
  if (status === 'Watching' || source === 'telegram') {
    try {
      const records = await fetchAirtableRecords(MESSAGES_TABLE, {
        sort: [{ field: 'Sent At', direction: 'desc' }],
        maxRecords: 1000,
      })
      const filtered = records
        .filter(r => (r.fields?.Chat || []).includes(id))
        .slice(0, limit)
        .reverse()
      return NextResponse.json({
        messages: filtered.map(shapeAirtableMessage),
        total: filtered.length,
        source: 'airtable',
      })
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: 500 })
    }
  }

  // iMessage + not Watching → daemon
  const dmsgs = await fetchDaemonMessages(chatIdentifier, limit)
  if (dmsgs == null) {
    return NextResponse.json({
      messages: [],
      source: 'daemon',
      error: 'daemon unreachable — Mac may be asleep or tunnel down',
    }, { status: 200 })  // 200 with empty list — UI handles gracefully
  }
  return NextResponse.json({
    messages: dmsgs.map(shapeDaemonMessage),
    total: dmsgs.length,
    source: 'daemon',
  })
}
