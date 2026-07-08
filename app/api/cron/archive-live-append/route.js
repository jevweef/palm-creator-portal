import { NextResponse } from 'next/server'
import { getDropboxAccessToken, getDropboxRootNamespaceId, listDropboxFolder } from '@/lib/dropbox'
import { loadChatArchive, saveChatArchive, mergeMessages } from '@/lib/chatArchive'
import { readLiveMany } from '@/lib/ofLiveBuffer'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Nightly: append the day's webhook 1:1 messages into the Dropbox chat
// archives of fans we've already pulled full histories for. Zero OF credits —
// analyses stay current without re-pulling. The pull cursor (lastMessageAt /
// lastMessageId) is deliberately NOT advanced: webhook coverage is
// best-effort, so the next real OF pull re-fetches the overlap and the
// id-dedupe merge reconciles. Idempotent — the cron fires twice a night and
// re-processing merges zero new messages.

const OPS_BASE = 'applLIT2t83plMqNx'
const sanitize = (s) => String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_')

function eventToMessage(e) {
  return {
    id: e.id,
    text: e.text || '',
    price: +e.price || 0,
    isOpened: false, // unknown from the send event; a later pull corrects it
    isTip: false,
    tipAmount: 0,
    isFromQueue: false,
    mediaCount: (e.photos || 0) + (e.videos || 0) || e.media || 0,
    isSentByMe: e.dir === 'out',
    fromUser: { id: e.dir === 'out' ? 0 : (e.fan?.id != null ? String(e.fan.id) : '') },
    createdAt: e.at || null,
    fromLiveAppend: true,
  }
}

export async function GET(request) {
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  if (expectedAuth && request.headers.get('authorization') !== expectedAuth) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const deadline = Date.now() + 230000
  try {
    const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent('Palm Creators')}?pageSize=100`, {
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` }, cache: 'no-store',
    })
    const creators = ((await res.json()).records || []).filter((c) => c.fields?.['OF API Account ID'])

    const token = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(token)
    let creatorFolders = []
    try { creatorFolders = (await listDropboxFolder(token, ns, '/Palm Ops/Chat Logs') || []).map((e) => e.name) } catch { /* none */ }

    const allIds = creators.flatMap((c) => String(c.fields['OF API Account ID']).split(',').map((x) => x.trim()).filter(Boolean))
    const byAccount = await readLiveMany(allIds, { limit: 20000 })
    const cutoff = Date.now() - 36 * 3600 * 1000 // generous overlap; dedupe absorbs it

    let fansTouched = 0, msgsAdded = 0, fansSkipped = 0
    const out = []
    for (const c of creators) {
      if (Date.now() > deadline) { out.push('DEADLINE — second pass finishes'); break }
      const name = c.fields.Creator || c.fields.AKA
      const aka = c.fields.AKA || c.fields.Creator
      // the archive tree uses whatever name the pull flow used — try both
      const folder = creatorFolders.find((f) => f === sanitize(name)) || creatorFolders.find((f) => f === sanitize(aka))
      if (!folder) continue
      let fanFolders = []
      try { fanFolders = new Set((await listDropboxFolder(token, ns, `/Palm Ops/Chat Logs/${folder}`) || []).map((e) => e.name)) } catch { continue }

      const ids = String(c.fields['OF API Account ID']).split(',').map((x) => x.trim()).filter(Boolean)
      const groups = new Map() // folderName -> events
      for (const id of ids) {
        for (const e of (byAccount[id] || [])) {
          if (e.dir !== 'in' && e.dir !== 'out') continue
          if (!e.at || new Date(e.at).getTime() < cutoff || e.id == null) continue
          if (!(e.text || '').trim() && !e.photos && !e.videos && !e.media) continue
          const key = fanFolders.has(sanitize(e.fan?.username)) ? sanitize(e.fan?.username)
            : fanFolders.has(sanitize(e.fan?.name)) ? sanitize(e.fan?.name) : null
          if (!key) { fansSkipped++; continue }
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key).push(e)
        }
      }

      for (const [fanFolder, events] of groups) {
        if (Date.now() > deadline) break
        const archive = await loadChatArchive(folder, fanFolder, fanFolder)
        if (!archive) continue // folder exists but no messages.json — not fully pulled
        const { merged, added } = mergeMessages(archive.messages, events.map(eventToMessage))
        if (!added) continue
        await saveChatArchive(folder, fanFolder, fanFolder, {
          ...archive, messages: merged,
          liveAppendedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        })
        fansTouched++; msgsAdded += added
        out.push(`${folder}/${fanFolder}: +${added}`)
      }
    }
    return NextResponse.json({ ok: true, fansTouched, msgsAdded, detail: out.slice(0, 40) })
  } catch (err) {
    console.error('[archive-live-append] fatal:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
