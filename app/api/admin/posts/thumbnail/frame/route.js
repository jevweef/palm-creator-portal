export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { requireAdmin, patchAirtableRecord } from '@/lib/adminAuth'
import ffmpegStatic from 'ffmpeg-static'
import ffmpeg from 'fluent-ffmpeg'
import { readFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

ffmpeg.setFfmpegPath(ffmpegStatic)

const DROPBOX_TOKEN = process.env.DROPBOX_ACCESS_TOKEN

function rawDropboxUrl(url) {
  if (!url) return ''
  return url.replace(/[?&]dl=0/, '').replace(/([?&]raw=1)?$/, '') + (url.includes('?') ? '&raw=1' : '?raw=1')
}

export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { videoUrl, timestamp, postId } = await request.json()
    if (!videoUrl || timestamp == null || !postId) {
      return NextResponse.json({ error: 'videoUrl, timestamp, and postId required' }, { status: 400 })
    }

    const rawUrl = rawDropboxUrl(videoUrl)
    const id = Date.now()
    const outputPath = join(tmpdir(), `frame_${id}.jpg`)

    console.log(`[Frame Extract] Extracting frame at ${timestamp}s from ${rawUrl.slice(0, 60)}...`)

    // Extract a single frame at the given timestamp
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
    console.log(`[Frame Extract] Frame extracted, size: ${(frameBuffer.length / 1024).toFixed(0)}KB`)

    // Upload to Dropbox
    const fileName = `frame_thumb_${postId}_${id}.jpg`
    const dropboxPath = `/Palm Ops/Thumbnails/${fileName}`

    const uploadRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${DROPBOX_TOKEN}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath, mode: 'add', autorename: true }),
      },
      body: frameBuffer,
    })

    if (!uploadRes.ok) throw new Error(`Dropbox upload failed: ${await uploadRes.text()}`)

    // Get shared link
    let sharedUrl
    const linkRes = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${DROPBOX_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: dropboxPath, settings: { requested_visibility: 'public' } }),
    })

    if (linkRes.ok) {
      const linkData = await linkRes.json()
      sharedUrl = linkData.url?.replace('dl=0', 'raw=1')
    } else {
      const existRes = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
        method: 'POST',
        headers: { Authorization: `Bearer ${DROPBOX_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dropboxPath }),
      })
      const existData = await existRes.json()
      sharedUrl = existData.links?.[0]?.url?.replace('dl=0', 'raw=1')
    }

    if (!sharedUrl) throw new Error('Could not get shared URL for frame')

    // Save to Airtable Post record
    await patchAirtableRecord('Posts', postId, { 'Thumbnail': [{ url: sharedUrl }] })
    console.log(`[Frame Extract] Done — ${sharedUrl.slice(0, 60)}`)

    return NextResponse.json({ ok: true, url: sharedUrl })
  } catch (err) {
    console.error('[Frame Extract] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
