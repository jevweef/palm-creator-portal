// pennyThumbnail.js — server-side thumbnail helpers for the Penny post-prep cron.
//
// Penny runs headless in a Vercel cron, so she can't use the browser <canvas>
// frame-capture the Post-Prep UI uses. These two functions reproduce, on the
// server, exactly what the manual flow does:
//   1. extractFrameJpeg() — grab one frame at a timestamp via ffmpeg-static
//      (the same HDR-tonemap + seek cascade as app/api/admin/posts/thumbnail/
//      frame/route.js).
//   2. uploadThumbnailToDropbox() — upload that JPEG to /Palm Ops/Thumbnails
//      and return a public raw URL (same upload + shared-link logic as
//      app/api/admin/posts/thumbnail/route.js).
//
// Kept as a standalone lib (rather than calling those admin routes over HTTP)
// so the cron never has to forge admin auth — it just calls these directly with
// the server-side env it already has.

import ffmpegStatic from 'ffmpeg-static'
import { readFile, writeFile, unlink, stat } from 'fs/promises'
import { execFile } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'

// Build a direct-download Dropbox URL. Handles ?dl=0, &dl=0, existing raw=1, or
// no query string at all. Non-Dropbox URLs pass through unchanged.
export function rawDropboxUrl(url) {
  if (!url) return ''
  if (!/^https?:\/\/(www\.)?dropbox\.com\//i.test(url)) return url
  const clean = url.replace(/[?&]dl=0/, '').replace(/[?&]raw=1/, '')
  return clean + (clean.includes('?') ? '&raw=1' : '?raw=1')
}

function runFfmpeg(args, outputPath) {
  return new Promise((resolve) => {
    execFile(ffmpegStatic, args, { timeout: 25000 }, async (err, _stdout, stderr) => {
      const s = await stat(outputPath).catch(() => null)
      resolve({ ok: !!s && s.size > 0, size: s?.size || 0, err, stderr: stderr || '' })
    })
  })
}

/**
 * Extract a single JPEG frame from a video at `timestamp` seconds.
 * Mirrors the cascade in the Post-Prep frame-capture route.
 * @returns {Promise<Buffer>} the JPEG bytes
 * @throws if the video can't be fetched/decoded
 */
export async function extractFrameJpeg({ videoUrl, timestamp }) {
  if (!videoUrl || timestamp == null) throw new Error('videoUrl and timestamp required')
  const id = `${Date.now()}_${Math.round(timestamp * 1000)}`
  const inputPath = join(tmpdir(), `penny_video_${id}.mp4`)
  const outputPath = join(tmpdir(), `penny_frame_${id}.jpg`)

  try {
    const rawUrl = rawDropboxUrl(videoUrl)
    const dlRes = await fetch(rawUrl, { redirect: 'follow' })
    if (!dlRes.ok) throw new Error(`Video download failed: ${dlRes.status}`)
    const ct = dlRes.headers.get('content-type') || ''
    const videoBuffer = Buffer.from(await dlRes.arrayBuffer())
    const head = videoBuffer.slice(0, 100).toString('utf8')
    if (ct.includes('text/html') || head.includes('<!DOCTYPE html') || head.includes('<html')) {
      throw new Error('Dropbox returned HTML instead of video — check the share link is "Anyone with the link".')
    }
    await writeFile(inputPath, videoBuffer)

    const safeTs = Math.max(0, Math.min(Number(timestamp) || 0, 9999))

    // HDR→SDR tonemap so phone (BT.2020/HLG/PQ) frames don't come out washed out.
    const colorFix = 'zscale=t=linear:npl=100,tonemap=tonemap=mobius:desat=0:param=0.6,zscale=t=bt709:m=bt709:p=bt709:r=tv,format=yuv420p'
    const simpleFormat = 'format=yuv420p'
    const mkArgs = (pre, post, vfilter) => [
      '-y', ...pre, '-i', inputPath, ...post,
      '-frames:v', '1', '-update', '1', '-vf', vfilter,
      '-pix_fmt', 'yuvj420p', '-q:v', '2', outputPath,
    ]
    const seekPairs = [
      { name: 'input-seek', pre: [], post: ['-ss', String(safeTs)] },
      { name: 'output-seek', pre: ['-ss', String(safeTs)], post: [] },
      { name: 'back-1s', pre: [], post: ['-ss', String(Math.max(0, safeTs - 1))] },
      { name: 'back-3s', pre: [], post: ['-ss', String(Math.max(0, safeTs - 3))] },
      { name: 'sseof', pre: ['-sseof', '-0.5'], post: [] },
      { name: 'first-frame', pre: [], post: [] },
    ]
    const strategies = []
    for (const s of seekPairs) {
      strategies.push(mkArgs(s.pre, s.post, colorFix))
      strategies.push(mkArgs(s.pre, s.post, simpleFormat))
    }

    for (const args of strategies) {
      await unlink(outputPath).catch(() => {})
      const result = await runFfmpeg(args, outputPath)
      if (result.ok) return await readFile(outputPath)
    }
    throw new Error('All ffmpeg strategies failed — video may be corrupt/unsupported')
  } finally {
    await unlink(inputPath).catch(() => {})
    await unlink(outputPath).catch(() => {})
  }
}

async function getDropboxAccessToken() {
  const res = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.DROPBOX_REFRESH_TOKEN,
      client_id: process.env.DROPBOX_APP_KEY,
      client_secret: process.env.DROPBOX_APP_SECRET,
    }),
  })
  if (!res.ok) throw new Error(`Dropbox token refresh failed: ${await res.text()}`)
  return (await res.json()).access_token
}

/**
 * Upload a thumbnail JPEG buffer to /Palm Ops/Thumbnails and return a public
 * raw URL. Does NOT write Airtable — the caller decides which Post to attach it
 * to (so Penny can stamp Thumbnail Source itself).
 * @returns {Promise<string>} public ?raw=1 shared URL
 */
export async function uploadThumbnailToDropbox({ buffer, postId }) {
  if (!buffer?.length) throw new Error('buffer required')
  const fileName = `thumbnail_${postId || 'penny'}_${Date.now()}.jpg`
  const dropboxPath = `/Palm Ops/Thumbnails/${fileName}`
  const token = await getDropboxAccessToken()

  const uploadRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath, mode: 'add', autorename: true }),
    },
    body: buffer,
  })
  if (!uploadRes.ok) throw new Error(`Dropbox upload failed: ${await uploadRes.text()}`)

  const linkRes = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: dropboxPath, settings: { requested_visibility: 'public' } }),
  })
  let sharedUrl
  if (linkRes.ok) {
    sharedUrl = (await linkRes.json()).url?.replace('dl=0', 'raw=1')
  } else {
    // Link may already exist (autorename collision is rare but be safe).
    const existRes = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: dropboxPath }),
    })
    sharedUrl = (await existRes.json()).links?.[0]?.url?.replace('dl=0', 'raw=1')
  }
  if (!sharedUrl) throw new Error('Could not get shared URL for thumbnail')
  return sharedUrl
}
