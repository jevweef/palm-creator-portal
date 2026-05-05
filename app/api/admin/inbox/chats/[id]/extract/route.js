// Force-extract tasks for a single chat right now, bypassing all cooldown/
// idle/business-filter gates. Used by the inbox UI's Refresh button and by
// any manual nudge (curl-able).
//
// POST /api/admin/inbox/chats/[id]/extract
// Returns { ok, stats } with same shape as extractForChat() result.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { requireInboxOwner, fetchAirtableRecords } from '@/lib/adminAuth'
import { extractForChat } from '@/app/api/cron/extract-tasks/route'

const CHATS_TABLE = 'Telegram Chats'

export async function POST(_request, { params }) {
  const auth = await requireInboxOwner()
  if (auth instanceof NextResponse) return auth

  const { id } = params
  if (!id || !id.startsWith('rec')) {
    return NextResponse.json({ error: 'invalid record id' }, { status: 400 })
  }

  try {
    const records = await fetchAirtableRecords(CHATS_TABLE, {
      filterByFormula: `RECORD_ID() = '${id}'`,
      maxRecords: 1,
    })
    const chat = records[0]
    if (!chat) {
      return NextResponse.json({ error: 'chat not found' }, { status: 404 })
    }

    const stats = await extractForChat(chat, { force: true })
    return NextResponse.json({ ok: true, stats })
  } catch (err) {
    console.error('[inbox/chats/:id/extract] error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
