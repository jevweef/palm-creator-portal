export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import ffmpegStatic from 'ffmpeg-static'
import { readFile, writeFile, unlink, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'

function rawDropboxUrl(url) {
  if (!url) return ''
  return url.replace(/[?&]dl=0/, '').replace(/([?&]raw=1)?$/, '') + (url.includes('?') ? '&raw=1' : '?raw=1')
}

export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  const debug = []
  const log = (msg) => { debug.push(msg); console.log(`[Frame Extract] ${msg}`) }

  try {
    const { videoUrl, timestamp } = await request.json()
    if (!videoUrl || timestamp == null) {
      return NextResponse.json({ error: 'videoUrl and timestamp required' }, { status: 400 })
    }

    const rawUrl = rawDropboxUrl(videoUrl)
    const id = Date.now()
    const inputPath = join(tmpdir(), `video_${id}.mp4`)
    const outputPath = join(tmpdir(), `frame_${id}.jpg`)

    log(`tmpdir: ${tmpdir()}`)
    log(`ffmpeg path: ${ffmpegStatic}`)
    log(`ffmpeg exists: ${existsSync(ffmpegStatic)}`)

    // Download video
    log('Downloading video...')
    const dlRes = await fetch(rawUrl)
    if (!dlRes.ok) throw new Error(`Video download failed: ${dlRes.status}`)
    const videoBuffer = Buffer.from(await dlRes.arrayBuffer())
    await writeFile(inputPath, videoBuffer)
    const inputCheck = await stat(inputPath).catch(() => null)
    log(`Downloaded ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB, on disk: ${inputCheck?.size || 'MISSING'}`)

    // Run ffmpeg
    log(`Extracting frame at ${timestamp}s...`)
    const ffmpegResult = await new Promise((resolve) => {
      const args = ['-y', '-ss', String(timestamp), '-i', inputPath, '-frames:v', '1', '-update', '1', '-q:v', '2', outputPath]
      log(`cmd: ffmpeg ${args.join(' ')}`)
      execFile(ffmpegStatic, args, { timeout: 30000 }, (err, stdout, stderr) => {
        resolve({ err, stdout, stderr })
      })
    })

    log(`ffmpeg exit: ${ffmpegResult.err ? ffmpegResult.err.message : 'OK'}`)
    log(`ffmpeg stderr (last 300): ${(ffmpegResult.stderr || '').slice(-300)}`)

    await unlink(inputPath).catch(() => {})

    // Check output
    const outputCheck = await stat(outputPath).catch(() => null)
    log(`output exists: ${!!outputCheck}, size: ${outputCheck?.size || 0}`)

    if (!outputCheck || outputCheck.size === 0) {
      // Return debug info so we can see what happened
      return NextResponse.json({
        error: 'ffmpeg produced no output file',
        debug,
        ffmpegErr: ffmpegResult.err?.message || null,
        ffmpegStderr: ffmpegResult.stderr?.slice(-500) || null,
      }, { status: 500 })
    }

    const frameBuffer = await readFile(outputPath)
    await unlink(outputPath).catch(() => {})
    log(`Done, frame size: ${(frameBuffer.length / 1024).toFixed(0)}KB`)

    return NextResponse.json({ ok: true, jpeg: frameBuffer.toString('base64') })
  } catch (err) {
    return NextResponse.json({ error: err.message, debug }, { status: 500 })
  }
}
