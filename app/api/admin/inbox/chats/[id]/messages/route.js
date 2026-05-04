// Returns messages for a single chat, newest-last (chat order). Used by the
// thread pane in /admin/inbox to show iMessage-style bubbles.

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireInboxOwner, fetchAirtableRecords } from '@/lib/adminAuth'

const MESSAGES_TABLE = 'Telegram Messages'

const US_USERNAMES = new Set(['jevweef'])

export async function GET(request, { params }) {
  const auth = await requireInboxOwner()
  if (auth instanceof NextResponse) return auth

  const { id: chatRecordId } = params
  if (!chatRecordId || !chatRecordId.startsWith('rec')) {
    return NextResponse.json({ error: 'invalid chat id' }, { status: 400 })
  }

  const url = new URL(request.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 300)

  try {
    // Filter by linked Chat record. Airtable formula trick: SEARCH against
    // the rendered linked record id won't work directly; use FIND on the
    // Chat field's text representation. The Chat field renders as the
    // primary field of the linked record (Chat ID), so we use the chat's
    // record id via a different approach: filter all messages and let the
    // server sort. For better perf, we'd add a denormalized chat record id
    // text field, but for v1 this is fine — messages per chat are bounded.
    //
    // Alternative we use here: pull messages where the linked Chat field
    // contains this record id. Airtable doesn't expose record ids in
    // formulas directly, so we iterate.
    const records = await fetchAirtableRecords(MESSAGES_TABLE, {
      // No filter — paginate, then filter client-side. For volumes <10k
      // messages this is fine. We'll add a denormalized field later if needed.
      sort: [{ field: 'Sent At', direction: 'desc' }],
      maxRecords: 1000,
    })

    const filtered = records
      .filter(r => (r.fields?.Chat || []).includes(chatRecordId))
      .slice(0, limit)
      .reverse() // chronological for display

    const messages = filtered.map(r => {
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
    })

    return NextResponse.json({ messages, total: messages.length })
  } catch (err) {
    console.error('[inbox/chats/:id/messages] error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
