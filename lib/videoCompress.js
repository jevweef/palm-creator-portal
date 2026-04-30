// Reusable video compression / remux helpers. Same code that used to live
// inline in /api/telegram/send — extracted here so the new asset-precompress
// cron can run the SAME pipeline once at upload time, decoupling compression
// from the per-send hot path.

import ffmpegStatic from 'ffmpeg-static'
import { writeFile, readFile, unlink, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFilePromise = promisify(execFile)

// Telegram bot upload limit. Files at or under this size + already MP4 H.264
// don't need any processing — send pipeline can skip ffmpeg entirely.
export const TELEGRAM_MAX_BYTES = 50 * 1024 * 1024

// Probe video duration in seconds by parsing ffmpeg stderr (ffprobe not in
// ffmpeg-static). Returns null if parsing fails.
export async function getVideoDuration(filePath) {
  try {
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

// Probe video dimensions. Returns { width, height } or null.
export async function getVideoDimensions(filePath) {
  try {
    await execFilePromise(ffmpegStatic, ['-i', filePath], { timeout: 10000 })
  } catch (err) {
    const stderr = err.stderr || ''
    const m = stderr.match(/(\d{2,5})x(\d{2,5})/)
    if (!m) return null
    return { width: parseInt(m[1]), height: parseInt(m[2]) }
  }
  return null
}

// Remux MOV → MP4 using -c copy (zero quality loss, just container change).
// Use when source is already small enough but in the wrong container.
export async function remuxToMp4(inputBuffer, inputName) {
  const id = Date.now()
  const ext = inputName.split('.').pop().toLowerCase()
  const inputPath = join(tmpdir(), `comp_in_${id}.${ext}`)
  const outputPath = join(tmpdir(), `comp_out_${id}.mp4`)
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

// Compress a video to a tight target size. Default targetMB=8 because IG
// reels are typically 15-30 seconds at 1080×1920 — 8MB at 30s is ~2.1 Mbps
// which looks identical to source on a phone screen. Smaller files →
// faster Dropbox download in the send pipeline, faster Telegram upload,
// less function budget consumed per send.
//
// History: this used to default to targetMB=47 ("barely fits under 50MB
// Telegram limit") because the compression ran INLINE per-send, so we
// wanted minimum bitrate reduction. Now compression runs once at the
// asset level via the precompress cron, so we can spend the time to make
// a properly small output.
export async function compressVideo(inputBuffer, inputName, { targetMB = 8, aggressive = false } = {}) {
  const id = Date.now()
  const ext = (inputName.split('.').pop() || 'mp4').toLowerCase()
  const inputPath = join(tmpdir(), `comp_in_${id}.${ext}`)
  const outputPath = join(tmpdir(), `comp_out_${id}.mp4`)
  await writeFile(inputPath, Buffer.from(inputBuffer))

  let videoOpts
  if (aggressive) {
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
      const totalBudget = targetMB * 1024 * 1024 * 8 * 0.95
      const videoBps = Math.floor((totalBudget - AUDIO_BPS * duration) / duration)
      const videoK = Math.max(800, Math.floor(videoBps / 1024))
      console.log(`[Compress] duration=${duration.toFixed(1)}s → video ${videoK}kbps for ${targetMB}MB target`)
      videoOpts = [
        '-c:v', 'libx264',
        '-b:v', `${videoK}k`,
        '-maxrate', `${Math.floor(videoK * 1.15)}k`,
        '-bufsize', `${videoK * 2}k`,
        '-preset', 'ultrafast',
        '-vf', 'scale=w=-2:h=\'min(1920,ih)\'',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
      ]
    } else {
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

// Top-level decision tree for "process this video for Telegram-ready output".
// Probes the input first. If already a small MP4, returns the source bytes
// unchanged. Otherwise remuxes/compresses as needed. Returns { buffer, ext }.
//
// Use this from the precompress cron AND from the inline send route's
// fallback path. Single source of truth for "is this video Telegram-ready".
export async function makeTelegramReady(inputBuffer, inputName) {
  const buf = Buffer.from(inputBuffer)
  const ext = (inputName.split('.').pop() || '').toLowerCase()
  const isMp4 = ext === 'mp4'
  const sizeBytes = buf.length

  // The "ship as-is" threshold is small — files at or under TARGET_SMALL
  // download/upload fast enough that recompressing would waste cron time
  // for negligible savings. Anything bigger gets compressed to the 8MB
  // target because Telegram + Dropbox transfer time scales with size.
  const TARGET_SMALL_BYTES = 12 * 1024 * 1024

  // Already MP4 + small → ship as-is. Skips a Dropbox upload round-trip.
  if (isMp4 && sizeBytes <= TARGET_SMALL_BYTES) {
    return { buffer: buf, filename: inputName, mime: 'video/mp4' }
  }

  // Non-MP4 but small → remux to MP4 (no quality loss, just container swap).
  if (!isMp4 && sizeBytes <= TARGET_SMALL_BYTES) {
    const remuxed = await remuxToMp4(buf, inputName)
    if (remuxed.length <= TELEGRAM_MAX_BYTES) {
      return {
        buffer: remuxed,
        filename: inputName.replace(/\.[^.]+$/, '.mp4'),
        mime: 'video/mp4',
      }
    }
    // Remux output unexpectedly grew → fall through to compress.
  }

  // Anything bigger → real compress to 8MB target.
  const compressed = await compressVideo(buf, inputName, { targetMB: 8 })
  if (compressed.length <= TELEGRAM_MAX_BYTES) {
    return {
      buffer: compressed,
      filename: inputName.replace(/\.[^.]+$/, '.mp4'),
      mime: 'video/mp4',
    }
  }

  // Still too big → aggressive 720p mode.
  const aggressive = await compressVideo(buf, inputName, { aggressive: true })
  if (aggressive.length <= TELEGRAM_MAX_BYTES) {
    return {
      buffer: aggressive,
      filename: inputName.replace(/\.[^.]+$/, '.mp4'),
      mime: 'video/mp4',
    }
  }

  throw new Error(`Compression couldn't fit under 50MB (best result ${(aggressive.length / 1024 / 1024).toFixed(1)}MB)`)
}
