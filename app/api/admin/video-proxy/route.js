export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { requireAdminOrEditor } from '@/lib/adminAuth'

// Proxy Dropbox shared-link videos through our own origin so that:
//   1. The browser can use the video for <canvas>.drawImage + toBlob (Dropbox
//      doesn't reliably send CORS headers on raw=1 responses, so the canvas
//      gets tainted and export fails when hitting Dropbox directly).
//   2. HDR → SDR tonemapping happens natively in the browser when displayed,
//      and canvas capture reads those tonemapped pixels. Sidesteps the
//      server-side zscale/tonemap path which produces the orange cast.
//
// Supports Range requests so <video> seek / scrub still works efficiently.

const ALLOWED_HOSTS = new Set([
  'dropbox.com',
  'www.dropbox.com',
  'dl.dropbox.com',
  'dl.dropboxusercontent.com',
  'content.dropboxapi.com',
])

export async function GET(request) {
  try { await requireAdminOrEditor() } catch (e) { return e }

  const { searchParams } = new URL(request.url)
  const raw = searchParams.get('url')
  if (!raw) {
    return new Response(JSON.stringify({ error: 'url required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let target
  try {
    target = new URL(raw)
  } catch {
    return new Response(JSON.stringify({ error: 'invalid url' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!ALLOWED_HOSTS.has(target.hostname)) {
    return new Response(JSON.stringify({ error: 'host not allowed' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Force the dl variant so we get the file bytes, not the Dropbox web page
  target.searchParams.delete('dl')
  target.searchParams.set('raw', '1')

  const upstreamHeaders = {}
  const rangeHeader = request.headers.get('range')
  if (rangeHeader) upstreamHeaders['Range'] = rangeHeader

  const upstream = await fetch(target.toString(), {
    headers: upstreamHeaders,
    redirect: 'follow',
  })

  // Forward the response with permissive CORS. Keep Range/Content-Range headers
  // so the <video> element can seek. Drop headers we don't want to relay.
  const headers = new Headers()
  const passthrough = [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'last-modified',
    'etag',
    'cache-control',
  ]
  for (const h of passthrough) {
    const v = upstream.headers.get(h)
    if (v) headers.set(h, v)
  }
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Range')
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges')
  // Default to Accept-Ranges if upstream didn't say
  if (!headers.has('accept-ranges')) headers.set('Accept-Ranges', 'bytes')

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  })
}

export async function HEAD(request) {
  return GET(request)
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range',
    },
  })
}
