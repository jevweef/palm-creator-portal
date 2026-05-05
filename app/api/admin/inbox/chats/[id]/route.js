// Update a single chat's Status (Watch / Ignore / Ignore Forever / Pending Review).
// Used by the [Watch] [Ignore] [Ignore Forever] buttons on /admin/inbox.

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import {
  requireInboxOwner,
  patchAirtableRecord,
  createAirtableRecord,
  fetchAirtableRecords,
} from '@/lib/adminAuth'
import { fetchDaemonChats } from '@/lib/inboxDaemon'
import { extractForChat } from '@/app/api/cron/extract-tasks/route'

const CHATS_TABLE = 'Telegram Chats'

const VALID_STATUSES = new Set([
  'Pending Review',
  'Watching',
  'Ignored',
  'Ignored Forever',
])

const VALID_CATEGORIES = new Set(['Creator', 'Chat Team', 'Internal Palm', 'Personal'])

// For synthetic "daemon:<chatId>" ids: lazily create the Airtable record on
// first PATCH (e.g. user clicks Watch on a chat that's only in chat.db).
// Hydrates title/type/lastMessageAt from the daemon snapshot.
async function ensureDaemonRecord(chatId) {
  // Already exists?
  const existing = await fetchAirtableRecords(CHATS_TABLE, {
    filterByFormula: `AND({Chat ID} = '${chatId.replace(/'/g, "\\'")}', {Source} = 'imessage')`,
    maxRecords: 1,
  })
  if (existing[0]) return existing[0]

  // Look up metadata from the daemon snapshot
  const daemonChats = await fetchDaemonChats(500)
  const meta = daemonChats?.find(c => c.chatId === chatId)
  const nowIso = new Date().toISOString()

  return await createAirtableRecord(CHATS_TABLE, {
    'Chat ID': chatId,
    Title: meta?.title || chatId,
    Type: meta?.type || 'private',
    Source: 'imessage',
    Status: 'Pending Review',
    'First Seen': meta?.lastMessageAt || nowIso,
    'Last Message At': meta?.lastMessageAt || nowIso,
    'Message Count': meta?.messageCount || 0,
  })
}

export async function PATCH(request, { params }) {
  const auth = await requireInboxOwner()
  if (auth instanceof NextResponse) return auth

  const { id } = params
  if (!id) {
    return NextResponse.json({ error: 'missing id' }, { status: 400 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const updates = {}
  if (body.status !== undefined) {
    if (!VALID_STATUSES.has(body.status)) {
      return NextResponse.json(
        { error: `status must be one of: ${[...VALID_STATUSES].join(', ')}` },
        { status: 400 }
      )
    }
    updates.Status = body.status
  }
  if (body.notes !== undefined) {
    updates.Notes = String(body.notes).slice(0, 5000)
  }
  if (body.creatorAka !== undefined) {
    updates['Creator AKA'] = String(body.creatorAka || '')
  }
  if (body.creatorHqId !== undefined) {
    updates['Creator HQ ID'] = String(body.creatorHqId || '')
  }
  if (body.category !== undefined) {
    if (body.category !== '' && !VALID_CATEGORIES.has(body.category)) {
      return NextResponse.json(
        { error: `category must be one of: ${[...VALID_CATEGORIES].join(', ')}` },
        { status: 400 }
      )
    }
    updates.Category = body.category || null
    // Picking 'Personal' auto-flips status to Ignored Forever — semantic
    // alignment, save the user a click. Doesn't fire if they're explicitly
    // changing status in the same PATCH.
    if (body.category === 'Personal' && body.status === undefined) {
      updates.Status = 'Ignored Forever'
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'no updatable fields provided' }, { status: 400 })
  }

  try {
    let recordId = id
    // Synthetic daemon id → ensure Airtable record exists, then PATCH it
    if (id.startsWith('daemon:')) {
      const chatId = id.slice('daemon:'.length)
      const record = await ensureDaemonRecord(chatId)
      recordId = record.id
    } else if (!id.startsWith('rec')) {
      return NextResponse.json({ error: 'invalid record id' }, { status: 400 })
    }

    const updated = await patchAirtableRecord(CHATS_TABLE, recordId, updates)

    // If status was just set to Watching, kick off an immediate extraction
    // for this chat (don't wait for the 5-min cron). This is what makes
    // "click Watch → tasks appear" feel set-and-forget. We pull the full
    // chat record (with new status) and call the per-chat extractor.
    let extracted = null
    if (updates.Status === 'Watching') {
      try {
        const fullChat = await fetchAirtableRecords(CHATS_TABLE, {
          filterByFormula: `RECORD_ID() = '${recordId}'`,
          maxRecords: 1,
        })
        if (fullChat[0]) {
          extracted = await extractForChat(fullChat[0])
        }
      } catch (err) {
        console.warn('[inbox/chats/:id] auto-extract on Watch failed:', err.message)
        extracted = { error: err.message }
      }
    }

    return NextResponse.json({ ok: true, record: updated, recordId, extracted })
  } catch (err) {
    console.error('[inbox/chats/:id] patch error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
