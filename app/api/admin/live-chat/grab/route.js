import { NextResponse } from 'next/server'
import { requireLiveChatAccess, fetchAirtableRecords } from '@/lib/adminAuth'
import { guardAccount } from '@/lib/chatTeamScope'
import { resolveFanId, fetchChatHistory } from '@/lib/onlyfansApi'
import { loadChatArchive, saveChatArchive, mergeMessages } from '@/lib/chatArchive'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GRAB — pull this specific fan's real conversation from OnlyFans, MERGE it into
// the fan's chat archive (so the messages persist and become part of his history),
// and return the thread in the live-chat shape. Costs OF credits (~1/100 msgs).
// Deliberately SEPARATE from Suggest: the operator grabs on demand; Suggest never
// pulls, it only reads what's already loaded.

const norm = (raw, fanId) => (raw || []).map((m) => ({
  id: m.id,
  dir: (m.isSentByMe === true || String(m?.fromUser?.id ?? '') !== String(fanId)) ? 'out' : 'in',
  at: m.createdAt || null,
  text: String(m.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600),
  price: m.price || 0,
  bought: !!m.isOpened,
  mass: !!m.isFromQueue,
  media: m.mediaCount ?? (Array.isArray(m.media) ? m.media.length : 0),
}))

export async function POST(request) {
  try { await requireLiveChatAccess() } catch (e) { return e }
  try {
    const { account, fan, fanName, count } = await request.json()
    if (!account || !fan) return NextResponse.json({ error: 'account and fan required' }, { status: 400 })
    try { await guardAccount(request, account) } catch (e) { return e }
    const n = Math.max(10, Math.min(100, parseInt(count, 10) || 25))

    // Creator name for the archive path — MUST match how /api/admin/live-chat
    // reads it (meta.name = Creator || AKA), or the persisted messages land in a
    // folder the thread won't read back.
    const creators = await fetchAirtableRecords('Palm Creators', { fields: ['Creator', 'AKA', 'OF API Account ID'] })
    const crec = creators.find((c) =>
      String(c.fields?.['OF API Account ID'] || '').split(',').map((s) => s.trim()).filter(Boolean).includes(account))
    const creatorName = crec?.fields?.Creator || crec?.fields?.AKA || ''
    if (!creatorName) return NextResponse.json({ error: 'Could not resolve creator for this account.' }, { status: 404 })

    // Existing archive first — reuse its fanId (0 credits) when we already have one.
    const existing = await loadChatArchive(creatorName, fanName, fan)
    let fanId = existing?.fanId ? String(existing.fanId) : ''
    if (!fanId) {
      const resolved = await resolveFanId(account, { username: fan, name: fanName }).catch(() => null)
      if (!resolved?.id) {
        return NextResponse.json({ error: `Couldn't find @${fan} on this OF account — he may have been renamed or deleted his account.` }, { status: 404 })
      }
      fanId = String(resolved.id)
    }

    // 1 page = 100 newest messages = ~1 credit. Our options top out at 100.
    const maxPages = Math.max(1, Math.ceil(n / 100))
    const { messages: raw, credits } = await fetchChatHistory(account, fanId, { maxPages })

    // Merge into the archive and persist (dedup by id, ascending).
    const { merged, added } = mergeMessages(existing?.messages, raw || [])
    const last = merged[merged.length - 1]
    await saveChatArchive(creatorName, fanName, fan, {
      ...(existing || {}),
      fanId,
      fanUsername: fan,
      fanName: fanName || existing?.fanName || '',
      messages: merged,
      lastMessageAt: last?.createdAt || existing?.lastMessageAt || null,
      lastMessageId: last?.id || existing?.lastMessageId || null,
      updatedAt: new Date().toISOString(),
    })

    // Return the full persisted history tail so the thread reflects what's now saved.
    const messages = norm(merged, fanId).slice(-200)
    return NextResponse.json({
      messages, credits: credits || 0, fanId,
      added, saved: true, shown: messages.length, total: merged.length,
    })
  } catch (err) {
    console.error('[live-chat grab]', err?.message || err)
    return NextResponse.json({ error: err?.message || 'grab failed' }, { status: 500 })
  }
}
