export const dynamic = 'force-dynamic'
// Vercel Pro cap is 300s. Compression of 50MB+ videos on serverless CPUs can
// legitimately take 30-60s, plus ~10s download + 10s upload + 35s URL method
// attempt. 60s was too tight once compression joined the flow.
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { requireAdmin, patchAirtableRecord, fetchAirtableRecords } from '@/lib/adminAuth'
import ffmpegStatic from 'ffmpeg-static'
import ffmpeg from 'fluent-ffmpeg'
import { writeFile, readFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

ffmpeg.setFfmpegPath(ffmpegStatic)
const execFilePromise = promisify(execFile)

// Probe video duration in seconds by parsing ffmpeg stderr (ffprobe not in
// ffmpeg-static). Returns null if parsing fails.
async function getVideoDuration(filePath) {
  try {
    // ffmpeg -i exits with code 1 but writes duration to stderr
    await execFilePromise(ffmpegStatic, ['-i', filePath], { timeout: 10000 })
  } catch (err) {
    const stderr = err.stderr || ''
    const m = stderr.match(/Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/)
    if (!m) return null
    const [, h, mnt, s] = m
    return parseInt(h) * 3600 + parseInt(mnt) * 60 + parseFloat(s)
  }
  return null
}

// Resize image to fit Telegram limits (max 1280px longest side, JPEG output).
// Uses execFile directly — fluent-ffmpeg was causing 5+ minute hangs on Vercel
// serverless because stdout/stderr pipes weren't being drained.
async function resizeImage(inputBuffer, inputName) {
  const id = Date.now()
  const ext = inputName.split('.').pop().toLowerCase()
  const inputPath = join(tmpdir(), `tg_img_in_${id}.${ext}`)
  const outputPath = join(tmpdir(), `tg_img_out_${id}.jpg`)
  await writeFile(inputPath, Buffer.from(inputBuffer))
  await new Promise((resolve, reject) => {
    const args = [
      '-y', '-i', inputPath,
      '-vf', 'scale=1280:1280:force_original_aspect_ratio=decrease',
      '-q:v', '2',
      outputPath,
    ]
    execFile(ffmpegStatic, args, { timeout: 30000, maxBuffer: 20 * 1024 * 1024 }, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
  const outputBuffer = await readFile(outputPath)
  await unlink(inputPath).catch(() => {})
  await unlink(outputPath).catch(() => {})
  return outputBuffer
}

// Remux MOV → MP4 using -c copy (zero quality loss, just container change).
// Uses execFile — same reasoning as resizeImage (fluent-ffmpeg pipe deadlock).
async function remuxToMp4(inputBuffer, inputName) {
  const id = Date.now()
  const ext = inputName.split('.').pop().toLowerCase()
  const inputPath = join(tmpdir(), `tg_in_${id}.${ext}`)
  const outputPath = join(tmpdir(), `tg_out_${id}.mp4`)
  await writeFile(inputPath, Buffer.from(inputBuffer))
  await new Promise((resolve, reject) => {
    const args = [
      '-y', '-i', inputPath,
      '-c', 'copy',
      '-movflags', '+faststart',
      outputPath,
    ]
    execFile(ffmpegStatic, args, { timeout: 60000, maxBuffer: 50 * 1024 * 1024 }, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
  const outputBuffer = await readFile(outputPath)
  await unlink(inputPath).catch(() => {})
  await unlink(outputPath).catch(() => {})
  return outputBuffer
}

// Compress a video to fit under Telegram's 50MB bot upload limit using the
// MINIMUM bitrate reduction needed. For files barely over (e.g. 51MB → 47MB
// target) this is an ~8% bitrate shave — visually indistinguishable from
// source. Only for dramatically oversized files does quality noticeably drop.
//
// Approach:
//   1. Probe duration
//   2. Compute target video bitrate = (targetSize * 8 / duration) - audioBitrate
//   3. Single-pass libx264 with that bitrate target + veryfast preset
//
// If we can't probe duration, fall back to CRF 26 (still very high quality).
// If output is STILL too big after targeted encode, aggressive mode kicks in
// with a 720p cap + CRF 30 (noticeable but acceptable degradation).
async function compressVideo(inputBuffer, inputName, { targetMB = 47, aggressive = false } = {}) {
  const id = Date.now()
  const ext = (inputName.split('.').pop() || 'mp4').toLowerCase()
  const inputPath = join(tmpdir(), `tg_comp_in_${id}.${ext}`)
  const outputPath = join(tmpdir(), `tg_comp_out_${id}.mp4`)
  await writeFile(inputPath, Buffer.from(inputBuffer))

  let videoOpts
  if (aggressive) {
    // Last-resort: drop to 720p + CRF 30. Clear quality hit, but fits.
    videoOpts = [
      '-c:v', 'libx264',
      '-crf', '30',
      '-preset', 'ultrafast',
      '-vf', 'scale=w=-2:h=\'min(1280,ih)\'',
      '-c:a', 'aac',
      '-b:a', '96k',
      '-movflags', '+faststart',
    ]
  } else {
    const duration = await getVideoDuration(inputPath)
    if (duration && duration > 0) {
      const AUDIO_BPS = 128 * 1024
      // 5% safety margin for container overhead so we don't overshoot.
      const totalBudget = targetMB * 1024 * 1024 * 8 * 0.95
      const videoBps = Math.floor((totalBudget - AUDIO_BPS * duration) / duration)
      const videoK = Math.max(800, Math.floor(videoBps / 1024))
      console.log(`[Compress] duration=${duration.toFixed(1)}s → video ${videoK}kbps for ${targetMB}MB target`)
      videoOpts = [
        '-c:v', 'libx264',
        '-b:v', `${videoK}k`,
        '-maxrate', `${Math.floor(videoK * 1.15)}k`,
        '-bufsize', `${videoK * 2}k`,
        // ultrafast preset: ~3x faster than veryfast on shared serverless CPUs.
        // Since we're targeting a specific bitrate, the file size comes out the
        // same — we just spend less CPU time on compression-ratio optimizations.
        // Quality difference is imperceptible for phone-screen IG viewing.
        '-preset', 'ultrafast',
        // Cap at 1080p height. No-op for phone video (already 1080p), saves
        // time if source was exported at 4K by accident.
        '-vf', 'scale=w=-2:h=\'min(1920,ih)\'',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
      ]
    } else {
      // Couldn't probe duration — fall back to CRF pass
      console.log(`[Compress] duration probe failed, falling back to CRF 26`)
      videoOpts = [
        '-c:v', 'libx264',
        '-crf', '26',
        '-preset', 'ultrafast',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
      ]
    }
  }

  // Use execFile directly instead of fluent-ffmpeg. fluent-ffmpeg can deadlock
  // on serverless when stdout/stderr pipes aren't drained, which was causing
  // 5-minute hangs that hit maxDuration. execFile with a hard 120s timeout is
  // what the frame extractor uses reliably.
  await new Promise((resolve, reject) => {
    const args = ['-y', '-i', inputPath, ...videoOpts, outputPath]
    execFile(ffmpegStatic, args, { timeout: 120000, maxBuffer: 50 * 1024 * 1024 }, (err) => {
      if (err) reject(err)
      else resolve()
    })
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
const TELEGRAM_SMM_GROUP_CHAT_ID = process.env.TELEGRAM_SMM_GROUP_CHAT_ID

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // 50MB Telegram bot upload limit

function rawDropboxUrl(url) {
  if (!url) return ''
  const clean = url.replace(/[?&]dl=0/, '').replace(/[?&]raw=1/, '')
  return clean + (clean.includes('?') ? '&raw=1' : '?raw=1')
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

async function telegramUpload(method, form, { signal } = {}) {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`, {
    method: 'POST',
    body: form,
    signal,
  })
  const data = await res.json()
  if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description}`)
  return data
}

async function telegramJson(method, body, { signal } = {}) {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const data = await res.json()
  if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description}`)
  return data
}

// The actual send work: download from Dropbox → remux/compress if needed →
// upload to Telegram → stamp Post record. Runs entirely in the background
// via waitUntil() so the admin's click returns in ~1s instead of 60-90s.
async function doSend(params) {
  const { editedFileLink, threadId, smmTopicId, caption, taskName, postId, thumbnailUrl, assetId, rawCaption, rawHashtags, platform, scheduledDate } = params

  try {
    const rawUrl = rawDropboxUrl(editedFileLink)
    // SMM mode: route to per-account topic in the SMM master group instead
    // of the creator's review thread. Topic ID > thread ID when both present.
    const useSmm = !!smmTopicId
    const chatId = useSmm ? parseInt(TELEGRAM_SMM_GROUP_CHAT_ID) : parseInt(TELEGRAM_CHAT_ID)
    const messageThreadId = useSmm ? smmTopicId : threadId

    const ext = (getFilename(editedFileLink).split('.').pop() || '').toLowerCase()
    const needsRemux = isVideo(editedFileLink) && ext !== 'mp4'

    let result = null

    // Skip URL method entirely. Previously we tried to have Telegram fetch the
    // file directly from Dropbox via URL, which was fast for small files but
    // hangs unreliably for 50MB+ files (Telegram holds our HTTP connection
    // open while their internal fetch struggles, and Node's fetch AbortController
    // doesn't reliably terminate those stalled connections on Vercel). Result:
    // 5-minute hangs that eat the whole function budget.
    //
    // Going straight to download+compress(if needed)+upload is more predictable:
    // always <90s, always has observable logs, no dependency on Telegram's
    // URL-fetcher reliability.

    if (!result) {
      // Download from Dropbox and upload directly to Telegram
      const dlStart = Date.now()
      console.log('[Telegram Send] Downloading file from Dropbox...')
      const fileRes = await fetch(rawUrl)
      if (!fileRes.ok) throw new Error(`Failed to download file from Dropbox: ${fileRes.status}`)
      const fileBuffer = await fileRes.arrayBuffer()
      const fileSize = fileBuffer.byteLength
      const dlSec = ((Date.now() - dlStart) / 1000).toFixed(1)
      console.log(`[Telegram Send] Downloaded ${(fileSize / 1024 / 1024).toFixed(1)}MB in ${dlSec}s`)

      // Upload directly to Telegram as multipart
      const form = new FormData()
      form.append('chat_id', String(chatId))
      form.append('message_thread_id', String(messageThreadId))
      if (caption) form.append('caption', caption)

      const filename = getFilename(editedFileLink)
      const mimeType = getMimeType(editedFileLink)

      // Remux non-MP4 videos to MP4 with faststart for Telegram inline preview.
      // Normalize to Node Buffer up front so .length is consistent downstream —
      // fileBuffer is an ArrayBuffer (has .byteLength not .length), and ArrayBuffer.length
      // silently returns undefined, which meant our size check below was comparing
      // undefined > MAX_UPLOAD_BYTES → false → compression never fired.
      let uploadBuffer = Buffer.from(fileBuffer)
      let uploadFilename = filename
      let uploadMime = mimeType
      const fileExt = (filename.split('.').pop() || '').toLowerCase()
      if (isVideo(editedFileLink) && fileExt !== 'mp4') {
        console.log(`[Telegram Send] Remuxing ${ext} to MP4 with faststart...`)
        uploadBuffer = await remuxToMp4(fileBuffer, filename)
        uploadFilename = filename.replace(/\.[^.]+$/, '.mp4')
        uploadMime = 'video/mp4'
        console.log(`[Telegram Send] Remux done, size: ${(uploadBuffer.length / 1024 / 1024).toFixed(1)}MB`)
      } else if (isVideo(editedFileLink)) {
        uploadMime = 'video/mp4'
      }

      // Compress if file exceeds Telegram's 50MB bot limit.
      // Uses target-bitrate compression — for files barely over, this is
      // an ~8% bitrate shave (visually indistinguishable). For files 2x+
      // over, falls through to aggressive (720p cap + CRF 30).
      if (uploadBuffer.length > MAX_UPLOAD_BYTES && isVideo(editedFileLink)) {
        const origMB = (uploadBuffer.length / 1024 / 1024).toFixed(1)
        console.log(`[Telegram Send] ${origMB}MB exceeds 50MB — compressing to fit...`)
        try {
          const compressStart = Date.now()
          const compressed = await compressVideo(uploadBuffer, uploadFilename, { targetMB: 47 })
          const compMB = (compressed.length / 1024 / 1024).toFixed(1)
          const compressElapsed = ((Date.now() - compressStart) / 1000).toFixed(1)
          console.log(`[Telegram Send] Compressed to ${compMB}MB in ${compressElapsed}s`)

          if (compressed.length > MAX_UPLOAD_BYTES) {
            console.log(`[Telegram Send] Still too big, retrying with aggressive mode...`)
            const aggressive = await compressVideo(uploadBuffer, uploadFilename, { aggressive: true })
            const aggMB = (aggressive.length / 1024 / 1024).toFixed(1)
            console.log(`[Telegram Send] Aggressive compress: ${aggMB}MB`)
            if (aggressive.length > MAX_UPLOAD_BYTES) {
              throw new Error(`File too large. Source ${origMB}MB, best we could compress was ${aggMB}MB — still over Telegram's 50MB bot limit. Re-export a shorter clip or lower resolution.`)
            }
            uploadBuffer = aggressive
          } else {
            uploadBuffer = compressed
          }
          uploadFilename = uploadFilename.replace(/\.[^.]+$/, '.mp4')
          uploadMime = 'video/mp4'
        } catch (compErr) {
          console.error('[Telegram Send] Compression failed:', compErr.message)
          throw new Error(`File is ${origMB}MB (over 50MB Telegram limit) and auto-compression failed: ${compErr.message}`)
        }
      } else if (uploadBuffer.length > MAX_UPLOAD_BYTES) {
        // Non-video file over 50MB — can't compress
        throw new Error(`File too large (${(uploadBuffer.length / 1024 / 1024).toFixed(0)}MB). Telegram limit is 50MB for non-video files.`)
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
          fallbackForm.append('message_thread_id', String(messageThreadId))
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
          fallbackForm.append('message_thread_id', String(messageThreadId))
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

    // Mark the thumbnail asset as used (only now that it's genuinely being
    // sent out). The Post record holds the thumbnail as an attachment URL —
    // look up the source Asset record by matching its Dropbox Shared Link.
    // Non-fatal: if lookup fails, the send itself still succeeded.
    if (thumbnailUrl) {
      try {
        // Strip query params (raw=1 etc.) and any trailing quotes for a clean substring match
        const cleanUrl = thumbnailUrl.split('?')[0].replace(/["']/g, '')
        const matches = await fetchAirtableRecords('Assets', {
          filterByFormula: `FIND('${cleanUrl.replace(/'/g, "\\'")}', {Dropbox Shared Link})`,
          fields: ['Dropbox Shared Link', 'Used As Reel Thumbnail'],
        })
        for (const a of matches) {
          if (a.fields?.['Used As Reel Thumbnail']) continue
          await patchAirtableRecord('Assets', a.id, { 'Used As Reel Thumbnail': true })
          console.log(`[Telegram Send] Marked thumbnail asset ${a.id} as used`)
        }
      } catch (thumbErr) {
        console.warn('[Telegram Send] Could not mark thumbnail as used (non-fatal):', thumbErr.message)
      }
    }

    console.log('[Telegram Send] ✓ Complete for post', postId)
  } catch (err) {
    console.error('[Telegram Send] Background send failed:', err.message)
    // Surface failure to the UI via a Post status update so the admin sees it
    if (postId) {
      await patchAirtableRecord('Posts', postId, {
        'Status': 'Send Failed',
        'Admin Notes': `[Telegram Send Error @ ${new Date().toISOString()}] ${err.message}`,
      }).catch(() => {})
    }
  }
}

// Public endpoint — validates the request, marks the Post as "Sending",
// kicks off the actual work via waitUntil(), and returns in ~1s.
// The admin sees the modal close immediately; the Post card flips from
// "Prepping" → "Sending" → "Sent to Telegram" (or "Send Failed") as the
// background job progresses. UI polls Post status to know when it's done.
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const params = await request.json()
    const { editedFileLink, threadId, smmTopicId, postId, rawCaption, rawHashtags, platform, scheduledDate } = params

    if (!editedFileLink) return NextResponse.json({ error: 'No edited file link' }, { status: 400 })
    if (!threadId && !smmTopicId) return NextResponse.json({ error: 'No threadId or smmTopicId provided' }, { status: 400 })
    if (!TELEGRAM_TOKEN) return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 })
    if (smmTopicId && !TELEGRAM_SMM_GROUP_CHAT_ID) {
      return NextResponse.json({ error: 'TELEGRAM_SMM_GROUP_CHAT_ID not set' }, { status: 500 })
    }
    if (!smmTopicId && !TELEGRAM_CHAT_ID) {
      return NextResponse.json({ error: 'TELEGRAM_CHAT_ID not set' }, { status: 500 })
    }

    // Stamp the Post immediately so the UI can show "Sending" without waiting
    // for the actual Telegram upload to finish. Also save any user-edited
    // caption/hashtags/platform/date now (rather than after send) so a refresh
    // during the background job shows the correct data.
    if (postId) {
      await patchAirtableRecord('Posts', postId, {
        'Status': 'Sending',
        ...(rawCaption ? { 'Caption': rawCaption } : {}),
        ...(rawHashtags ? { 'Hashtags': rawHashtags } : {}),
        ...(platform?.length ? { 'Platform': platform } : {}),
        ...(scheduledDate ? { 'Scheduled Date': scheduledDate } : {}),
      }).catch(err => console.warn('[Telegram Send] Pre-send Post update failed:', err.message))
    }

    // Fire and forget. Vercel's waitUntil() keeps the function running up to
    // maxDuration (300s) after the response has been sent, so download + ffmpeg
    // + upload continue in the background while the client already got a 200.
    console.log('[Telegram Send] Queued for post', postId)
    waitUntil(doSend(params))

    return NextResponse.json({ ok: true, status: 'sending', postId })
  } catch (err) {
    console.error('[Telegram Send] Queue error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
