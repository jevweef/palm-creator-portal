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
    const outputPath = join(tmpdir(), `frame_${id}.jpg`)

    console.log(`[Frame Extract] Extracting frame at ${timestamp}s...`)

    await new Promise((resolve, reject) => {
      ffmpeg(rawUrl)
        .inputOptions([`-ss ${timestamp}`])
        .outputOptions(['-frames:v 1', '-f image2', '-q:v 2'])
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run()
    })

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
