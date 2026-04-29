import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { notifyOftv } from '@/lib/oftvTelegram'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

// Smoke test for the OFTV Telegram pipeline. Hit POST with ?event=<name>
// (default: creator_revision_requested) and a sample message lands in the
// long-form topic. Returns clear feedback on what was attempted + whether
// the env vars are wired up so you don't have to dig through Vercel logs.
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  const TELEGRAM_TOKEN = !!process.env.TELEGRAM_BOT_TOKEN
  const EDITOR_CHAT_ID = process.env.EDITOR_CHAT_ID || '-1003779148361 (default)'
  const LONGFORM_THREAD_ID = process.env.EDITOR_LONGFORM_THREAD_ID || null

  if (!TELEGRAM_TOKEN) {
    return NextResponse.json({
      ok: false,
      issue: 'TELEGRAM_BOT_TOKEN not set in env. Set this in Vercel → Settings → Environment Variables.',
      env: { TELEGRAM_BOT_TOKEN: false, EDITOR_CHAT_ID, LONGFORM_THREAD_ID },
    }, { status: 200 })
  }

  if (!LONGFORM_THREAD_ID) {
    return NextResponse.json({
      ok: false,
      issue: 'EDITOR_LONGFORM_THREAD_ID not set in env. Get the thread id by sending any message in the long-form topic, then GET https://api.telegram.org/bot<TOKEN>/getUpdates and looking for message_thread_id. Set it in Vercel.',
      env: { TELEGRAM_BOT_TOKEN: true, EDITOR_CHAT_ID, LONGFORM_THREAD_ID: false },
    }, { status: 200 })
  }

  const { searchParams } = new URL(request.url)
  const event = searchParams.get('event') || 'creator_revision_requested'

  // Sample payload that mirrors the real Coaster Making record — useful so
  // the deep-link in the test message actually opens a real project.
  await notifyOftv({
    event,
    creator: 'Gracey (TEST)',
    projectName: 'Coaster Making',
    projectId: 'recdip7gS5xqpqeWT',
    assignedEditor: 'Lily (TEST)',
    notes: 'TEST FEEDBACK — please ignore. Verifying the long-form Telegram pipeline. The link in this message should auto-open the Coaster Making project for the editor.',
    revisionCount: 1,
  })

  return NextResponse.json({
    ok: true,
    sentEvent: event,
    env: { TELEGRAM_BOT_TOKEN: true, EDITOR_CHAT_ID, LONGFORM_THREAD_ID },
    note: 'Check the long-form topic in Telegram. If the message did not arrive, check Vercel function logs for [oftv-telegram] warnings — the bot may not be in the group, or the thread id may be wrong.',
  })
}

// GET — same but easier to hit from browser
export async function GET(request) {
  return POST(request)
}
