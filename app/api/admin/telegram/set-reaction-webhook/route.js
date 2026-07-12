import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

// One-time setup (idempotent): point the send bot (@palmmgmt_bot) webhook at the
// reaction receiver so ❤️ reactions in the SMM topics drive the runway drawdown.
// Visit this URL once as a logged-in admin on prod. Safe to re-run (re-registers
// + returns current webhook info). Only listens for message_reaction, so it does
// NOT affect the bot's sending.
export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return NextResponse.json({ ok: false, error: 'TELEGRAM_BOT_TOKEN not set on this deployment' }, { status: 500 })

  const webhookUrl = 'https://app.palm-mgmt.com/api/telegram/reactions'
  const set = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl, allowed_updates: ['message_reaction'] }),
  }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }))

  const info = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)
    .then((r) => r.json()).catch(() => null)

  return NextResponse.json({ ok: !!set?.ok, setWebhook: set, webhookInfo: info?.result || info })
}
