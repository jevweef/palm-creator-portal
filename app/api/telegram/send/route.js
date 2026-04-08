export const dynamic = 'force-dynamic'
export const maxDuration = 60 // extend Vercel function timeout for file uploads

import { NextResponse } from 'next/server'
import { requireAdmin, patchAirtableRecord, fetchAirtableRecords } from '@/lib/adminAuth'
import ffmpegStatic from 'ffmpeg-static'
import ffmpeg from 'fluent-ffmpeg'
import { writeFile, readFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

ffmpeg.setFfmpegPath(ffmpegStatic)

// Resize image to fit Telegram limits (max 1280px longest side, JPEG output)
async function resizeImage(inputBuffer, inputName) {
  const id = Date.now()
  const ext = inputName.split('.').pop().toLowerCase()
  const inputPath = join(tmpdir(), `tg_img_in_${id}.${ext}`)
  const outputPath = join(tmpdir(), `tg_img_out_${id}.jpg`)
  await writeFile(inputPath, Buffer.from(inputBuffer))
  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-vf', 'scale=1280:1280:force_original_aspect_ratio=decrease',
        '-q:v', '2', // high quality JPEG
      ])
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

async function getDropboxCredentials() {
  const tokenRes = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.DROPBOX_REFRESH_TOKEN,
      client_id: process.env.DROPBOX_APP_KEY,
      client_secret: process.env.DROPBOX_APP_SECRET,
    }),
  })
  if (!tokenRes.ok) throw new Error(`Dropbox token refresh failed: ${await tokenRes.text()}`)
  const { access_token } = await tokenRes.json()

  const acctRes = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}` },
  })
  const { root_info } = await acctRes.json()
  const pathRoot = JSON.stringify({ '.tag': 'root', root: root_info.root_namespace_id })

  return { token: access_token, pathRoot }
}

// Move edited file to next pipeline stage and update Airtable asset record
async function moveToNextStage(assetId, targetFolder) {
  const records = await fetchAirtableRecords('Assets', {
    filterByFormula: `RECORD_ID()='${assetId}'`,
    fields: ['Edited File Path', 'Edited File Link'],
  })
  const asset = records[0]
  if (!asset) { console.warn('[Dropbox Move] Asset not found:', assetId); return }

  const currentPath = (asset.fields?.['Edited File Path'] || '').trim()
  if (!currentPath) { console.warn('[Dropbox Move] No Edited File Path on asset'); return }

  // Replace the numbered stage folder (e.g. /30_EDITED_EXPORTS/) with the target
  const newPath = currentPath.replace(/\/\d+_[^/]+\//i, `/${targetFolder}/`)
  if (newPath === currentPath) { console.warn('[Dropbox Move] Path did not change — folder pattern not matched:', currentPath); return }

  console.log(`[Dropbox Move] ${currentPath} → ${newPath}`)
  const { token, pathRoot } = await getDropboxCredentials()
  const dbxHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Dropbox-API-Path-Root': pathRoot }

  // Move the file
  const moveRes = await fetch('https://api.dropboxapi.com/2/files/move_v2', {
    method: 'POST',
    headers: dbxHeaders,
    body: JSON.stringify({ from_path: currentPath, to_path: newPath, autorename: false }),
  })
  if (!moveRes.ok) throw new Error(`Dropbox move failed: ${await moveRes.text()}`)

  // Get new shared link
  let sharedUrl
  const linkRes = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
    method: 'POST',
    headers: dbxHeaders,
    body: JSON.stringify({ path: newPath, settings: { requested_visibility: 'public' } }),
  })
  if (linkRes.ok) {
    sharedUrl = (await linkRes.json()).url?.replace('dl=0', 'raw=1')
  } else {
    const existRes = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
      method: 'POST',
      headers: dbxHeaders,
      body: JSON.stringify({ path: newPath }),
    })
    sharedUrl = (await existRes.json()).links?.[0]?.url?.replace('dl=0', 'raw=1')
  }

  // Update asset record with new path and link
  await patchAirtableRecord('Assets', assetId, {
    'Edited File Path': newPath,
    ...(sharedUrl ? { 'Edited File Link': sharedUrl } : {}),
  })
  console.log(`[Dropbox Move] Done — new link: ${sharedUrl?.slice(0, 60)}`)
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
    const { editedFileLink, threadId, caption, taskName, postId, thumbnailUrl, assetId, rawCaption, rawHashtags, platform, scheduledDate } = await request.json()

    if (!editedFileLink) return NextResponse.json({ error: 'No edited file link' }, { status: 400 })
    if (!threadId) return NextResponse.json({ error: 'No thread ID for this creator' }, { status: 400 })
    if (!TELEGRAM_TOKEN) return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 })
    if (!TELEGRAM_CHAT_ID) return NextResponse.json({ error: 'TELEGRAM_CHAT_ID not set' }, { status: 500 })

    const rawUrl = rawDropboxUrl(editedFileLink)
    const chatId = parseInt(TELEGRAM_CHAT_ID)

    const ext = (getFilename(editedFileLink).split('.').pop() || '').toLowerCase()
    const needsRemux = isVideo(editedFileLink) && ext !== 'mp4'
    // MP4: always use URL method (fastest, no download needed). MOV: download + remux up to 50MB.
    const URL_THRESHOLD = needsRemux ? MAX_UPLOAD_BYTES : 0

    // Check file size with HEAD request first (avoids downloading huge files just to check)
    let fileSize = 0
    try {
      const headRes = await fetch(rawUrl, { method: 'HEAD' })
      fileSize = parseInt(headRes.headers.get('content-length') || '0')
      console.log(`[Telegram Send] File size (HEAD): ${(fileSize / 1024 / 1024).toFixed(1)}MB`)
    } catch {
      console.log('[Telegram Send] HEAD request failed, will download to check size')
    }

    let result

    if (!needsRemux || fileSize > URL_THRESHOLD) {
      // URL method — video stays on Dropbox, only download/resize the thumbnail
      console.log(`[Telegram Send] Using URL method (${needsRemux ? 'too large' : 'MP4, no remux needed'})`)

      if (isVideo(editedFileLink) && thumbnailUrl) {
        // Download + resize thumbnail, then send as media group with video URL
        try {
          console.log('[Telegram Send] Downloading thumbnail for media group...')
          const thumbRes = await fetch(rawDropboxUrl(thumbnailUrl))
          if (!thumbRes.ok) throw new Error('Thumbnail download failed')
          const rawThumbBuffer = await thumbRes.arrayBuffer()
          console.log(`[Telegram Send] Resizing thumbnail (${(rawThumbBuffer.byteLength / 1024 / 1024).toFixed(1)}MB)...`)
          const thumbBuffer = await resizeImage(rawThumbBuffer, getFilename(thumbnailUrl))
          console.log(`[Telegram Send] Thumbnail resized to ${(thumbBuffer.length / 1024).toFixed(0)}KB`)

          const form = new FormData()
          form.append('chat_id', String(chatId))
          form.append('message_thread_id', String(threadId))
          const mediaGroup = [
            { type: 'video', media: rawUrl, thumbnail: 'attach://thumb_file', supports_streaming: true, ...(caption ? { caption } : {}) },
            { type: 'photo', media: 'attach://photo_file' },
          ]
          form.append('media', JSON.stringify(mediaGroup))
          form.append('thumb_file', new Blob([thumbBuffer], { type: 'image/jpeg' }), 'thumbnail.jpg')
          form.append('photo_file', new Blob([thumbBuffer], { type: 'image/jpeg' }), 'thumbnail.jpg')
          result = await telegramUpload('sendMediaGroup', form)
        } catch (err) {
          console.warn('[Telegram Send] Media group with URL failed, falling back to sendVideo:', err.message)
          result = await telegramJson('sendVideo', { chat_id: chatId, message_thread_id: threadId, video: rawUrl, supports_streaming: true, ...(caption ? { caption } : {}) })
        }
      } else {
        const baseParams = { chat_id: chatId, message_thread_id: threadId, ...(caption ? { caption } : {}) }
        if (isVideo(editedFileLink)) {
          result = await telegramJson('sendVideo', { ...baseParams, video: rawUrl, supports_streaming: true })
        } else if (isPhoto(editedFileLink)) {
          result = await telegramJson('sendPhoto', { ...baseParams, photo: rawUrl })
        } else {
          result = await telegramJson('sendDocument', { ...baseParams, document: rawUrl })
        }
      }
    } else {
      // MOV under 50MB — download, remux, upload as multipart
      console.log('[Telegram Send] Downloading file from Dropbox for remux...')
      const fileRes = await fetch(rawUrl)
      if (!fileRes.ok) throw new Error(`Failed to download file from Dropbox: ${fileRes.status}`)
      const fileBuffer = await fileRes.arrayBuffer()
      console.log(`[Telegram Send] Downloaded: ${(fileBuffer.byteLength / 1024 / 1024).toFixed(1)}MB`)

      const form = new FormData()
      form.append('chat_id', String(chatId))
      form.append('message_thread_id', String(threadId))
      if (caption) form.append('caption', caption)

      const filename = getFilename(editedFileLink)
      const mimeType = getMimeType(editedFileLink)

      // Remux non-MP4 videos to MP4 with faststart for Telegram inline preview.
      // Skip remux for .mp4 files to avoid timeout on large files.
      let uploadBuffer = fileBuffer
      let uploadFilename = filename
      let uploadMime = mimeType
      const ext = (filename.split('.').pop() || '').toLowerCase()
      if (isVideo(editedFileLink) && ext !== 'mp4') {
        console.log(`[Telegram Send] Remuxing ${ext} to MP4 with faststart...`)
        uploadBuffer = await remuxToMp4(fileBuffer, filename)
        uploadFilename = filename.replace(/\.[^.]+$/, '.mp4')
        uploadMime = 'video/mp4'
        console.log(`[Telegram Send] Remux done, size: ${(uploadBuffer.length / 1024 / 1024).toFixed(1)}MB`)
      } else if (isVideo(editedFileLink)) {
        uploadMime = 'video/mp4'
      }

      if (isVideo(editedFileLink) && thumbnailUrl) {
        // Send video + photo as a media group (shows side by side like native Telegram media)
        // Set thumbnail on the video so it shows a preview frame instead of black
        const thumbRes = await fetch(rawDropboxUrl(thumbnailUrl))
        if (!thumbRes.ok) throw new Error('Failed to download thumbnail from Dropbox')
        const rawThumbBuffer = await thumbRes.arrayBuffer()

        // Resize thumbnail to fit Telegram limits (max 1280px, <10MB)
        console.log(`[Telegram Send] Resizing thumbnail (${(rawThumbBuffer.byteLength / 1024 / 1024).toFixed(1)}MB)...`)
        const thumbBuffer = await resizeImage(rawThumbBuffer, getFilename(thumbnailUrl))
        console.log(`[Telegram Send] Thumbnail resized to ${(thumbBuffer.length / 1024).toFixed(0)}KB`)
        const thumbMime = 'image/jpeg'
        const thumbFilename = 'thumbnail.jpg'

        const mediaGroup = [
          { type: 'video', media: 'attach://video_file', thumbnail: 'attach://thumb_file', supports_streaming: true, width: 1080, height: 1920, ...(caption ? { caption } : {}) },
          { type: 'photo', media: 'attach://photo_file' },
        ]
        form.append('media', JSON.stringify(mediaGroup))
        form.append('video_file', new Blob([uploadBuffer], { type: uploadMime }), uploadFilename)
        form.append('thumb_file', new Blob([thumbBuffer], { type: thumbMime }), thumbFilename)
        form.append('photo_file', new Blob([thumbBuffer], { type: thumbMime }), thumbFilename)
        try {
          result = await telegramUpload('sendMediaGroup', form)
        } catch (mediaErr) {
          console.warn('[Telegram Send] sendMediaGroup failed, falling back to sendVideo:', mediaErr.message)
          // Fall back to video-only send without thumbnail
          const fallbackForm = new FormData()
          fallbackForm.append('chat_id', String(chatId))
          fallbackForm.append('message_thread_id', String(threadId))
          if (caption) fallbackForm.append('caption', caption)
          fallbackForm.append('video', new Blob([uploadBuffer], { type: uploadMime }), uploadFilename)
          fallbackForm.append('supports_streaming', 'true')
          result = await telegramUpload('sendVideo', fallbackForm)
        }
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

    // Stamp the Post record — also save caption/hashtags/platform/date in case user didn't Save first
    if (postId) {
      await patchAirtableRecord('Posts', postId, {
        'Status': 'Sent to Telegram',
        'Telegram Sent At': new Date().toISOString(),
        ...(messageId ? { 'Telegram Message ID': String(messageId) } : {}),
        ...(rawCaption ? { 'Caption': rawCaption } : {}),
        ...(rawHashtags ? { 'Hashtags': rawHashtags } : {}),
        ...(platform?.length ? { 'Platform': platform } : {}),
        ...(scheduledDate ? { 'Scheduled Date': scheduledDate } : {}),
      }).catch(err => console.error('[Telegram Send] Failed to update Post record:', err.message))
    }

    // Move file to 40_READY_TO_POST in Dropbox
    if (assetId) {
      moveToNextStage(assetId, '40_READY_TO_POST').catch(err =>
        console.error('[Telegram Send] Dropbox move failed (non-fatal):', err.message)
      )
    }

    return NextResponse.json({ ok: true, messageId })
  } catch (err) {
    console.error('[Telegram Send] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
