export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import ffmpegStatic from 'ffmpeg-static'
import ffmpeg from 'fluent-ffmpeg'
import { readFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

ffmpeg.setFfmpegPath(ffmpegStatic)

function rawDropboxUrl(url) {
  if (!url) return ''
  return url.replace(/[?&]dl=0/, '').replace(/([?&]raw=1)?$/, '') + (url.includes('?') ? '&raw=1' : '?raw=1')
}

export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { videoUrl, timestamp } = await request.json()
    if (!videoUrl || timestamp == null) {
      return NextResponse.json({ error: 'videoUrl and timestamp required' }, { status: 400 })
    }

    const rawUrl = rawDropboxUrl(videoUrl)
    const id = Date.now()
    const inputPath = join(tmpdir(), `video_${id}.mp4`)
    const outputPath = join(tmpdir(), `frame_${id}.jpg`)

    console.log(`[Frame Extract] Downloading video for frame extraction...`)
    console.log(`[Frame Extract] URL: ${rawUrl.substring(0, 80)}...`)
    console.log(`[Frame Extract] tmpdir: ${tmpdir()}`)

    // Download video first — ffmpeg can't follow Dropbox redirects reliably
    const { writeFile, stat } = await import('fs/promises')
    const dlRes = await fetch(rawUrl)
    if (!dlRes.ok) throw new Error(`Video download failed: ${dlRes.status}`)
    const videoBuffer = Buffer.from(await dlRes.arrayBuffer())
    await writeFile(inputPath, videoBuffer)

    // Verify file was written
    const inputStat = await stat(inputPath).catch(() => null)
    console.log(`[Frame Extract] Downloaded ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB to ${inputPath}, exists: ${!!inputStat}, size on disk: ${inputStat?.size || 0}`)

    // Check ffmpeg binary
    const ffmpegPath = ffmpegStatic
    const { existsSync } = require('fs')
    console.log(`[Frame Extract] ffmpeg path: ${ffmpegPath}, exists: ${existsSync(ffmpegPath)}`)

    console.log(`[Frame Extract] Extracting frame at ${timestamp}s...`)

    // Use child_process.execFile directly for more control
    const { execFile } = require('child_process')
    await new Promise((resolve, reject) => {
      const args = ['-y', '-ss', String(timestamp), '-i', inputPath, '-frames:v', '1', '-update', '1', '-q:v', '2', outputPath]
      console.log(`[Frame Extract] Running: ${ffmpegStatic} ${args.join(' ')}`)
      execFile(ffmpegStatic, args, { timeout: 30000 }, (err, stdout, stderr) => {
        console.log(`[Frame Extract] ffmpeg stderr: ${(stderr || '').substring(0, 500)}`)
        if (err) {
          console.error(`[Frame Extract] ffmpeg exit error: ${err.message}`)
          reject(err)
        } else {
          resolve()
        }
      })
    })
    await unlink(inputPath).catch(() => {})

    // Verify output exists
    const outputStat = await stat(outputPath).catch(() => null)
    console.log(`[Frame Extract] Output exists: ${!!outputStat}, size: ${outputStat?.size || 0}`)
    if (!outputStat) throw new Error('ffmpeg produced no output file')

    const frameBuffer = await readFile(outputPath)
    await unlink(outputPath).catch(() => {})
    console.log(`[Frame Extract] Done, size: ${(frameBuffer.length / 1024).toFixed(0)}KB`)

    // Return as base64 — client will upload via /api/admin/posts/thumbnail
    return NextResponse.json({ ok: true, jpeg: frameBuffer.toString('base64') })
  } catch (err) {
    console.error('[Frame Extract] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
