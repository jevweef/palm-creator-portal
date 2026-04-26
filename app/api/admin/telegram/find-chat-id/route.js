export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const SMM_GROUP_CHAT_ID = process.env.TELEGRAM_SMM_GROUP_CHAT_ID

async function tg(method, params) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  })
  const data = await res.json()
  return { ok: data.ok, result: data.result, error: data.description, status: res.status }
}

// GET /api/admin/telegram/find-chat-id
// Diagnostic endpoint for SMM Telegram group setup. Returns:
//   - whether the bot token works (getMe)
//   - chats the bot has seen in recent updates
//   - for each supergroup, whether the bot is admin + has can_manage_topics
//   - whether topics are enabled (is_forum)
//   - status of the configured SMM group, if env var is set
export async function GET() {
  try { await requireAdmin() } catch (e) { return e }

  if (!TELEGRAM_TOKEN) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 })
  }

  // Bot identity
  const me = await tg('getMe')
  if (!me.ok) {
    return NextResponse.json({ error: `getMe failed: ${me.error}` }, { status: 500 })
  }
  const botId = me.result.id
  const botUsername = me.result.username

  // Check the configured SMM group, if env var is set
  let configuredGroup = null
  if (SMM_GROUP_CHAT_ID) {
    const chat = await tg('getChat', { chat_id: SMM_GROUP_CHAT_ID })
    if (!chat.ok) {
      configuredGroup = {
        id: SMM_GROUP_CHAT_ID,
        error: chat.error,
        diagnosis: chat.error?.includes('not found') ? 'Bot is not a member of this chat — add the bot.' : `Telegram error: ${chat.error}`,
      }
    } else {
      const member = await tg('getChatMember', { chat_id: SMM_GROUP_CHAT_ID, user_id: botId })
      const isAdmin = member.ok && (member.result.status === 'administrator' || member.result.status === 'creator')
      const canManageTopics = isAdmin && (member.result.can_manage_topics || member.result.status === 'creator')
      configuredGroup = {
        id: SMM_GROUP_CHAT_ID,
        title: chat.result.title,
        type: chat.result.type,
        isForum: !!chat.result.is_forum,
        botIsMember: member.ok,
        botIsAdmin: isAdmin,
        canManageTopics,
        readyForTopics: !!chat.result.is_forum && canManageTopics,
        diagnosis: !chat.result.is_forum
          ? '⚠ Topics are not enabled on this group. Open the group in Telegram → Edit → toggle "Topics" on.'
          : !member.ok
          ? '⚠ Bot is not a member of this group.'
          : !isAdmin
          ? '⚠ Bot is in the group but not an admin. Make Palm Bot an admin.'
          : !canManageTopics
          ? '⚠ Bot is admin but lacks Manage Topics permission. Edit the bot\'s admin rights and enable "Manage Topics".'
          : '✅ Ready: topics enabled, bot is admin with Manage Topics permission.',
      }
    }
  }

  // Recent chats from getUpdates (only useful before env var is set)
  const updates = await tg('getUpdates')
  const chats = {}
  if (updates.ok) {
    for (const update of updates.result || []) {
      const m = update.message || update.channel_post || update.edited_message
      if (!m?.chat) continue
      const c = m.chat
      if (!chats[c.id]) {
        chats[c.id] = {
          id: c.id,
          title: c.title || `${c.first_name || ''} ${c.last_name || ''}`.trim() || '(direct)',
          type: c.type,
          isForum: !!c.is_forum,
          lastFrom: m.from?.username || m.from?.first_name || '(unknown)',
          lastDate: new Date((m.date || 0) * 1000).toISOString(),
        }
      }
    }
  }

  return NextResponse.json({
    bot: { id: botId, username: botUsername },
    smmGroupConfigured: !!SMM_GROUP_CHAT_ID,
    configuredGroup,
    recentChats: Object.values(chats),
    hint: SMM_GROUP_CHAT_ID
      ? 'TELEGRAM_SMM_GROUP_CHAT_ID is set — see configuredGroup.diagnosis for status.'
      : 'TELEGRAM_SMM_GROUP_CHAT_ID is NOT set yet. Find your group in recentChats, copy its id, and add it to Vercel env.',
  })
}
