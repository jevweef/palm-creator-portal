// Returns the chat list for /admin/inbox. Merges two sources:
//   1. Airtable (Telegram Chats table) — has the user's status + creator
//      mapping for any chat that's been opted into Watching/Ignored.
//   2. Daemon (live chat.db on the user's Mac) — has every iMessage chat
//      with the latest snippet. Used for browsing before opting in.
//
// Behavior: every iMessage chat the daemon reports is a row in the response.
// Airtable status/creator overlays it when present. Telegram chats come
// from Airtable only (the bot's the source of truth there).

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireInboxOwner, fetchAirtableRecords } from '@/lib/adminAuth'
import { fetchDaemonChats, isDaemonConfigured } from '@/lib/inboxDaemon'

const CHATS_TABLE = 'Telegram Chats'

export async function GET() {
  const auth = await requireInboxOwner()
  if (auth instanceof NextResponse) return auth

  try {
    const [airtableRecords, daemonChats] = await Promise.all([
      fetchAirtableRecords(CHATS_TABLE, {
        sort: [{ field: 'Last Message At', direction: 'desc' }],
      }),
      isDaemonConfigured() ? fetchDaemonChats(300) : Promise.resolve(null),
    ])

    // Index Airtable chats by composite key (source + chat id) for overlay lookup
    const airtableByKey = new Map()
    for (const r of airtableRecords) {
      const key = `${r.fields?.Source || 'telegram'}::${r.fields?.['Chat ID'] || ''}`
      airtableByKey.set(key, r)
    }

    // Build merged chat list
    const merged = []
    const seenKeys = new Set()

    // Pass 1: every daemon chat (iMessage) — overlay Airtable status if present
    if (daemonChats) {
      for (const d of daemonChats) {
        const key = `imessage::${d.chatId}`
        seenKeys.add(key)
        const a = airtableByKey.get(key)
        merged.push({
          id: a?.id || `daemon:${d.chatId}`, // synthetic id for un-tracked chats
          chatId: d.chatId,
          title: d.title || d.chatId,
          type: d.type,
          source: 'imessage',
          status: a?.fields?.['Status'] || 'Pending Review',
          firstSeen: a?.fields?.['First Seen'] || d.lastMessageAt,
          lastMessageAt: d.lastMessageAt,
          messageCount: d.messageCount,
          creatorAka: a?.fields?.['Creator AKA'] || '',
          creatorHqId: a?.fields?.['Creator HQ ID'] || '',
          category: a?.fields?.['Category'] || '',
          notes: a?.fields?.['Notes'] || '',
          lastMessageSnippet: d.lastMessageSnippet || '',
          isFromMeLast: !!d.isFromMeLast,
          inAirtable: !!a,
        })
      }
    }

    // Pass 2: every Airtable chat we haven't already covered (Telegram, or
    // iMessage chats that the daemon didn't return — e.g. older than its window)
    for (const r of airtableRecords) {
      const source = r.fields?.['Source'] || 'telegram'
      const key = `${source}::${r.fields?.['Chat ID'] || ''}`
      if (seenKeys.has(key)) continue
      merged.push({
        id: r.id,
        chatId: r.fields?.['Chat ID'] || '',
        title: r.fields?.['Title'] || '(untitled)',
        type: r.fields?.['Type'] || 'group',
        source,
        status: r.fields?.['Status'] || 'Pending Review',
        firstSeen: r.fields?.['First Seen'] || null,
        lastMessageAt: r.fields?.['Last Message At'] || null,
        messageCount: r.fields?.['Message Count'] || 0,
        creatorAka: r.fields?.['Creator AKA'] || '',
        creatorHqId: r.fields?.['Creator HQ ID'] || '',
        category: r.fields?.['Category'] || '',
        notes: r.fields?.['Notes'] || '',
        lastMessageSnippet: '',
        isFromMeLast: false,
        inAirtable: true,
      })
    }

    // Sort by lastMessageAt desc
    merged.sort((a, b) => {
      const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
      const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
      return tb - ta
    })

    return NextResponse.json({
      chats: merged,
      sources: {
        airtable: airtableRecords.length,
        daemon: daemonChats?.length ?? 0,
        daemonReachable: !!daemonChats,
      },
    })
  } catch (err) {
    console.error('[inbox/chats] list error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
