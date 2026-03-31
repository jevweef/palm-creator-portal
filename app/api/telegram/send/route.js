export const dynamic = 'force-dynamic'
export const maxDuration = 60 // extend Vercel function timeout for file uploads

import { NextResponse } from 'next/server'
import { requireAdmin, patchAirtableRecord } from '@/lib/adminAuth'
import ffmpegStatic from 'ffmpeg-static'
import ffmpeg from 'fluent-ffmpeg'
import { writeFile, readFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

ffmpeg.setFfmpegPath(ffmpegStatic)

// Remux MOV → MP4 using -c copy (zero quality loss, just container change)
async function remuxToMp4(inputBuffer, inputName) {
  const id = Date.now()
  const ext = inputName.split('.').pop().toLowerCase()
  const inputPath = join(tmpdir(), `tg_in_${id}.${ext}`)
  const outputPath = join(tmpdir(), `tg_out_${id}.mp4`)
  await writeFile(inputPath, Buffer.from(inputBuffer))
  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(['-c copy', '-movflags +faststart'])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run()
  })
  const outputBuffer = await readFile(outputPath)
  await unlink(inputPath).catch(() => {})
  await unlink(outputPath).catch(() => {})
  return outputBuffer
}

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // 50MB Telegram bot upload limit

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

function getMimeType(url) {
  const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase()
  const map = { mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo', webm: 'video/webm', mkv: 'video/x-matroska',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }
  return map[ext] || 'application/octet-stream'
}

function getFilename(url) {
  return url.split('/').pop()?.split('?')[0] || 'file'
}

async function telegramUpload(method, form) {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`, {
    method: 'POST',
    body: form,
  })
  const data = await res.json()
  if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description}`)
  return data
}

async function telegramJson(method, body) {
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
    const { editedFileLink, threadId, caption, taskName, postId, thumbnailUrl } = await request.json()

    if (!editedFileLink) return NextResponse.json({ error: 'No edited file link' }, { status: 400 })
    if (!threadId) return NextResponse.json({ error: 'No thread ID for this creator' }, { status: 400 })
    if (!TELEGRAM_TOKEN) return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 })
    if (!TELEGRAM_CHAT_ID) return NextResponse.json({ error: 'TELEGRAM_CHAT_ID not set' }, { status: 500 })

    const rawUrl = rawDropboxUrl(editedFileLink)
    const chatId = parseInt(TELEGRAM_CHAT_ID)

    // Download the file from Dropbox
    console.log('[Telegram Send] Downloading file from Dropbox...')
    const fileRes = await fetch(rawUrl)
    if (!fileRes.ok) throw new Error(`Failed to download file from Dropbox: ${fileRes.status}`)
    const fileBuffer = await fileRes.arrayBuffer()
    const fileSize = fileBuffer.byteLength
    console.log(`[Telegram Send] File size: ${(fileSize / 1024 / 1024).toFixed(1)}MB`)

    let result

    if (fileSize > MAX_UPLOAD_BYTES) {
      // Over 50MB — fall back to URL method
      console.log('[Telegram Send] File too large for upload, falling back to URL method')
      const baseParams = { chat_id: chatId, message_thread_id: threadId, ...(caption ? { caption } : {}) }
      if (isVideo(editedFileLink)) {
        result = await telegramJson('sendVideo', { ...baseParams, video: rawUrl, supports_streaming: true })
      } else if (isPhoto(editedFileLink)) {
        result = await telegramJson('sendPhoto', { ...baseParams, photo: rawUrl })
      } else {
        result = await telegramJson('sendDocument', { ...baseParams, document: rawUrl })
      }
    } else {
      // Under 50MB — upload directly as multipart
      const form = new FormData()
      form.append('chat_id', String(chatId))
      form.append('message_thread_id', String(threadId))
      if (caption) form.append('caption', caption)

      const filename = getFilename(editedFileLink)
      const mimeType = getMimeType(editedFileLink)

      // Remux MOV → MP4 for better Telegram compatibility (zero quality loss)
      let uploadBuffer = fileBuffer
      let uploadFilename = filename
      let uploadMime = mimeType
      if (/\.mov$/i.test(editedFileLink)) {
        console.log('[Telegram Send] Remuxing MOV → MP4...')
        uploadBuffer = await remuxToMp4(fileBuffer, filename)
        uploadFilename = filename.replace(/\.mov$/i, '.mp4')
        uploadMime = 'video/mp4'
        console.log(`[Telegram Send] Remux done, size: ${(uploadBuffer.length / 1024 / 1024).toFixed(1)}MB`)
      }

      if (isVideo(editedFileLink) && thumbnailUrl) {
        // Send video + photo as a media group (shows side by side like native Telegram media)
        const thumbRes = await fetch(rawDropboxUrl(thumbnailUrl))
        if (!thumbRes.ok) throw new Error('Failed to download thumbnail from Dropbox')
        const thumbBuffer = await thumbRes.arrayBuffer()

        const mediaGroup = [
          { type: 'video', media: 'attach://video_file', supports_streaming: true, ...(caption ? { caption } : {}) },
          { type: 'photo', media: 'attach://photo_file' },
        ]
        form.append('media', JSON.stringify(mediaGroup))
        form.append('video_file', new Blob([uploadBuffer], { type: uploadMime }), uploadFilename)
        form.append('photo_file', new Blob([thumbBuffer], { type: getMimeType(thumbnailUrl) }), getFilename(thumbnailUrl))
        result = await telegramUpload('sendMediaGroup', form)
      } else if (isVideo(editedFileLink)) {
        // No thumbnail — send video only
        form.append('video', new Blob([uploadBuffer], { type: uploadMime }), uploadFilename)
        form.append('supports_streaming', 'true')
        try {
          result = await telegramUpload('sendVideo', form)
        } catch (err) {
          console.warn('[Telegram Send] sendVideo failed, trying sendDocument:', err.message)
          const fallbackForm = new FormData()
          fallbackForm.append('chat_id', String(chatId))
          fallbackForm.append('message_thread_id', String(threadId))
          if (caption) fallbackForm.append('caption', caption)
          fallbackForm.append('document', new Blob([uploadBuffer], { type: uploadMime }), uploadFilename)
          result = await telegramUpload('sendDocument', fallbackForm)
        }
      } else if (isPhoto(editedFileLink)) {
        form.append('photo', new Blob([fileBuffer], { type: mimeType }), filename)
        result = await telegramUpload('sendPhoto', form)
      } else {
        form.append('document', new Blob([fileBuffer], { type: mimeType }), filename)
        result = await telegramUpload('sendDocument', form)
      }
    }

    // Extract message ID (sendMediaGroup returns array, others return single message)
    const messageId = Array.isArray(result.result)
      ? result.result[0]?.message_id
      : result.result?.message_id

    // Stamp the Post record
    if (postId) {
      await patchAirtableRecord('Posts', postId, {
        'Status': 'Sent to Telegram',
        'Telegram Sent At': new Date().toISOString(),
        ...(messageId ? { 'Telegram Message ID': String(messageId) } : {}),
      }).catch(err => console.error('[Telegram Send] Failed to update Post record:', err.message))
    }

    return NextResponse.json({ ok: true, messageId })
  } catch (err) {
    console.error('[Telegram Send] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
