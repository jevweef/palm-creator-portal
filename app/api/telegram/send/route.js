export const dynamic = 'force-dynamic'
// Pro Fluid Compute ceiling is 800s (was 300s for classic functions).
// Uncompressed-asset worst case: 15s download + 200s libx264 ultrafast +
// 10s upload + Telegram retry buffer was hitting 300s exactly and 504-ing
// mid-upload, leaving Posts stuck at Status='Sending'. 800 gives ~13 min
// of headroom. Requires Fluid Compute toggled on in the Vercel project.
export const maxDuration = 800

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { requireAdmin, patchAirtableRecord, fetchAirtableRecords } from '@/lib/adminAuth'
import ffmpegStatic from 'ffmpeg-static'
import ffmpeg from 'fluent-ffmpeg'
import sharp from 'sharp'
import { writeFile, readFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { quoteAirtableString } from '@/lib/airtableFormula'

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
// Resize thumbnail for Telegram (max 1280px). Uses sharp first because it
// reliably honors EXIF orientation (.rotate() with no args reads the tag,
// applies the rotation to the pixels, and strips the tag from the output).
// ffmpeg's image decoder is inconsistent with EXIF — that's what was causing
// SMM's sideways thumbnail complaints. Falls back to ffmpeg for HEIC/HEIF
// (sharp's default build doesn't include libheif).
async function resizeImage(inputBuffer, inputName) {
  const inputBuf = Buffer.from(inputBuffer)
  const rawExt = (inputName.split('.').pop() || '').toLowerCase()
  const isHeic = rawExt === 'heic' || rawExt === 'heif'

  // sharp path — JPEG/PNG/WEBP/GIF/BMP/TIFF.
  if (!isHeic) {
    try {
      return await sharp(inputBuf)
        .rotate()  // Auto-rotate per EXIF, strip orientation tag
        .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90, mozjpeg: false })
        .toBuffer()
    } catch (e) {
      // Fall through to ffmpeg on any sharp failure — defensive in case
      // the bytes are something exotic sharp can't open.
      console.warn('[resizeImage] sharp failed, falling back to ffmpeg:', e.message)
    }
  }

  // ffmpeg fallback — handles HEIC, and catches anything sharp couldn't.
  // For HEIC, the heif decoder pre-rotates during decode so the output JPEG
  // is in display orientation. For other formats, this path is best-effort
  // and may not respect EXIF — sharp should have caught those above.
  const id = Date.now()
  const knownExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'heic', 'heif']
  const ext = knownExts.includes(rawExt) ? rawExt : 'jpg'
  const inputPath = join(tmpdir(), `tg_img_in_${id}.${ext}`)
  const outputPath = join(tmpdir(), `tg_img_out_${id}.jpg`)
  await writeFile(inputPath, inputBuf)
  await new Promise((resolve, reject) => {
    const args = [
      '-y', '-i', inputPath,
      '-vf', 'scale=1280:1280:force_original_aspect_ratio=decrease',
      '-frames:v', '1',
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

// Resize a thumbnail to Telegram's HARD limits for an embedded video poster:
// JPEG, max 320×320, < 200KB. (core.telegram.org/bots/api — InputMediaVideo /
// sendVideo `thumbnail`.) This is DIFFERENT from resizeImage() above, which
// produces a full ≤1280px photo for standalone sendPhoto. We were previously
// attaching a 1280px thumbnail as the video poster — 4× over the 320px cap —
// so Telegram SILENTLY IGNORED it on every reel and the video showed no cover.
// Steps quality down until under 200KB so even a busy frame fits.
async function resizeThumbnail(inputBuffer, inputName) {
  const inputBuf = Buffer.from(inputBuffer)
  const rawExt = (inputName.split('.').pop() || '').toLowerCase()
  const isHeic = rawExt === 'heic' || rawExt === 'heif'
  const TG_THUMB_MAX_PX = 320
  const TG_THUMB_MAX_BYTES = 200 * 1024

  const encodeAt = async (quality) =>
    sharp(inputBuf)
      .rotate() // honor EXIF, strip the tag
      .resize(TG_THUMB_MAX_PX, TG_THUMB_MAX_PX, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: false })
      .toBuffer()

  if (!isHeic) {
    try {
      for (const q of [80, 65, 50, 40]) {
        const out = await encodeAt(q)
        if (out.length <= TG_THUMB_MAX_BYTES) return out
      }
      // Even at q40 it's somehow >200KB (very rare at ≤320px) — return the
      // smallest we have; Telegram will ignore it but the video still sends.
      return await encodeAt(40)
    } catch (e) {
      console.warn('[resizeThumbnail] sharp failed, falling back to ffmpeg:', e.message)
    }
  }

  // ffmpeg fallback (HEIC, or anything sharp choked on).
  const id = Date.now()
  const knownExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'heic', 'heif']
  const ext = knownExts.includes(rawExt) ? rawExt : 'jpg'
  const inputPath = join(tmpdir(), `tg_thumb_in_${id}.${ext}`)
  const outputPath = join(tmpdir(), `tg_thumb_out_${id}.jpg`)
  await writeFile(inputPath, inputBuf)
  await new Promise((resolve, reject) => {
    const args = [
      '-y', '-i', inputPath,
      '-vf', 'scale=320:320:force_original_aspect_ratio=decrease',
      '-frames:v', '1', '-q:v', '5',
      outputPath,
    ]
    execFile(ffmpegStatic, args, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }, (err) => {
      if (err) reject(err); else resolve()
    })
  })
  const outputBuffer = await readFile(outputPath)
  await unlink(inputPath).catch(() => {})
  await unlink(outputPath).catch(() => {})
  return outputBuffer
}

// Probe a video by parsing `ffmpeg -i` stderr (ffprobe isn't in ffmpeg-static).
// Returns { duration, width, height, codec, pixFmt } — any field may be null
// if parsing fails. We pass width/height/duration to sendVideo so Telegram
// renders an inline player with a poster instead of a "00:00 · N MB · file"
// document tile, and we use codec/pixFmt to decide remux vs re-encode.
async function probeVideo(filePath) {
  let stderr = ''
  try {
    await execFilePromise(ffmpegStatic, ['-i', filePath], { timeout: 15000 })
  } catch (err) {
    stderr = err.stderr || ''
  }
  if (!stderr) return { duration: null, width: null, height: null, codec: null, pixFmt: null }

  let duration = null
  const dm = stderr.match(/Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (dm) duration = Math.round(parseInt(dm[1]) * 3600 + parseInt(dm[2]) * 60 + parseFloat(dm[3]))

  // Video stream line, e.g.:
  //   Stream #0:0(und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 1080x1920 [SAR 1:1 DAR 9:16], ...
  const vLine = (stderr.split('\n').find(l => /Stream #\d+:\d+.*Video:/.test(l)) || '')
  const codec = (vLine.match(/Video:\s*([a-z0-9]+)/i)?.[1] || '').toLowerCase() || null
  const pixFmt = (vLine.match(/,\s*(yuv[a-z0-9]+|nv12|gbrp[a-z0-9]*|rgb[a-z0-9]*)\b/i)?.[1] || '').toLowerCase() || null
  const dim = vLine.match(/,\s*(\d{2,5})x(\d{2,5})/)
  const width = dim ? parseInt(dim[1]) : null
  const height = dim ? parseInt(dim[2]) : null

  return { duration, width, height, codec, pixFmt }
}

// Decide whether a probed video must be RE-ENCODED (not just remuxed) for
// Telegram to inline-play it. Telegram reliably inlines ONLY 8-bit H.264 in
// yuv420p (HEVC/H.265, VP9, 10-bit, and 4:2:2/4:4:4 chroma render as a
// downloadable file with no thumbnail). If we can't determine the codec we
// re-encode to be safe — better a slow correct send than a silent document.
function videoNeedsReencode(probe) {
  if (!probe || !probe.codec) return true // unknown → normalize defensively
  if (probe.codec !== 'h264') return true
  if (probe.pixFmt && probe.pixFmt !== 'yuv420p') return true
  return false
}

// Best-effort stringify for an error stamped into Airtable. Plain Error →
// .message; anything else → JSON. Fixes the "[object Object]" Send Error rows
// that gave operators nothing to act on.
function errToString(err) {
  if (!err) return 'Unknown error'
  if (typeof err === 'string') return err
  if (err.message) return err.message
  try { return JSON.stringify(err) } catch { return String(err) }
}

// MOV → MP4, fast container swap (`-c copy`, no re-encode).
//
// REVERTED 2026-05-17: briefly changed to a full libx264 re-encode to bake
// rotation tags into pixels (phones embed "rotate 90°" metadata that
// Telegram/Android IG ignore). That re-encode was 5-10x slower on the
// inline send path and blew the 300s function budget for non-pre-compressed
// videos → every send timed out → posts stuck at 'Sending' → queue jammed.
// Rotation baking still happens in compressVideo() (which already
// re-encodes via libx264, so it's free there and covers any video large
// enough to need compression). Small MOVs that only get remuxed keep
// their rotation tag — acceptable tradeoff vs. a fully jammed queue.
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
      '-metadata:s:v:0', 'rotate=0',  // strip rotation tag (libx264 already rotated pixels)
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
        '-metadata:s:v:0', 'rotate=0',  // strip rotation tag (libx264 already rotated pixels)
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
        '-metadata:s:v:0', 'rotate=0',  // strip rotation tag (libx264 already rotated pixels)
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

// Re-encode ANY video into the Telegram inline-streamable contract:
// 8-bit H.264 (yuv420p) + AAC + faststart, capped at 1080p with even
// dimensions and rotation baked into the pixels. Used ONLY when probeVideo
// says the source isn't already conforming (HEVC, 10-bit, VP9, unknown) —
// conforming files take the fast remux path instead. ultrafast preset keeps
// this well under the function budget for normal reel lengths.
async function normalizeVideo(inputBuffer, inputName) {
  const id = Date.now()
  const ext = (inputName.split('.').pop() || 'mp4').toLowerCase()
  const inputPath = join(tmpdir(), `tg_norm_in_${id}.${ext}`)
  const outputPath = join(tmpdir(), `tg_norm_out_${id}.mp4`)
  await writeFile(inputPath, Buffer.from(inputBuffer))
  await new Promise((resolve, reject) => {
    const args = [
      '-y', '-i', inputPath,
      '-map', '0:v:0', '-map', '0:a:0?', // first video + optional audio (audioless reels ok)
      '-c:v', 'libx264',
      '-profile:v', 'high', '-level', '4.1',
      '-pix_fmt', 'yuv420p',
      '-preset', 'ultrafast',
      '-crf', '23',
      // ≤1080p, never upscale, force even W/H (libx264 + yuv420p require it)
      '-vf', "scale='min(1080,iw)':'min(1920,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2",
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
      '-metadata:s:v:0', 'rotate=0', // libx264 bakes rotation; clear the tag
      '-movflags', '+faststart',
      outputPath,
    ]
    execFile(ffmpegStatic, args, { timeout: 240000, maxBuffer: 50 * 1024 * 1024 }, (err) => {
      if (err) reject(err); else resolve()
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
    filterByFormula: `RECORD_ID() = ${quoteAirtableString(assetId)}`,
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

// Parse Telegram's "Too Many Requests: retry after N" 429 description and
// wait for that many seconds before letting the caller retry. Returns the
// number of seconds slept, or null if this wasn't a rate-limit response.
async function handleRateLimit(data) {
  if (!data) return null
  // Telegram returns parameters.retry_after on 429s, but we've also seen the
  // info only in the description. Parse both.
  const retryFromParams = data.parameters?.retry_after
  const retryFromDesc = data.description?.match(/retry after (\d+)/)?.[1]
  const retrySeconds = parseInt(retryFromParams ?? retryFromDesc ?? '', 10)
  if (!Number.isFinite(retrySeconds) || retrySeconds <= 0) return null
  // Cap at 60s — if Telegram says wait longer, surface as a normal error so
  // the user sees it rather than silently hanging the function for minutes.
  const waitMs = Math.min(retrySeconds, 60) * 1000 + 500 // small buffer
  console.warn(`[Telegram] Rate limited; sleeping ${waitMs}ms before retry`)
  await new Promise(r => setTimeout(r, waitMs))
  return retrySeconds
}

async function telegramUpload(method, form, { signal } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`, {
      method: 'POST',
      body: form,
      signal,
    })
    const data = await res.json()
    if (data.ok) return data
    if (res.status === 429 || /too many requests/i.test(data.description || '')) {
      const slept = await handleRateLimit(data)
      if (slept) continue
    }
    throw new Error(`Telegram ${method} failed: ${data.description}`)
  }
  throw new Error(`Telegram ${method} failed: rate limit exceeded after 3 retries`)
}

async function telegramJson(method, body, { signal } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    const data = await res.json()
    if (data.ok) return data
    if (res.status === 429 || /too many requests/i.test(data.description || '')) {
      const slept = await handleRateLimit(data)
      if (slept) continue
    }
    throw new Error(`Telegram ${method} failed: ${data.description}`)
  }
  throw new Error(`Telegram ${method} failed: rate limit exceeded after 3 retries`)
}

// Build a "📅 Fri, Apr 25 · Morning" prefix from a scheduled-date ISO.
// Uses ET hour < 14 = Morning, otherwise Evening (matches SLOT_HOURS_ET).
function buildDatePrefix(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const fmt = (opts) => new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'America/New_York' }).format(d)
  const dow = fmt({ weekday: 'short' })
  const monthDay = fmt({ month: 'short', day: 'numeric' })
  const etHour = parseInt(fmt({ hour: '2-digit', hour12: false }))
  const slotLabel = etHour < 14 ? 'Morning' : 'Evening'
  return `📅 ${dow}, ${monthDay} · ${slotLabel}`
}

// The actual send work: download from Dropbox → remux/compress if needed →
// upload to Telegram → stamp Post record. Runs entirely in the background
// via waitUntil() so the admin's click returns in ~1s instead of 60-90s.
// Carousel send: multi-photo sendMediaGroup. Each photo is downloaded
// (parallel) from its CDN/Dropbox URL and uploaded to Telegram as part of
// a single album. Caption rides on the first photo only — Telegram shows
// it under the swipeable group. No video compression, no thumbnail asset
// cleanup (carousels don't use the reel thumbnail pool).
async function doCarouselSend(params) {
  const { photos, threadId, smmTopicId, caption: rawIncomingCaption, postId, rawCaption, rawHashtags, platform, scheduledDate } = params
  const caption = rawIncomingCaption || undefined

  try {
    const useSmm = !!smmTopicId
    const chatId = useSmm ? parseInt(TELEGRAM_SMM_GROUP_CHAT_ID) : parseInt(TELEGRAM_CHAT_ID)
    const messageThreadId = useSmm ? smmTopicId : threadId

    console.log(`[Telegram Send] Carousel: downloading ${photos.length} photo${photos.length === 1 ? '' : 's'}...`)
    const dlStart = Date.now()
    const downloads = await Promise.all(photos.map(async (p, idx) => {
      const url = p.cdnUrl || (p.dropboxLink ? rawDropboxUrl(p.dropboxLink) : null)
      if (!url) throw new Error(`Photo ${idx + 1} (id=${p.id}) has no CDN URL or Dropbox link`)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Photo ${idx + 1} download failed: ${res.status}`)
      const buf = await res.arrayBuffer()
      // Resize/orient via sharp for Telegram (max 1280px, strips EXIF rotation
      // so portrait shots from creator uploads don't show sideways).
      const filename = (p.name || `photo_${idx + 1}.jpg`).replace(/[^\w.\-]+/g, '_')
      const resized = await resizeImage(buf, filename)
      return { buffer: resized, filename: `slide_${idx + 1}.jpg`, mime: 'image/jpeg' }
    }))
    console.log(`[Telegram Send] Carousel: ${photos.length} photos ready in ${((Date.now() - dlStart) / 1000).toFixed(1)}s`)

    const form = new FormData()
    form.append('chat_id', String(chatId))
    form.append('message_thread_id', String(messageThreadId))

    const mediaGroup = downloads.map((d, idx) => ({
      type: 'photo',
      media: `attach://photo_${idx}`,
      ...(idx === 0 && caption ? { caption } : {}),
    }))
    form.append('media', JSON.stringify(mediaGroup))
    for (let i = 0; i < downloads.length; i++) {
      const d = downloads[i]
      form.append(`photo_${i}`, new Blob([d.buffer], { type: d.mime }), d.filename)
    }

    const result = await telegramUpload('sendMediaGroup', form)

    // sendMediaGroup returns an array of messages, one per photo. Store all
    // IDs comma-separated so bulk-unsend can delete every slide, not just
    // the first.
    const messageIds = Array.isArray(result.result)
      ? result.result.map(m => m?.message_id).filter(Boolean).join(',')
      : (result.result?.message_id ? String(result.result.message_id) : '')

    if (postId) {
      await patchAirtableRecord('Posts', postId, {
        'Status': 'Sent to Telegram',
        'Telegram Sent At': new Date().toISOString(),
        ...(messageIds ? { 'Telegram Message ID': messageIds } : {}),
        ...(rawCaption ? { 'Caption': rawCaption } : {}),
        ...(rawHashtags ? { 'Hashtags': rawHashtags } : {}),
        ...(platform?.length ? { 'Platform': platform } : {}),
        ...(scheduledDate ? { 'Scheduled Date': scheduledDate } : {}),
      }).catch(err => console.error('[Telegram Send] Failed to update carousel Post:', err.message))
    }

    console.log(`[Telegram Send] ✓ Carousel complete for post ${postId} (${photos.length} slides, ${messageIds.split(',').length} TG messages)`)
  } catch (err) {
    console.error('[Telegram Send] Carousel send failed:', err.message)
    if (postId) {
      await patchAirtableRecord('Posts', postId, {
        'Status': 'Send Failed',
        'Admin Notes': `[Carousel Send Error @ ${new Date().toISOString()}] ${err.message}`,
      }).catch(() => {})
    }
    throw err
  }
}

async function doSend(params) {
  // Idempotent re-entry guard. Any caller that retries — queue redelivery,
  // a 504-then-reclaim by the stale-lock sweeper, a double-clicked Send
  // button — would otherwise hit Telegram a second time. Skip when the
  // Post is already marked Sent AND we have its Telegram Message ID to
  // prove the prior call actually landed. (Status alone isn't enough: a
  // future "manual retry" flow may flip back to Queued; require both.)
  if (params.postId) {
    try {
      const existing = await fetchAirtableRecords('Posts', {
        filterByFormula: `RECORD_ID() = ${quoteAirtableString(params.postId)}`,
        fields: ['Status', 'Telegram Message ID'],
      })
      const f = existing[0]?.fields || {}
      const statusName = typeof f.Status === 'string' ? f.Status : (f.Status?.name || '')
      if (statusName === 'Sent to Telegram' && f['Telegram Message ID']) {
        console.log(`[Telegram Send] Skipping ${params.postId} — already Sent with Message ID ${f['Telegram Message ID']}`)
        return { ok: true, skipped: true, reason: 'already-sent' }
      }
    } catch (err) {
      // Guard fetch failure shouldn't block the send — fall through and let
      // the normal path run. Worst case is the duplicate we were trying to
      // prevent, which is what the OLD behavior already was.
      console.warn('[Telegram Send] Idempotency guard fetch failed, proceeding:', err.message)
    }
  }

  // Branch by post type. Carousels need a completely different upload path
  // (sendMediaGroup with N photos, no video / no compression / no thumbnail
  // asset cleanup) so route them through doCarouselSend instead of trying
  // to shoehorn the reel happy-path.
  if (params.type === 'Carousel') {
    return doCarouselSend(params)
  }

  const { editedFileLink, threadId, smmTopicId, caption: rawIncomingCaption, taskName, postId, thumbnailUrl, thumbnailAssetId, assetId, rawCaption, rawHashtags, platform, scheduledDate } = params
  // Caption is just the user caption + hashtags (joined client-side into the
  // incoming caption). No date prefix — post-calendar architecture means
  // Scheduled Date is just an opaque ordering token, not a real post time,
  // so showing it to SMM is meaningless and misleading.
  const caption = rawIncomingCaption || undefined

  try {
    const rawUrl = rawDropboxUrl(editedFileLink)
    // SMM mode: route to per-account topic in the SMM master group instead
    // of the creator's review thread. Topic ID > thread ID when both present.
    const useSmm = !!smmTopicId
    const chatId = useSmm ? parseInt(TELEGRAM_SMM_GROUP_CHAT_ID) : parseInt(TELEGRAM_CHAT_ID)
    const messageThreadId = useSmm ? smmTopicId : threadId

    const ext = (getFilename(editedFileLink).split('.').pop() || '').toLowerCase()

    let result = null
    // Telegram message IDs from any SEPARATE follow-up message (the standalone
    // thumbnail photo). Merged into the comma-joined Telegram Message ID so
    // bulk-unsend deletes both the video and its cover.
    let extraMessageIds = []

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

      // Prepare a Telegram-friendly MP4. Normalize to a Node Buffer up front so
      // .length is consistent (fileBuffer is an ArrayBuffer — .length is
      // undefined, which once silently disabled the 50MB compression check).
      let uploadBuffer = Buffer.from(fileBuffer)
      let uploadFilename = filename
      let uploadMime = mimeType
      const fileExt = (filename.split('.').pop() || '').toLowerCase()
      // `probe` carries width/height/duration we hand to sendVideo so Telegram
      // renders an inline player (with a poster) instead of a "00:00 · N MB"
      // document tile. Scoped to the whole send block.
      let probe = { duration: null, width: null, height: null, codec: null, pixFmt: null }

      if (isVideo(editedFileLink)) {
        uploadMime = 'video/mp4'
        // Probe the source once (write to a temp file; ffprobe isn't bundled).
        const probeId = Date.now()
        const probePath = join(tmpdir(), `tg_probe_${probeId}.${fileExt || 'mp4'}`)
        await writeFile(probePath, uploadBuffer)
        probe = await probeVideo(probePath)
        await unlink(probePath).catch(() => {})
        console.log(`[Telegram Send] Probe: codec=${probe.codec} pix=${probe.pixFmt} ${probe.width}x${probe.height} dur=${probe.duration}s`)

        if (videoNeedsReencode(probe)) {
          // HEVC / 10-bit / VP9 / unknown — Telegram won't inline these. Re-encode
          // to the safe H.264/yuv420p/faststart contract (the ONLY reliable fix
          // for the "shows as a downloadable file, no thumbnail" symptom).
          console.log(`[Telegram Send] Re-encoding (codec=${probe.codec || '?'}, pix=${probe.pixFmt || '?'}) for inline playback...`)
          const reStart = Date.now()
          uploadBuffer = await normalizeVideo(uploadBuffer, filename)
          uploadFilename = filename.replace(/\.[^.]+$/, '.mp4')
          // Re-probe the OUTPUT so dimensions/duration match the sent pixels.
          const rePath = join(tmpdir(), `tg_reprobe_${probeId}.mp4`)
          await writeFile(rePath, uploadBuffer)
          probe = await probeVideo(rePath)
          await unlink(rePath).catch(() => {})
          console.log(`[Telegram Send] Re-encode done in ${((Date.now()-reStart)/1000).toFixed(1)}s → ${(uploadBuffer.length/1024/1024).toFixed(1)}MB ${probe.width}x${probe.height}`)
        } else if (fileExt !== 'mp4') {
          // Already conforming H.264/yuv420p but in a .mov/.webm container —
          // fast container swap to MP4 + faststart, no re-encode.
          console.log(`[Telegram Send] Remuxing ${fileExt} → MP4 (faststart, no re-encode)...`)
          uploadBuffer = await remuxToMp4(fileBuffer, filename)
          uploadFilename = filename.replace(/\.[^.]+$/, '.mp4')
          console.log(`[Telegram Send] Remux done, size: ${(uploadBuffer.length / 1024 / 1024).toFixed(1)}MB`)
        }
        // else: already a conforming MP4 — send as-is.
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

      if (isVideo(editedFileLink)) {
        // SEPARATE-MESSAGE send (no atomic media group). Build the video with
        // an embedded ≤320px poster + real width/height/duration so Telegram
        // renders an inline player, then — if a thumbnail exists — send it AGAIN
        // as its own standalone photo. This guarantees the cover is always
        // delivered even if Telegram still renders the video itself as a file,
        // and removes the album-atomicity failure (audioless reels reclassified
        // as "animation" can't go in sendMediaGroup and killed the whole album).
        let posterBuffer = null   // ≤320px JPEG, embedded video poster
        let photoBuffer = null    // ≤1280px JPEG, standalone cover photo
        if (thumbnailUrl) {
          try {
            const thumbRes = await fetch(rawDropboxUrl(thumbnailUrl))
            if (thumbRes.ok) {
              const rawThumb = await thumbRes.arrayBuffer()
              console.log(`[Telegram Send] Preparing thumbnail (${(rawThumb.byteLength / 1024 / 1024).toFixed(1)}MB source)...`)
              posterBuffer = await resizeThumbnail(rawThumb, getFilename(thumbnailUrl))
              photoBuffer = await resizeImage(rawThumb, getFilename(thumbnailUrl))
              console.log(`[Telegram Send] Poster ${(posterBuffer.length / 1024).toFixed(0)}KB (≤320px), cover photo ${(photoBuffer.length / 1024).toFixed(0)}KB`)
            } else {
              console.warn(`[Telegram Send] Thumbnail download failed (${thumbRes.status}); sending video without a cover`)
            }
          } catch (thumbPrepErr) {
            console.warn('[Telegram Send] Thumbnail prep failed (non-fatal):', thumbPrepErr.message)
          }
        }

        // 1) The video message — sendVideo with poster + dimensions/duration.
        const videoForm = new FormData()
        videoForm.append('chat_id', String(chatId))
        videoForm.append('message_thread_id', String(messageThreadId))
        if (caption) videoForm.append('caption', caption)
        videoForm.append('video', new Blob([uploadBuffer], { type: uploadMime }), uploadFilename)
        videoForm.append('supports_streaming', 'true')
        if (probe.width) videoForm.append('width', String(probe.width))
        if (probe.height) videoForm.append('height', String(probe.height))
        if (probe.duration) videoForm.append('duration', String(probe.duration))
        if (posterBuffer) videoForm.append('thumbnail', new Blob([posterBuffer], { type: 'image/jpeg' }), 'thumb.jpg')
        try {
          result = await telegramUpload('sendVideo', videoForm)
        } catch (vidErr) {
          console.warn('[Telegram Send] sendVideo failed, trying sendDocument:', vidErr.message)
          const docForm = new FormData()
          docForm.append('chat_id', String(chatId))
          docForm.append('message_thread_id', String(messageThreadId))
          if (caption) docForm.append('caption', caption)
          docForm.append('document', new Blob([uploadBuffer], { type: uploadMime }), uploadFilename)
          if (posterBuffer) docForm.append('thumbnail', new Blob([posterBuffer], { type: 'image/jpeg' }), 'thumb.jpg')
          result = await telegramUpload('sendDocument', docForm)
        }

        // 2) The standalone cover photo — NON-FATAL. The video already landed
        // (result is set); if this photo fails we must NOT fail the whole post.
        if (photoBuffer) {
          try {
            const photoForm = new FormData()
            photoForm.append('chat_id', String(chatId))
            photoForm.append('message_thread_id', String(messageThreadId))
            photoForm.append('photo', new Blob([photoBuffer], { type: 'image/jpeg' }), 'cover.jpg')
            const photoRes = await telegramUpload('sendPhoto', photoForm)
            const pid = photoRes?.result?.message_id
            if (pid) extraMessageIds.push(String(pid))
          } catch (photoErr) {
            console.warn('[Telegram Send] Standalone cover photo failed (non-fatal, video already sent):', photoErr.message)
          }
        }
      } else if (isPhoto(editedFileLink)) {
        form.append('photo', new Blob([fileBuffer], { type: mimeType }), filename)
        result = await telegramUpload('sendPhoto', form)
      } else {
        form.append('document', new Blob([fileBuffer], { type: mimeType }), filename)
        result = await telegramUpload('sendDocument', form)
      }
    }

    // Extract message IDs. The video send returns one message; carousels return
    // an array (sendMediaGroup). Merge in any standalone cover-photo ID so
    // bulk-unsend cleans up the video AND its cover.
    const baseIds = Array.isArray(result.result)
      ? result.result.map(m => m?.message_id).filter(Boolean).map(String)
      : (result.result?.message_id ? [String(result.result.message_id)] : [])
    const messageIds = [...baseIds, ...extraMessageIds].join(',')

    // Stamp the Post record — also save caption/hashtags/platform/date in case
    // user didn't Save first. Clear any stale Send Error: this post DID land,
    // so a leftover error from an earlier timed-out attempt must not linger and
    // make a sent post look failed in the grid.
    if (postId) {
      await patchAirtableRecord('Posts', postId, {
        'Status': 'Sent to Telegram',
        'Telegram Sent At': new Date().toISOString(),
        'Send Error': '',
        ...(messageIds ? { 'Telegram Message ID': messageIds } : {}),
        ...(rawCaption ? { 'Caption': rawCaption } : {}),
        ...(rawHashtags ? { 'Hashtags': rawHashtags } : {}),
        ...(platform?.length ? { 'Platform': platform } : {}),
        ...(scheduledDate ? { 'Scheduled Date': scheduledDate } : {}),
      }).catch(err => console.error('[Telegram Send] Failed to update Post record:', err.message))
    }

    // Move file to 50_POSTED_ARCHIVE in Dropbox. This is the single
    // canonical move-on-send: regardless of which sibling Post fires the
    // send first, the asset's underlying file ends up in the archive.
    // Subsequent siblings hit moveToNextStage and find the file already
    // in 50_POSTED_ARCHIVE → "Path did not change" warning, no-op move.
    if (assetId) {
      moveToNextStage(assetId, '50_POSTED_ARCHIVE').catch(err =>
        console.error('[Telegram Send] Dropbox move failed (non-fatal):', err.message)
      )
    }

    // Post-send Asset cleanup for the thumbnail:
    //   - Used As Reel Thumbnail → true (hides from Choose Thumbnail picker
    //     and Approve Thumbnails modal going forward)
    //   - Approved Thumbnail → false (removes the tile from the creator's
    //     Thumbnail Pool tray so SMM doesn't see it as a fresh option)
    //
    // PRIMARY path: thumbnailAssetId — the exact source Asset record ID,
    // recorded by applyThumbnail / autoFillThumbnails when a pool tile was
    // applied. Deterministic, can't miss. This is THE fix for the whole
    // "used thumbnails won't leave the pool" saga.
    //
    // FALLBACK path: filename match against {Dropbox Shared Link}, for
    // legacy posts (sent before the Thumbnail Asset field existed) or
    // thumbnails set outside the pool flow. Best-effort — the Airtable
    // signed URL ends in a token not a filename, so this misses a lot;
    // that's exactly why the deterministic path above exists.
    //
    // Non-fatal: if cleanup fails, the send itself still succeeded.
    try {
      if (thumbnailAssetId) {
        const recs = await fetchAirtableRecords('Assets', {
          filterByFormula: `RECORD_ID() = ${quoteAirtableString(thumbnailAssetId)}`,
          fields: ['Used As Reel Thumbnail', 'Approved Thumbnail'],
        })
        const a = recs[0]
        if (a) {
          const alreadyUsed = !!a.fields?.['Used As Reel Thumbnail']
          const stillInPool = !!a.fields?.['Approved Thumbnail']
          if (!alreadyUsed || stillInPool) {
            const patch = {}
            if (!alreadyUsed) patch['Used As Reel Thumbnail'] = true
            if (stillInPool) patch['Approved Thumbnail'] = false
            await patchAirtableRecord('Assets', thumbnailAssetId, patch)
            console.log(`[Telegram Send] Asset ${thumbnailAssetId} thumb cleanup via Thumbnail Asset: ${JSON.stringify(patch)}`)
          }
        } else {
          console.warn(`[Telegram Send] Thumbnail Asset ${thumbnailAssetId} not found — skipping cleanup`)
        }
      } else if (thumbnailUrl) {
        // Legacy fallback — filename match (lossy, see comment above).
        const rawFilename = thumbnailUrl.split('?')[0].split('/').pop() || ''
        const filename = decodeURIComponent(rawFilename)
        if (filename) {
          const safeFilename = filename.replace(/'/g, "\\'")
          const matches = await fetchAirtableRecords('Assets', {
            filterByFormula: `FIND('${safeFilename}', {Dropbox Shared Link})`,
            fields: ['Dropbox Shared Link', 'Used As Reel Thumbnail', 'Approved Thumbnail'],
          })
          for (const a of matches) {
            const alreadyUsed = !!a.fields?.['Used As Reel Thumbnail']
            const stillInPool = !!a.fields?.['Approved Thumbnail']
            if (alreadyUsed && !stillInPool) continue
            const patch = {}
            if (!alreadyUsed) patch['Used As Reel Thumbnail'] = true
            if (stillInPool) patch['Approved Thumbnail'] = false
            await patchAirtableRecord('Assets', a.id, patch)
            console.log(`[Telegram Send] Asset ${a.id} thumb cleanup via filename: ${JSON.stringify(patch)} (filename=${filename})`)
          }
        }
      }
    } catch (thumbErr) {
      console.warn('[Telegram Send] Could not run thumbnail cleanup (non-fatal):', thumbErr.message)
    }

    console.log('[Telegram Send] ✓ Complete for post', postId)
  } catch (err) {
    const msg = errToString(err)
    console.error('[Telegram Send] Background send failed:', msg)
    // Surface failure to the UI via a Post status update so the admin sees it.
    // errToString avoids the "[object Object]" Send Error rows we saw when a
    // non-Error value was thrown.
    if (postId) {
      await patchAirtableRecord('Posts', postId, {
        'Status': 'Send Failed',
        'Send Error': `[${new Date().toISOString()}] ${msg}`,
        'Admin Notes': `[Telegram Send Error @ ${new Date().toISOString()}] ${msg}`,
      }).catch(() => {})
    }
    // Re-throw so callers awaiting doSend (wait=true mode) can detect the
    // failure and surface it. waitUntil callers ignore rejection — they just
    // run the promise to completion — so this is safe for both paths.
    throw err
  }
}

// Public endpoint — validates the request, marks the Post as "Sending",
// kicks off the actual work via waitUntil(), and returns in ~1s.
// The admin sees the modal close immediately; the Post card flips from
// "Prepping" → "Sending" → "Sent to Telegram" (or "Send Failed") as the
// background job progresses. UI polls Post status to know when it's done.
export async function POST(request) {
  // Internal cron caller bypasses admin auth via x-cron-secret header.
  // /api/cron/telegram-queue uses this so the queue worker can fire sends
  // without an admin session. Anything else still requires admin.
  const cronSecret = request.headers.get('x-cron-secret')
  const isCronCall = cronSecret && process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET
  if (!isCronCall) {
    try { await requireAdmin() } catch (e) { return e }
  }

  try {
    const params = await request.json()
    const { type, photos, editedFileLink, threadId, smmTopicId, postId, rawCaption, rawHashtags, platform, scheduledDate } = params

    const isCarousel = type === 'Carousel'
    if (isCarousel) {
      if (!Array.isArray(photos) || photos.length < 1) {
        return NextResponse.json({ error: 'Carousel send requires photos[] with at least one item' }, { status: 400 })
      }
      if (photos.length > 10) {
        return NextResponse.json({ error: 'Carousel max 10 photos' }, { status: 400 })
      }
    } else if (!editedFileLink) {
      return NextResponse.json({ error: 'No edited file link' }, { status: 400 })
    }
    if (!threadId && !smmTopicId) return NextResponse.json({ error: 'No threadId or smmTopicId provided' }, { status: 400 })
    if (!TELEGRAM_TOKEN) return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 })
    if (smmTopicId && !TELEGRAM_SMM_GROUP_CHAT_ID) {
      return NextResponse.json({ error: 'TELEGRAM_SMM_GROUP_CHAT_ID not set' }, { status: 500 })
    }
    if (!smmTopicId && !TELEGRAM_CHAT_ID) {
      return NextResponse.json({ error: 'TELEGRAM_CHAT_ID not set' }, { status: 500 })
    }

    // Save any user-edited caption/hashtags/platform/date now (rather than
    // after send) so a refresh during the background job shows the correct
    // data. Status was previously also patched to 'Sending' here, but that
    // value is NOT a valid singleSelect option on Posts.Status — every
    // send was 422-ing the entire PATCH and silently swallowing it. Result:
    // user edits made on the post weren't persisting on send. Drop the
    // Status field; UI shows in-flight state via client-side `sending`
    // tracking instead.
    if (postId) {
      const fields = {
        ...(rawCaption ? { 'Caption': rawCaption } : {}),
        ...(rawHashtags ? { 'Hashtags': rawHashtags } : {}),
        ...(platform?.length ? { 'Platform': platform } : {}),
        ...(scheduledDate ? { 'Scheduled Date': scheduledDate } : {}),
      }
      if (Object.keys(fields).length) {
        await patchAirtableRecord('Posts', postId, fields)
          .catch(err => console.warn('[Telegram Send] Pre-send Post update failed:', err.message))
      }
    }

    // Two modes:
    //   wait=false (default): Fire-and-forget. waitUntil keeps the function
    //     running for the upload, response returns in ~1s. Used for one-off
    //     single-cell sends. Order is NOT guaranteed across multiple parallel
    //     requests — they all run in their own function instances.
    //   wait=true: Await the upload synchronously. Response returns only after
    //     the post has actually landed in Telegram. Used for ordered serial
    //     bulk sends (client awaits each fetch in turn) so posts arrive in
    //     queue order.
    if (params.wait) {
      console.log('[Telegram Send] Sync send for post', postId)
      try {
        await doSend(params)
        return NextResponse.json({ ok: true, status: 'sent', postId })
      } catch (err) {
        console.error('[Telegram Send] Sync send error:', err)
        return NextResponse.json({ error: err.message, postId }, { status: 500 })
      }
    }

    console.log('[Telegram Send] Queued for post', postId)
    waitUntil(doSend(params))
    return NextResponse.json({ ok: true, status: 'sending', postId })
  } catch (err) {
    console.error('[Telegram Send] Queue error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
