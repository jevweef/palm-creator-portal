// Lists all Telegram chats in the heartbeat, with their status + activity.
// Used by /admin/inbox to render the Pending / Watching / Ignored sections.

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'

const CHATS_TABLE = 'Telegram Chats'

export async function GET() {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  try {
    const records = await fetchAirtableRecords(CHATS_TABLE, {
      sort: [{ field: 'Last Message At', direction: 'desc' }],
    })

    const chats = records.map(r => ({
      id: r.id,
      chatId: r.fields?.['Chat ID'] || '',
      title: r.fields?.['Title'] || '(untitled)',
      type: r.fields?.['Type'] || 'group',
      status: r.fields?.['Status'] || 'Pending Review',
      firstSeen: r.fields?.['First Seen'] || null,
      lastMessageAt: r.fields?.['Last Message At'] || null,
      messageCount: r.fields?.['Message Count'] || 0,
      notes: r.fields?.['Notes'] || '',
    }))

    return NextResponse.json({ chats })
  } catch (err) {
    console.error('[inbox/chats] list error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
