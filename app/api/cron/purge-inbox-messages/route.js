// Daily cron — deletes message bodies from non-Watching chats older than
// PURGE_DAYS. Privacy guardrail: gives admin a window to triage Pending
// Review chats, but auto-cleans up so personal messages don't accumulate
// indefinitely.
//
// Watching chats: NEVER purged.
// Pending Review / Ignored / Ignored Forever: purged after PURGE_DAYS.
//
// The chat record itself stays (so opt-in/out history is preserved) — only
// the message rows go.

export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { fetchAirtableRecords, OPS_BASE, airtableHeaders } from '@/lib/adminAuth'

const CHATS_TABLE = 'Telegram Chats'
const MESSAGES_TABLE = 'Telegram Messages'
const PURGE_DAYS = 14

async function deleteRecordsBatch(table, ids) {
  if (ids.length === 0) return 0
  let deleted = 0
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10)
    const params = new URLSearchParams()
    chunk.forEach(id => params.append('records[]', id))
    const res = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(table)}?${params}`,
      { method: 'DELETE', headers: airtableHeaders }
    )
    if (!res.ok) {
      const text = await res.text()
      console.error(`[purge] delete chunk failed: ${res.status} ${text}`)
      continue
    }
    const data = await res.json()
    deleted += (data.records || []).length
  }
  return deleted
}

export async function POST(request) { return GET(request) }

export async function GET(request) {
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  if (expectedAuth) {
    const actual = request.headers.get('authorization')
    if (actual !== expectedAuth) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  const cutoff = new Date(Date.now() - PURGE_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const stats = { eligibleChats: 0, messagesDeleted: 0, errors: [] }

  try {
    // 1. Find all chats NOT in Watching status. We'll purge old messages
    //    linked to these.
    const chats = await fetchAirtableRecords(CHATS_TABLE, {
      filterByFormula: `{Status} != 'Watching'`,
      fields: ['Status'],
    })
    stats.eligibleChats = chats.length
    if (chats.length === 0) {
      return NextResponse.json({ ok: true, idle: true, stats })
    }

    const chatIds = new Set(chats.map(c => c.id))

    // 2. Find old messages. Pull a batch sorted oldest-first, filter by
    //    chat membership.
    const oldMessages = await fetchAirtableRecords(MESSAGES_TABLE, {
      filterByFormula: `IS_BEFORE({Sent At}, '${cutoff}')`,
      sort: [{ field: 'Sent At', direction: 'asc' }],
      maxRecords: 1000,
    })

    const toDelete = oldMessages
      .filter(m => {
        const chatId = m.fields?.Chat?.[0]
        return chatId && chatIds.has(chatId)
      })
      .map(m => m.id)

    stats.messagesDeleted = await deleteRecordsBatch(MESSAGES_TABLE, toDelete)

    return NextResponse.json({ ok: true, stats, cutoff })
  } catch (err) {
    console.error('[purge-inbox-messages] fatal', err)
    return NextResponse.json({ error: err.message, stats }, { status: 500 })
  }
}
