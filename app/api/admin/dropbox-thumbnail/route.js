export const dynamic = 'force-dynamic'
export const maxDuration = 30

import sharp from 'sharp'
import { requireAdminOrEditor } from '@/lib/adminAuth'

// Returns a JPEG thumbnail for any image at a Dropbox shared link.
//
// The reason this exists: HEIC/HEIF images don't render in Chrome or Firefox
// (only Safari has native HEIC), so iPhone photos uploaded raw show as broken
// image icons in the picker. Dropbox's get_thumbnail_v2 API doesn't support
// HEIC either (their supported formats: jpg/png/tiff/gif/webp/ppm/bmp), so we
// fetch the bytes ourselves and decode through sharp's libheif-enabled libvips.
//
// CDN-cached aggressively — the same shared link always produces the same
// thumbnail, so we can hold it on the edge for a day.

const ALLOWED_HOSTS = new Set([
  'dropbox.com',
  'www.dropbox.com',
  'dl.dropbox.com',
  'dl.dropboxusercontent.com',
  'content.dropboxapi.com',
])

function rawDropboxUrl(url) {
  try {
    const u = new URL(url)
    u.searchParams.delete('dl')
    u.searchParams.set('raw', '1')
    return u.toString()
  } catch {
    return url
  }
}

export async function GET(request) {
  try { await requireAdminOrEditor() } catch (e) { return e }

  const { searchParams } = new URL(request.url)
  const url = searchParams.get('url')
  const w = parseInt(searchParams.get('w') || '480', 10)
  const h = parseInt(searchParams.get('h') || '480', 10)
  if (!url) {
    return new Response(JSON.stringify({ error: 'url required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  let target
  try { target = new URL(url) } catch {
    return new Response(JSON.stringify({ error: 'invalid url' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!ALLOWED_HOSTS.has(target.hostname)) {
    return new Response(JSON.stringify({ error: 'host not allowed' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const upstream = await fetch(rawDropboxUrl(url), { redirect: 'follow' })
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `upstream ${upstream.status}` }), {
        status: 502, headers: { 'Content-Type': 'application/json' },
      })
    }
    const inputBuffer = Buffer.from(await upstream.arrayBuffer())

    // sharp auto-detects HEIC/HEIF via libheif (bundled in sharp's prebuilt
    // linux-x64 libvips). Cap the smaller dimension at the target so we don't
    // burn CPU resizing 12MP iPhone photos to 480px more than once.
    const jpegBuffer = await sharp(inputBuffer, { failOn: 'none' })
      .rotate() // honor EXIF orientation
      .resize({ width: w, height: h, fit: 'cover', withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer()

    return new Response(jpegBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable',
      },
    })
  } catch (err) {
    console.error('[dropbox-thumbnail] error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    })
  }
}
