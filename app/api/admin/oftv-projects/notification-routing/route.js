import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import {
  fetchCreatorContact,
  resolveCreatorChat,
  buildCreatorMessage,
} from '@/lib/oftvCreatorMessaging'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const OPS_BASE = 'applLIT2t83plMqNx'
const CREATORS_TABLE = 'tbls2so6pHGbU4Uhh'

// "Where would the OFTV notification go?" preview for every creator.
// Resolves each creator through the same logic the actual notify call
// uses, so what you see here is exactly what would land on the next
// real send.
//
// Returns one row per creator with:
//   - resolved chat: title, source, status, override?
//   - preview text: what would actually be sent for the most likely event
//   - issues array: empty if good-to-go, otherwise lists what's missing
//     (no HQ id, no watched chat, etc.) so you know what to fix
//
// Pass ?creatorOpsId=recXXX to scope to one creator (faster).
export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }

  const { searchParams } = new URL(request.url)
  const single = searchParams.get('creatorOpsId')

  let creators
  try {
    creators = await fetchAirtableRecords(CREATORS_TABLE, {
      // Only show creators we care about routing for — anyone with an
      // active management status. Filter loose here, callers can scope
      // to a single creator with the param above.
      filterByFormula: '{Status}!=BLANK()',
      fields: ['AKA', 'Communication Name', 'Status', 'HQ Record ID', 'Communication Chat'],
    })
  } catch (err) {
    return NextResponse.json({ error: 'Airtable fetch failed', detail: err.message }, { status: 500 })
  }

  const filtered = single
    ? creators.filter(c => c.id === single)
    : creators

  // Resolve each creator's routing in parallel — many will skip out
  // immediately on missing HQ id / no watched chat, so this is cheap.
  const rows = await Promise.all(filtered.map(async (rec) => {
    const f = rec.fields || {}
    const contact = await fetchCreatorContact(rec.id)
    const chat = await resolveCreatorChat(contact)

    const issues = []
    if (!contact.hqId && !contact.overrideChatRecId) issues.push('no HQ Record ID')
    if (contact.hqId && !chat) issues.push('no watched iMessage chat for this creator')
    if (chat && chat.source !== 'imessage') issues.push(`override chat source is ${chat.source}, not imessage — daemon only sends iMessage`)
    if (chat && chat.status !== 'Watching' && !chat.isOverride) issues.push(`chat status is ${chat.status}, not Watching`)

    // Preview the actual message so user can eyeball it. Use first-cut
    // wording since that's the most common send path.
    const previewText = buildCreatorMessage({
      event: 'admin_approved',
      creatorOpsId: rec.id,
      projectId: 'recPLACEHOLDER1234',
      projectName: '{Project Name}',
      contact,
      isFirstDraft: true,
    })

    return {
      creatorOpsId: rec.id,
      aka: contact.aka,
      communicationName: contact.name,
      status: f['Status'] || null,
      hqId: contact.hqId,
      hasOverride: !!contact.overrideChatRecId,
      chat: chat ? {
        title: chat.title,
        source: chat.source,
        status: chat.status,
        chatId: chat.chatId,
        isOverride: chat.isOverride,
      } : null,
      previewText,
      issues,
      readyToSend: issues.length === 0 && !!chat?.chatId,
    }
  }))

  // Sort: ready creators first, then those with issues last.
  rows.sort((a, b) => {
    if (a.readyToSend !== b.readyToSend) return a.readyToSend ? -1 : 1
    return (a.aka || '').localeCompare(b.aka || '')
  })

  return NextResponse.json({
    ok: true,
    count: rows.length,
    readyCount: rows.filter(r => r.readyToSend).length,
    rows,
  })
}
