import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, downloadFromDropbox, uploadToDropbox } from '@/lib/dropbox'
import { readLiveMerged } from '@/lib/ofLiveBuffer'

export const dynamic = 'force-dynamic'

// Conversation-list preview cache (per account) — archives are chunky files;
// don't re-download them on every list load.
const CONV_CACHE = new Map() // account -> { at, conversations }

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

    // Live buffer (always) — merges any pending event files (race-proof)
    let live = []
    try { live = await readLiveMerged(account) } catch { /* none yet */ }

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
      // Fallback: fans from the manual-analysis era have transcripts but no
      // structured archive — show the transcript so the pane isn't empty.
      let transcript = null
      if (!history.length) {
        for (const fname of ['transcript.txt', 'transcript-free.txt', 'transcript-vip.txt']) {
          try {
            const tbuf = await downloadFromDropbox(token, ns, `/Palm Ops/Chat Logs/${safeCreator}/${fan}/${fname}`)
            if (tbuf) { transcript = tbuf.toString('utf8').slice(-15000); break }
          } catch { /* try next */ }
        }
      }
      const liveForFan = live.filter((e) => (e.fan?.username || e.fan?.name || '') === fan)
      return NextResponse.json({ history, live: liveForFan, transcript })
    }

    // Conversation list: archived fans (with real last-message previews, like
    // the OF inbox) + live-active fans. Archive previews cached 2 min.
    const cached = CONV_CACHE.get(account)
    let base
    if (cached && Date.now() - cached.at < 120000) {
      base = new Map(cached.conversations.map((c) => [c.fan, { ...c }]))
    } else {
      base = new Map()
      let folders = []
      try {
        const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
            'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'namespace_id', namespace_id: ns }),
          },
          body: JSON.stringify({ path: `/Palm Ops/Chat Logs/${safeCreator}` }),
        })
        if (res.ok) folders = ((await res.json()).entries || []).filter((e) => e['.tag'] === 'folder').map((e) => e.name)
      } catch { /* no archives yet */ }
      await Promise.all(folders.map(async (fanFolder) => {
        const c = { fan: fanFolder, name: fanFolder, username: fanFolder, archived: true, lastAt: null, lastText: 'archived transcript only' }
        try {
          const buf = await downloadFromDropbox(token, ns, `/Palm Ops/Chat Logs/${safeCreator}/${fanFolder}/messages.json`)
          if (buf) {
            const arc = JSON.parse(buf.toString('utf8'))
            c.name = arc.fanName || fanFolder
            c.username = arc.fanUsername || fanFolder
            c.lastAt = arc.lastMessageAt || null
            const msgs = arc.messages || []
            // newest message with text, preferring non-mass (like OF's preview)
            const lastReal = [...msgs].reverse().find((m) => !m.isFromQueue && String(m.text || '').trim())
              || [...msgs].reverse().find((m) => String(m.text || '').trim())
            if (lastReal) {
              const txt = String(lastReal.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
              c.lastText = txt.length > 64 ? txt.slice(0, 64) + '…' : txt
            } else if (msgs.length) c.lastText = '(media)'
          }
        } catch { /* transcript-only folder */ }
        base.set(fanFolder, c)
      }))
      CONV_CACHE.set(account, { at: Date.now(), conversations: [...base.values()] })
    }
    for (const e of live) {
      const key = e.fan?.username || e.fan?.name || ''
      if (!key) continue
      const cur = base.get(key) || { fan: key, name: e.fan?.name || key, username: e.fan?.username || key, archived: false, lastAt: null, lastText: '' }
      if (!cur.lastAt || (e.at && e.at > cur.lastAt)) {
        cur.lastAt = e.at
        const txt = e.dir === 'unlock' ? `💸 unlocked $${e.price}` : (e.text || '(media)')
        cur.lastText = txt.length > 64 ? txt.slice(0, 64) + '…' : txt
        cur.name = e.fan?.name || cur.name
      }
      base.set(key, cur)
    }
    // muted list (other creators she follows, spam, etc.)
    let muted = []
    try {
      const mb = await downloadFromDropbox(token, ns, `/Palm Ops/OF Webhooks/live/${account}-muted.json`)
      if (mb) muted = JSON.parse(mb.toString('utf8'))
    } catch { /* none */ }
    const mutedSet = new Set(muted)
    const conversations = [...base.values()]
      .map((c) => ({ ...c, muted: mutedSet.has(c.fan) }))
      .sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || '') || a.fan.localeCompare(b.fan))
    return NextResponse.json({ accounts, conversations, live })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST — mute/unmute a conversation for an account (e.g. other creators she
// follows whose promo blasts land in the inbox). {account, fan, mute: bool}
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const { account, fan, mute } = await request.json()
    if (!account || !fan) return NextResponse.json({ error: 'account and fan required' }, { status: 400 })
    const token = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(token)
    const path = `/Palm Ops/OF Webhooks/live/${account}-muted.json`
    let muted = []
    try {
      const mb = await downloadFromDropbox(token, ns, path)
      if (mb) muted = JSON.parse(mb.toString('utf8'))
    } catch { /* none */ }
    muted = muted.filter((m) => m !== fan)
    if (mute) muted.push(fan)
    await uploadToDropbox(token, ns, path, Buffer.from(JSON.stringify(muted), 'utf8'))
    return NextResponse.json({ ok: true, muted })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
