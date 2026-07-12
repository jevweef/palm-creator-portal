import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { resolveFanId, fetchChatHistory } from '@/lib/onlyfansApi'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GRAB — pull this specific fan's real conversation straight from OnlyFans and
// return it in the live-chat thread shape. Costs OF credits (~1 credit per 100
// messages). Deliberately SEPARATE from Suggest: the operator grabs on demand;
// Suggest never pulls, it only reads what's already loaded.
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const { account, fan, fanName, count } = await request.json()
    if (!account || !fan) return NextResponse.json({ error: 'account and fan required' }, { status: 400 })
    const n = Math.max(10, Math.min(100, parseInt(count, 10) || 25))

    // The live-chat `account` is one specific OF page — the fan's chat lives there.
    const resolved = await resolveFanId(account, { username: fan, name: fanName }).catch(() => null)
    if (!resolved?.id) {
      return NextResponse.json({ error: `Couldn't find @${fan} on this OF account — he may have been renamed or deleted his account.` }, { status: 404 })
    }
    const fanId = String(resolved.id)

    // 1 page = 100 newest messages = ~1 credit. Our options top out at 100.
    const maxPages = Math.max(1, Math.ceil(n / 100))
    const { messages: raw, credits } = await fetchChatHistory(account, fanId, { maxPages })

    // Normalize to the exact shape the thread renderer expects (matches the
    // archive mapping in /api/admin/live-chat), keep the newest n (sorted asc).
    const norm = (raw || []).map((m) => ({
      id: m.id,
      dir: (m.isSentByMe === true || String(m?.fromUser?.id ?? '') !== fanId) ? 'out' : 'in',
      at: m.createdAt || null,
      text: String(m.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600),
      price: m.price || 0,
      bought: !!m.isOpened,
      mass: !!m.isFromQueue,
      media: m.mediaCount ?? (Array.isArray(m.media) ? m.media.length : 0),
    }))
    const messages = norm.slice(-n)

    return NextResponse.json({ messages, credits: credits || 0, fanId, fetched: norm.length, shown: messages.length })
  } catch (err) {
    console.error('[live-chat grab]', err?.message || err)
    return NextResponse.json({ error: err?.message || 'grab failed' }, { status: 500 })
  }
}
