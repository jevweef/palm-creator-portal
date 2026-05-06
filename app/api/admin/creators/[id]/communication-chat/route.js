import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { fetchCreatorContact, resolveCreatorChat } from '@/lib/oftvCreatorMessaging'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const CREATORS_TABLE = 'tbls2so6pHGbU4Uhh'

// GET — list every chat already linked to this creator (any source / status),
// plus the currently-resolved master chat. Powers the "Communication Chat"
// modal in /admin/creators where Josh confirms which chat is the master
// for portal automations (OFTV deliveries, inspo digests, etc.).
//
// PATCH — set the Communication Chat link on the creator's Ops record.
//   Body: { chatRecordId: string | null }   (null clears the override)
export async function GET(_request, { params }) {
  try { await requireAdmin() } catch (e) { return e }
  const { id } = params
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const contact = await fetchCreatorContact(id)
  if (!contact.hqId) {
    return NextResponse.json({
      ok: true,
      contact,
      chats: [],
      resolvedChat: null,
      note: 'Creator has no HQ Record ID — no chats can be matched. Run the inbox heartbeat sync.',
    })
  }

  // Pull every chat row that mentions this creator's HQ id, regardless of
  // source/status. Show all so admin can see context (some Telegram, some
  // iMessage, some still in Pending Review etc.).
  let chats = []
  try {
    chats = await fetchAirtableRecords('Telegram Chats', {
      filterByFormula: `FIND('${contact.hqId}', {Creator HQ ID})`,
      fields: ['Title', 'Chat ID', 'Source', 'Status', 'Type', 'Last Message At', 'Message Count', 'Creator AKA'],
    })
  } catch (err) {
    return NextResponse.json({ error: 'Airtable fetch failed', detail: err.message }, { status: 500 })
  }

  const resolvedChat = await resolveCreatorChat(contact)

  return NextResponse.json({
    ok: true,
    creatorOpsId: id,
    contact,
    overrideChatRecId: contact.overrideChatRecId,
    resolvedChat,
    chats: chats.map(c => ({
      recordId: c.id,
      title: c.fields?.['Title'] || '',
      chatId: c.fields?.['Chat ID'] || '',
      source: c.fields?.['Source'] || '',
      status: c.fields?.['Status'] || '',
      type: c.fields?.['Type'] || '',
      lastMessageAt: c.fields?.['Last Message At'] || null,
      messageCount: c.fields?.['Message Count'] || 0,
      isCurrentMaster: c.id === contact.overrideChatRecId,
    })).sort((a, b) => {
      // Master first, then iMessage Watching, then everything else
      if (a.isCurrentMaster !== b.isCurrentMaster) return a.isCurrentMaster ? -1 : 1
      const aRank = (a.source === 'imessage' ? 0 : 1) + (a.status === 'Watching' ? 0 : 2)
      const bRank = (b.source === 'imessage' ? 0 : 1) + (b.status === 'Watching' ? 0 : 2)
      if (aRank !== bRank) return aRank - bRank
      return (b.lastMessageAt || '').localeCompare(a.lastMessageAt || '')
    }),
  })
}

export async function PATCH(request, { params }) {
  try { await requireAdmin() } catch (e) { return e }
  const { id } = params
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  let body = {}
  try { body = await request.json() } catch {}
  const chatRecordId = body.chatRecordId || null

  if (chatRecordId && !/^rec[A-Za-z0-9]{14}$/.test(chatRecordId)) {
    return NextResponse.json({ error: 'Invalid chatRecordId' }, { status: 400 })
  }

  const fields = {
    'Communication Chat': chatRecordId ? [chatRecordId] : [],
  }
  const res = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${CREATORS_TABLE}/${id}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    }
  )
  if (!res.ok) {
    return NextResponse.json({ error: 'Airtable patch failed', detail: await res.text() }, { status: 500 })
  }
  return NextResponse.json({ ok: true, chatRecordId })
}
