// Proxy iMessage attachments from the Mac daemon to the browser.
//
// The daemon serves /attachment?guid=XXX over the Cloudflare tunnel,
// auth'd by X-Daemon-Secret header. We don't want to expose that secret
// to the browser, so this server-side proxy:
//   1. Auths the user via Clerk (inbox owner only)
//   2. Streams the file from the daemon, injecting the secret server-side
//   3. Forwards Content-Type + body back to the browser
//
// Usage in UI: <img src="/api/admin/inbox/attachment?guid=XXX" />

export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { NextResponse } from 'next/server'
import { requireInboxOwner } from '@/lib/adminAuth'

export async function GET(request) {
  const auth = await requireInboxOwner()
  if (auth instanceof NextResponse) return auth

  const url = new URL(request.url)
  const guid = url.searchParams.get('guid')
  if (!guid) {
    return NextResponse.json({ error: 'guid required' }, { status: 400 })
  }

  const daemonUrl = process.env.DAEMON_URL
  const daemonSecret = process.env.DAEMON_SECRET
  if (!daemonUrl || !daemonSecret) {
    return NextResponse.json({ error: 'daemon not configured' }, { status: 503 })
  }

  // Sanitize guid: chat.db guids are alphanumeric + hyphens (UUIDs), but
  // be defensive — strip anything weird before constructing the URL.
  if (!/^[A-Za-z0-9._-]+$/.test(guid)) {
    return NextResponse.json({ error: 'invalid guid format' }, { status: 400 })
  }

  const target = `${daemonUrl.replace(/\/$/, '')}/attachment?guid=${encodeURIComponent(guid)}`

  let upstream
  try {
    upstream = await fetch(target, {
      headers: { 'X-Daemon-Secret': daemonSecret },
      cache: 'no-store',
    })
  } catch (err) {
    return NextResponse.json({ error: `daemon unreachable: ${err.message}` }, { status: 502 })
  }

  if (!upstream.ok) {
    let detail = upstream.statusText
    try { detail = (await upstream.json())?.error || detail } catch {}
    return NextResponse.json({ error: detail }, { status: upstream.status })
  }

  // Stream the body straight through. NextResponse can take a ReadableStream.
  const headers = new Headers()
  headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/octet-stream')
  const len = upstream.headers.get('Content-Length')
  if (len) headers.set('Content-Length', len)
  // Browsers cache by URL — the guid is stable, so it's safe to cache aggressively.
  headers.set('Cache-Control', 'private, max-age=3600')

  return new NextResponse(upstream.body, { status: 200, headers })
}
