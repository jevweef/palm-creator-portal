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

// Build a direct-download Dropbox URL. Handles shared links that have
// ?dl=0, &dl=0, existing raw=1, or no query string at all.
function rawDropboxUrl(url) {
  if (!url) return ''
  const clean = url.replace(/[?&]dl=0/, '').replace(/[?&]raw=1/, '')
  return clean + (clean.includes('?') ? '&raw=1' : '?raw=1')
}

// Run ffmpeg with a specific arg set. Resolves with {ok, stderr, size}.
function runFfmpeg(args, outputPath) {
  return new Promise((resolve) => {
    execFile(ffmpegStatic, args, { timeout: 25000 }, async (err, _stdout, stderr) => {
      const s = await stat(outputPath).catch(() => null)
      resolve({ ok: !!s && s.size > 0, size: s?.size || 0, err, stderr: stderr || '' })
    })
  })
}

export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  const debug = []
  const log = (msg) => { debug.push(msg); console.log(`[Frame Extract] ${msg}`) }

  const id = Date.now()
  const inputPath = join(tmpdir(), `video_${id}.mp4`)
  const outputPath = join(tmpdir(), `frame_${id}.jpg`)

  try {
    const { videoUrl, timestamp } = await request.json()
    if (!videoUrl || timestamp == null) {
      return NextResponse.json({ error: 'videoUrl and timestamp required' }, { status: 400 })
    }

    const rawUrl = rawDropboxUrl(videoUrl)
    log(`rawUrl: ${rawUrl}`)
    log(`ffmpeg exists: ${existsSync(ffmpegStatic)}`)

    // Download video
    const dlRes = await fetch(rawUrl, { redirect: 'follow' })
    if (!dlRes.ok) throw new Error(`Video download failed: ${dlRes.status}`)
    const ct = dlRes.headers.get('content-type') || ''
    const videoBuffer = Buffer.from(await dlRes.arrayBuffer())
    log(`Downloaded ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB, type=${ct}`)

    // Detect HTML (happens when share link isn't "Anyone with link" or URL is malformed)
    const head = videoBuffer.slice(0, 100).toString('utf8')
    if (ct.includes('text/html') || head.includes('<!DOCTYPE html') || head.includes('<html')) {
      throw new Error('Dropbox returned HTML instead of video. Check the share link is set to "Anyone with the link can view".')
    }

    await writeFile(inputPath, videoBuffer)

    // Clamp timestamp — hard cap just in case
    const safeTs = Math.max(0, Math.min(Number(timestamp) || 0, 9999))

    // Cascade of strategies. First one to produce a non-empty JPEG wins.
    // Strategy matters because MOV/MP4 files from phones often report a longer
    // duration than they actually have decodable frames for, and seeking near
    // the end can land past the last keyframe → no output.
    const mkArgs = (extraPreInput, extraPostInput) => [
      '-y',
      ...extraPreInput,
      '-i', inputPath,
      ...extraPostInput,
      '-frames:v', '1',
      '-update', '1',
      '-q:v', '2',
      outputPath,
    ]

    const strategies = [
      // 1. Input seek at exact timestamp (slow but precise)
      { name: 'input-seek', args: mkArgs([], ['-ss', String(safeTs)]) },
      // 2. Output seek at exact timestamp (fast, uses nearest keyframe)
      { name: 'output-seek', args: mkArgs(['-ss', String(safeTs)], []) },
      // 3. Back off 1 second
      { name: 'back-1s', args: mkArgs([], ['-ss', String(Math.max(0, safeTs - 1))]) },
      // 4. Back off 3 seconds
      { name: 'back-3s', args: mkArgs([], ['-ss', String(Math.max(0, safeTs - 3))]) },
      // 5. Grab the LAST decodable frame (from-end seek)
      { name: 'sseof', args: mkArgs(['-sseof', '-0.5'], []) },
      // 6. First frame (absolute fallback — always produces something if the file is valid)
      { name: 'first-frame', args: mkArgs([], []) },
    ]

    let finalResult = null
    let usedStrategy = null

    for (const s of strategies) {
      // Clear any stale output file from previous attempt
      await unlink(outputPath).catch(() => {})
      log(`Trying ${s.name}...`)
      const result = await runFfmpeg(s.args, outputPath)
      if (result.ok) {
        log(`${s.name} succeeded (${(result.size / 1024).toFixed(0)}KB)`)
        finalResult = result
        usedStrategy = s.name
        break
      } else {
        log(`${s.name} failed: ${(result.stderr || result.err?.message || '').slice(-200)}`)
      }
    }

    if (!finalResult) {
      return NextResponse.json({
        error: 'All ffmpeg strategies failed — the video file may be corrupt or unsupported',
        debug,
      }, { status: 500 })
    }

    const frameBuffer = await readFile(outputPath)
    log(`Done via ${usedStrategy}, frame size: ${(frameBuffer.length / 1024).toFixed(0)}KB`)

    return NextResponse.json({
      ok: true,
      jpeg: frameBuffer.toString('base64'),
      strategy: usedStrategy,
      // If we fell back, surface it so the UI can hint "grabbed nearest frame"
      approximate: usedStrategy !== 'input-seek' && usedStrategy !== 'output-seek',
    })
  } catch (err) {
    return NextResponse.json({ error: err.message, debug }, { status: 500 })
  } finally {
    await unlink(inputPath).catch(() => {})
    await unlink(outputPath).catch(() => {})
  }
}
