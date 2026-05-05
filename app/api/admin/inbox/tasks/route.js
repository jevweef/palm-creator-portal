// List tasks extracted from inbox conversations. Default scope: open tasks
// only, newest first. Supports ?status=Done|Snoozed|Dismissed|Open|all and
// ?owner=Evan|Josh|Other for filtering.

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireInboxOwner, fetchAirtableRecords } from '@/lib/adminAuth'
import { fetchDaemonChats } from '@/lib/inboxDaemon'

const TASKS_TABLE = 'Inbox Tasks'

export async function GET(request) {
  const auth = await requireInboxOwner()
  if (auth instanceof NextResponse) return auth

  const url = new URL(request.url)
  const status = url.searchParams.get('status') || 'Open'
  const owner = url.searchParams.get('owner') || null
  const creator = url.searchParams.get('creator') || null
  const urgency = url.searchParams.get('urgency') || null
  // Pass ?showDeferred=true to include tasks whose Defer Until is in the future
  const showDeferred = url.searchParams.get('showDeferred') === 'true'
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200'), 500)

  const esc = (s) => String(s).replace(/'/g, "\\'")
  const filters = []
  if (status !== 'all') filters.push(`{Status} = '${esc(status)}'`)
  if (owner) filters.push(`{Owner} = '${esc(owner)}'`)
  if (creator) filters.push(`{Creator AKA} = '${esc(creator)}'`)
  if (urgency) filters.push(`{Urgency} = '${esc(urgency)}'`)
  // Hide deferred tasks unless explicitly requested. A task is deferred if
  // its Defer Until > now. Empty Defer Until = surface immediately.
  if (!showDeferred) {
    filters.push(`OR({Defer Until} = BLANK(), IS_BEFORE({Defer Until}, NOW()))`)
  }
  const formula = filters.length === 0 ? undefined : (filters.length === 1 ? filters[0] : `AND(${filters.join(',')})`)

  try {
    const records = await fetchAirtableRecords(TASKS_TABLE, {
      filterByFormula: formula,
      sort: [{ field: 'Detected At', direction: 'desc' }],
      maxRecords: limit,
    })

    // Enrich with chat metadata so cards show source / chat name / type
    // without making the UI fetch separately. Only fetch unique chat ids.
    const uniqueChatIds = [...new Set(records.flatMap(r => r.fields?.['Source Chat'] || []))]
    const chatMetaById = new Map()
    if (uniqueChatIds.length > 0) {
      const chunks = []
      for (let i = 0; i < uniqueChatIds.length; i += 50) chunks.push(uniqueChatIds.slice(i, i + 50))
      for (const chunk of chunks) {
        const formula = chunk.length === 1
          ? `RECORD_ID() = '${chunk[0]}'`
          : `OR(${chunk.map(id => `RECORD_ID() = '${id}'`).join(',')})`
        try {
          const chats = await fetchAirtableRecords('Telegram Chats', {
            filterByFormula: formula,
            fields: ['Title', 'Source', 'Type', 'Creator AKA', 'Chat ID'],
          })
          for (const c of chats) {
            chatMetaById.set(c.id, {
              chatId: c.fields?.['Chat ID'] || '',
              title: c.fields?.Title || '(untitled)',
              source: c.fields?.Source || 'telegram',
              type: c.fields?.Type || 'group',
              creatorAka: c.fields?.['Creator AKA'] || '',
            })
          }
        } catch {}
      }
    }

    // For iMessage chats whose stored Title is just a phone number, look up
    // the contact-resolved name from the daemon (which has access to macOS
    // Contacts). One daemon call covers all iMessage chats.
    const needsResolve = [...chatMetaById.values()].some(
      m => m.source === 'imessage' && /^\+?\d{10,}$/.test(m.title.replace(/[\s()-]/g, ''))
    )
    if (needsResolve) {
      try {
        const daemonChats = await fetchDaemonChats(500)
        if (daemonChats) {
          const daemonByChatId = new Map(daemonChats.map(d => [d.chatId, d]))
          for (const meta of chatMetaById.values()) {
            if (meta.source !== 'imessage') continue
            const d = daemonByChatId.get(meta.chatId)
            if (d?.title && d.title !== meta.chatId) meta.title = d.title
          }
        }
      } catch {}
    }

    const tasks = records.map(r => {
      const chatId = (r.fields?.['Source Chat'] || [])[0]
      const chat = chatMetaById.get(chatId) || null
      return {
        id: r.id,
        task: r.fields?.Task || '',
        status: r.fields?.Status || 'Open',
        owner: r.fields?.Owner || 'Other',
        doerName: r.fields?.['Doer Name'] || '',
        ownerUsername: r.fields?.['Owner Username'] || '',
        creatorAka: r.fields?.['Creator AKA'] || '',
        sourceQuote: r.fields?.['Source Quote'] || '',
        sourceChatIds: r.fields?.['Source Chat'] || [],
        chatSource: chat?.source || null,
        chatTitle: chat?.title || null,
        chatType: chat?.type || null, // 'private' | 'group' | 'supergroup' | 'channel'
        urgency: r.fields?.Urgency || 'Soon',
        confidence: r.fields?.['AI Confidence'] || null,
        detectedAt: r.fields?.['Detected At'] || null,
        sourceSentAt: r.fields?.['Source Sent At'] || null,
        deferUntil: r.fields?.['Defer Until'] || null,
        notes: r.fields?.Notes || '',
      }
    })

    return NextResponse.json({ tasks })
  } catch (err) {
    console.error('[inbox/tasks] list error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
