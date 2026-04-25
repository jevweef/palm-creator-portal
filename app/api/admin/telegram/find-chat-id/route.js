export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN

// GET /api/admin/telegram/find-chat-id
// One-time helper for setup. After adding Palm Bot to a group + posting any
// message in it, hit this endpoint. It calls getUpdates and returns the
// distinct chats the bot has seen recently. Copy the chat ID for the SMM
// group and put it in env as TELEGRAM_SMM_GROUP_CHAT_ID.
export async function GET() {
  try { await requireAdmin() } catch (e) { return e }

  if (!TELEGRAM_TOKEN) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 })
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates`)
    const data = await res.json()
    if (!data.ok) {
      return NextResponse.json({ error: data.description }, { status: 500 })
    }

    // Collapse updates → distinct chats with last seen at + sender
    const chats = {}
    for (const update of data.result || []) {
      const m = update.message || update.channel_post || update.edited_message
      if (!m?.chat) continue
      const c = m.chat
      if (!chats[c.id]) {
        chats[c.id] = {
          id: c.id,
          title: c.title || `${c.first_name || ''} ${c.last_name || ''}`.trim() || '(direct)',
          type: c.type,
          isForum: !!c.is_forum,
          lastMessage: m.text?.slice(0, 80) || `(${m.photo ? 'photo' : m.video ? 'video' : 'non-text'})`,
          lastFrom: m.from?.username || m.from?.first_name || '(unknown)',
          lastDate: new Date((m.date || 0) * 1000).toISOString(),
        }
      }
    }

    return NextResponse.json({
      chats: Object.values(chats),
      hint: 'Copy the id of the SMM group, set it in Vercel env as TELEGRAM_SMM_GROUP_CHAT_ID. Group must have isForum=true (Topics enabled in Telegram group settings).',
    })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
