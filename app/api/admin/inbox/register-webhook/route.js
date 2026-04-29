// One-time (or as-needed) helper to register the Telegram heartbeat webhook
// with Telegram's servers. Tells Telegram: "for any message my bot sees,
// POST it to this URL with this secret in the header."
//
// Idempotent — safe to call again to update the URL or rotate the secret.

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireInboxOwner } from '@/lib/adminAuth'

export async function POST(request) {
  const auth = await requireInboxOwner()
  if (auth instanceof NextResponse) return auth

  const token = process.env.TELEGRAM_HEARTBEAT_BOT_TOKEN
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!token) {
    return NextResponse.json(
      { error: 'TELEGRAM_HEARTBEAT_BOT_TOKEN not set in env' },
      { status: 500 }
    )
  }
  if (!secret) {
    return NextResponse.json(
      { error: 'TELEGRAM_WEBHOOK_SECRET not set in env' },
      { status: 500 }
    )
  }

  // Caller can override the URL for testing (e.g. a Vercel preview URL).
  // Defaults to production.
  const body = await request.json().catch(() => ({}))
  const baseUrl = body.url || 'https://app.palm-mgmt.com'
  const webhookUrl = `${baseUrl.replace(/\/$/, '')}/api/inbox/telegram`

  // allowed_updates: only the message-shaped events we actually handle.
  // Reduces noise from member joins, callback queries, etc.
  const params = {
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post'],
    drop_pending_updates: !!body.dropPending,
  }

  const tgRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const tgJson = await tgRes.json()

  if (!tgRes.ok || !tgJson.ok) {
    return NextResponse.json(
      { error: 'Telegram rejected setWebhook', telegram: tgJson },
      { status: 502 }
    )
  }

  return NextResponse.json({
    ok: true,
    webhookUrl,
    telegram: tgJson,
  })
}

// DELETE removes the webhook (useful if you want to pause heartbeat).
export async function DELETE() {
  const auth = await requireInboxOwner()
  if (auth instanceof NextResponse) return auth

  const token = process.env.TELEGRAM_HEARTBEAT_BOT_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'token not set' }, { status: 500 })
  }

  const tgRes = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
    method: 'POST',
  })
  const tgJson = await tgRes.json()
  return NextResponse.json({ ok: tgRes.ok, telegram: tgJson })
}
