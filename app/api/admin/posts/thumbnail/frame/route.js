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

    // HDR → SDR tonemap chain. iPhone/Android videos are shot in HDR
    // (BT.2020 / HLG / PQ); the browser tonemaps on display so videos look
    // correct in <video>, but ffmpeg extracting a raw frame without tonemapping
    // produces washed-out / warm / oversaturated frames that don't match what
    // the user saw when picking the timestamp.
    //
    // Chain: convert to linear light (auto-detects input transfer from stream
    // metadata) → tonemap into SDR range → convert back to BT.709 → output
    // yuv420p for JPEG. For genuinely SDR BT.709 inputs this is near-no-op
    // (tonemap=mobius with desat=0 passes in-range values through).
    const colorFix = 'zscale=t=linear:npl=100,tonemap=tonemap=mobius:desat=0:param=0.6,zscale=t=bt709:m=bt709:p=bt709:r=tv,format=yuv420p'
    const simpleFormat = 'format=yuv420p'

    // Cascade of strategies. First one to produce a non-empty JPEG wins.
    // Strategy matters because MOV/MP4 files from phones often report a longer
    // duration than they actually have decodable frames for, and seeking near
    // the end can land past the last keyframe → no output.
    //
    // Each seek strategy is tried first with the HDR-aware colorFix filter.
    // If it fails (some inputs/builds choke on zscale+tonemap), we retry the
    // same seek with the simple format filter as fallback so we don't lose
    // the capture feature when tonemap isn't applicable.
    const mkArgs = (extraPreInput, extraPostInput, vfilter) => [
      '-y',
      ...extraPreInput,
      '-i', inputPath,
      ...extraPostInput,
      '-frames:v', '1',
      '-update', '1',
      '-vf', vfilter,
      '-pix_fmt', 'yuvj420p', // full-range JPEG — matches what <video> displays
      '-q:v', '2',
      outputPath,
    ]

    const seekPairs = [
      { name: 'input-seek', pre: [], post: ['-ss', String(safeTs)] },
      { name: 'output-seek', pre: ['-ss', String(safeTs)], post: [] },
      { name: 'back-1s', pre: [], post: ['-ss', String(Math.max(0, safeTs - 1))] },
      { name: 'back-3s', pre: [], post: ['-ss', String(Math.max(0, safeTs - 3))] },
      { name: 'sseof', pre: ['-sseof', '-0.5'], post: [] },
      { name: 'first-frame', pre: [], post: [] },
    ]

    // For each seek, try HDR-safe chain first, then simple format fallback.
    const strategies = []
    for (const s of seekPairs) {
      strategies.push({ name: `${s.name}+tonemap`, args: mkArgs(s.pre, s.post, colorFix) })
      strategies.push({ name: `${s.name}+simple`, args: mkArgs(s.pre, s.post, simpleFormat) })
    }

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
