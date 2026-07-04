import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, downloadFromDropbox } from '@/lib/dropbox'

export const dynamic = 'force-dynamic'

// GET — data for /admin/live-chat (OF-style two-pane view).
//   ?account=acct_…            → conversation list: archived fans (the ones
//                                we pulled 2-year histories for) + any fan
//                                with live webhook events, plus the live buffer
//   ?account=…&fan=<username>  → that fan's thread: archive tail (last 120)
//                                merged with live events
export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const url = new URL(request.url)
    const account = url.searchParams.get('account') || ''
    const fan = url.searchParams.get('fan') || ''
    const liveOnly = url.searchParams.get('liveOnly') === '1'

    const creators = await fetchAirtableRecords('Palm Creators', {
      fields: ['Creator', 'AKA', 'OF API Account ID'],
    })
    const accounts = creators
      .filter((c) => c.fields?.['OF API Account ID'])
      .map((c) => ({ account: c.fields['OF API Account ID'], aka: c.fields.AKA || c.fields.Creator, name: c.fields.Creator || c.fields.AKA }))
      .sort((a, b) => a.aka.localeCompare(b.aka))

    if (!account) return NextResponse.json({ accounts })

    const meta = accounts.find((a) => a.account === account)
    const safeCreator = String(meta?.name || '').replace(/[^a-zA-Z0-9_-]/g, '_')

    const token = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(token)

    // Live buffer (always)
    let live = []
    try {
      const buf = await downloadFromDropbox(token, ns, `/Palm Ops/OF Webhooks/live/${account}.json`)
      if (buf) live = JSON.parse(buf.toString('utf8'))
    } catch { /* none yet */ }

    if (liveOnly) return NextResponse.json({ live })

    if (fan) {
      // Thread: archive tail + live events for this fan
      let history = []
      try {
        const buf = await downloadFromDropbox(token, ns, `/Palm Ops/Chat Logs/${safeCreator}/${fan}/messages.json`)
        if (buf) {
          const arc = JSON.parse(buf.toString('utf8'))
          const fanId = String(arc.fanId || '')
          history = (arc.messages || []).slice(-120).map((m) => ({
            id: m.id,
            dir: (m.isSentByMe === true || String(m?.fromUser?.id ?? '') !== fanId) ? 'out' : 'in',
            at: m.createdAt || null,
            text: String(m.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600),
            price: m.price || 0,
            bought: !!m.isOpened,
            mass: !!m.isFromQueue,
            media: m.mediaCount ?? (Array.isArray(m.media) ? m.media.length : 0),
          }))
        }
      } catch { /* no archive for this fan */ }
      const liveForFan = live.filter((e) => (e.fan?.username || e.fan?.name || '') === fan)
      return NextResponse.json({ history, live: liveForFan })
    }

    // Conversation list: archived fans + live-active fans
    const conv = new Map()
    try {
      const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
          'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'namespace_id', namespace_id: ns }),
        },
        body: JSON.stringify({ path: `/Palm Ops/Chat Logs/${safeCreator}` }),
      })
      if (res.ok) {
        const d = await res.json()
        for (const e of d.entries || []) {
          if (e['.tag'] === 'folder') conv.set(e.name, { fan: e.name, name: e.name, archived: true, lastAt: null, lastText: '' })
        }
      }
    } catch { /* no archives yet */ }
    for (const e of live) {
      const key = e.fan?.username || e.fan?.name || ''
      if (!key) continue
      const cur = conv.get(key) || { fan: key, name: e.fan?.name || key, archived: false, lastAt: null, lastText: '' }
      if (!cur.lastAt || (e.at && e.at > cur.lastAt)) {
        cur.lastAt = e.at
        cur.lastText = e.dir === 'unlock' ? `💸 unlocked $${e.price}` : (e.text || '(media)').slice(0, 60)
        cur.name = e.fan?.name || cur.name
      }
      conv.set(key, cur)
    }
    const conversations = [...conv.values()].sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || '') || a.fan.localeCompare(b.fan))
    return NextResponse.json({ accounts, conversations, live })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
