// Quick status check for the Telegram heartbeat. Returns the current
// webhook info from Telegram + a count of chats by status from Airtable.
// Useful for the admin page and for verifying setup after registering.

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'

const CHATS_TABLE = 'Telegram Chats'

export async function GET() {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const token = process.env.TELEGRAM_HEARTBEAT_BOT_TOKEN
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET

  // Telegram-side info
  let webhookInfo = null
  let webhookError = null
  if (token) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)
      const json = await res.json()
      webhookInfo = json.result || null
    } catch (err) {
      webhookError = err.message
    }
  }

  // Airtable-side counts
  let chatCounts = { pending: 0, watching: 0, ignored: 0, total: 0 }
  let chatsError = null
  try {
    const chats = await fetchAirtableRecords(CHATS_TABLE, {
      fields: ['Status'],
    })
    chatCounts.total = chats.length
    for (const r of chats) {
      const s = r.fields?.Status
      if (s === 'Pending Review') chatCounts.pending++
      else if (s === 'Watching') chatCounts.watching++
      else if (s === 'Ignored' || s === 'Ignored Forever') chatCounts.ignored++
    }
  } catch (err) {
    chatsError = err.message
  }

  return NextResponse.json({
    env: {
      tokenSet: !!token,
      secretSet: !!secret,
    },
    telegram: {
      webhookInfo,
      error: webhookError,
    },
    airtable: {
      chatCounts,
      error: chatsError,
    },
  })
}
