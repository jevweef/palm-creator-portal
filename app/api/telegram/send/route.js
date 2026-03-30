export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin, patchAirtableRecord } from '@/lib/adminAuth'

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID

function rawDropboxUrl(url) {
  if (!url) return ''
  return url.replace(/[?&]dl=0/, '').replace(/([?&]raw=1)?$/, '') + (url.includes('?') ? '&raw=1' : '?raw=1')
}

function isVideo(url) {
  return /\.(mp4|mov|avi|webm|mkv)/i.test(url || '')
}

function isPhoto(url) {
  return /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)/i.test(url || '')
}

async function telegramRequest(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description}`)
  return data
}

export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { editedFileLink, threadId, caption, taskName, postId } = await request.json()

    if (!editedFileLink) return NextResponse.json({ error: 'No edited file link' }, { status: 400 })
    if (!threadId) return NextResponse.json({ error: 'No thread ID for this creator' }, { status: 400 })
    if (!TELEGRAM_TOKEN) return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 })
    if (!TELEGRAM_CHAT_ID) return NextResponse.json({ error: 'TELEGRAM_CHAT_ID not set' }, { status: 500 })

    const rawUrl = rawDropboxUrl(editedFileLink)
    const chatId = parseInt(TELEGRAM_CHAT_ID)
    const baseParams = {
      chat_id: chatId,
      message_thread_id: threadId,
      ...(caption ? { caption } : {}),
    }

    let result

    if (isVideo(editedFileLink)) {
      try {
        result = await telegramRequest('sendVideo', { ...baseParams, video: rawUrl, supports_streaming: true })
      } catch (err) {
        // Fallback: send as document
        try {
          result = await telegramRequest('sendDocument', { ...baseParams, document: rawUrl })
        } catch {
          // Final fallback: send link as message
          const text = [taskName && `*${taskName}*`, editedFileLink, caption].filter(Boolean).join('\n\n')
          result = await telegramRequest('sendMessage', { ...baseParams, text, parse_mode: 'Markdown' })
        }
      }
    } else if (isPhoto(editedFileLink)) {
      try {
        result = await telegramRequest('sendPhoto', { ...baseParams, photo: rawUrl })
      } catch {
        const text = [taskName && `*${taskName}*`, editedFileLink, caption].filter(Boolean).join('\n\n')
        result = await telegramRequest('sendMessage', { ...baseParams, text, parse_mode: 'Markdown' })
      }
    } else {
      try {
        result = await telegramRequest('sendDocument', { ...baseParams, document: rawUrl })
      } catch {
        const text = [taskName && `*${taskName}*`, editedFileLink, caption].filter(Boolean).join('\n\n')
        result = await telegramRequest('sendMessage', { ...baseParams, text, parse_mode: 'Markdown' })
      }
    }

    // Stamp the Post record if one was provided
    if (postId) {
      await patchAirtableRecord('Posts', postId, {
        'Status': 'Sent to Telegram',
        'Telegram Sent At': new Date().toISOString(),
        ...(caption ? { 'Caption': caption } : {}),
      }).catch(err => console.error('[Telegram Send] Failed to update Post record:', err.message))
    }

    return NextResponse.json({ ok: true, messageId: result.result?.message_id })
  } catch (err) {
    console.error('[Telegram Send] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
