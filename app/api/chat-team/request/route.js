import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST — a chat manager requests an analysis for a fan. Pings Evan's ops
// Telegram so the request lands somewhere visible; admins run the pull +
// analysis from Whale Hunting.

export async function POST(request) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await currentUser()
  const role = user?.publicMetadata?.role
  if (!['admin', 'super_admin', 'chat_manager'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    const { creator, fanName, note } = await request.json()
    if (!fanName) return NextResponse.json({ error: 'fanName required' }, { status: 400 })
    const token = process.env.TELEGRAM_BOT_TOKEN
    const chatId = process.env.TELEGRAM_OPS_CHAT_ID || process.env.TELEGRAM_SMM_GROUP_CHAT_ID
    if (!token || !chatId) return NextResponse.json({ error: 'Telegram not configured' }, { status: 500 })
    const who = user?.firstName || user?.emailAddresses?.[0]?.emailAddress || 'chat team'
    const text = `📋 Analysis request from ${who}\nFan: ${fanName}${creator ? `\nCreator: ${creator}` : ''}${note ? `\nNote: ${note}` : ''}\n\nRun it from Whale Hunting → the fan's card.`
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    })
    const data = await res.json()
    if (!data.ok) return NextResponse.json({ error: data.description || 'Telegram failed' }, { status: 502 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
