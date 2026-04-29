import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

// Helper for finding Telegram forum-topic thread ids without juggling
// the bot token by hand. Hits getUpdates server-side and surfaces every
// distinct (chat_id, thread_id, topic_name) combo seen in recent messages.
//
// Workflow:
//   1. In the topic you want to wire up (e.g. long-form editing), send
//      any message ("hi" works).
//   2. Hit GET /api/admin/telegram/discover-threads.
//   3. Find your topic in the JSON output, copy `messageThreadId`.
//   4. Set the corresponding env var in Vercel (e.g. EDITOR_LONGFORM_THREAD_ID)
//      and redeploy.
//
// Telegram's getUpdates only returns updates that haven't been consumed
// by a webhook. If updates are empty, the bot may be in webhook mode —
// in that case use the existing Telegram inbox webhook logs to see the
// thread id, or temporarily delete the webhook (deleteWebhook) and try
// again.
export async function GET() {
  try { await requireAdmin() } catch (e) { return e }

  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 })
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, { cache: 'no-store' })
  const data = await res.json()
  if (!data.ok) {
    return NextResponse.json({ error: 'getUpdates failed', detail: data.description }, { status: 500 })
  }

  // Collapse all messages into unique (chat, thread) pairs. Topic name
  // comes from forum_topic_created events when present, otherwise we just
  // surface the first text seen in the thread as a hint.
  const seen = new Map()
  for (const update of data.result || []) {
    const msg = update.message || update.edited_message || update.channel_post
    if (!msg) continue
    const chatId = msg.chat?.id
    const threadId = msg.message_thread_id || null
    if (!chatId) continue
    const key = `${chatId}|${threadId || 'main'}`
    if (!seen.has(key)) {
      seen.set(key, {
        chatId,
        chatTitle: msg.chat?.title || msg.chat?.first_name || '',
        chatType: msg.chat?.type,
        messageThreadId: threadId,
        topicName: msg.forum_topic_created?.name || null,
        sampleText: msg.text || msg.caption || '',
        sampleFrom: msg.from?.first_name || '',
      })
    } else {
      // If we later see a forum_topic_created for the same key, prefer that name.
      const entry = seen.get(key)
      if (!entry.topicName && msg.forum_topic_created?.name) {
        entry.topicName = msg.forum_topic_created.name
      }
    }
  }

  return NextResponse.json({
    ok: true,
    rawUpdateCount: (data.result || []).length,
    threads: Array.from(seen.values()),
    note: data.result?.length === 0
      ? 'No recent updates. Either no one has messaged the bot lately, or a webhook is consuming updates. Send a message in the topic and try again.'
      : `Found ${seen.size} distinct chat/thread combos. Look for the long-form editing topic — copy messageThreadId and set EDITOR_LONGFORM_THREAD_ID in Vercel.`,
  })
}
