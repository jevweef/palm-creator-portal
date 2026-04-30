export const dynamic = 'force-dynamic'
export const maxDuration = 15

import { NextResponse } from 'next/server'
import { requireAdminOrSocialMedia } from '@/lib/adminAuth'

// Proxy thumbnail fetches through our domain so the browser sees a stable
// URL, gets a long browser/CDN cache, and never has to deal with Airtable's
// flaky signed-URL CDN going 502 under burst load.
//
// Why this matters: the grid renders ~63 thumbnails simultaneously from
// v5.airtableusercontent.com. Airtable's CDN nodes randomly return 502/abort
// when too many requests hit at once. Without a proxy, the browser sees the
// failure, cell goes black, refresh shows a different random pattern of
// failures. With a proxy: we retry server-side (where we control the budget),
// browser only ever sees 200 or 404.
//
// Allowed hosts kept tight to prevent SSRF — the route returns the upstream
// bytes, so allowing arbitrary URLs would let an attacker probe internal
// services through our domain.
const ALLOWED_HOSTS = new Set([
  'v5.airtableusercontent.com',
  'dl.airtableusercontent.com',
  'imagedelivery.net',
  'dl.dropboxusercontent.com',
  'www.dropbox.com',
  'instagram.com',
  'cdninstagram.com',
])

function isAllowedHost(host) {
  if (ALLOWED_HOSTS.has(host)) return true
  // Allow any *.cdninstagram.com / *.fbcdn.net subdomain (IG scrape thumbs).
  return /\.(cdninstagram\.com|fbcdn\.net|airtableusercontent\.com)$/.test(host)
}

async function fetchWithRetry(url, attempts = 3) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        // Reasonable per-attempt timeout — most fetches finish in <2s when
        // healthy. Airtable's bad nodes usually hang, not error fast.
        signal: AbortSignal.timeout(6000),
      })
      if (res.ok) return res
      // 4xx is a real failure (e.g. signed URL expired) — don't waste retries.
      if (res.status >= 400 && res.status < 500) return res
      lastErr = new Error(`upstream ${res.status}`)
    } catch (e) {
      lastErr = e
    }
    // Backoff between retries: 200ms, 500ms.
    if (i < attempts - 1) {
      await new Promise(r => setTimeout(r, i === 0 ? 200 : 500))
    }
  }
  throw lastErr || new Error('all retries failed')
}

export async function GET(request) {
  try { await requireAdminOrSocialMedia() } catch (e) { return e }

  const url = new URL(request.url).searchParams.get('url')
  if (!url) return new Response('url param required', { status: 400 })

  let parsed
  try { parsed = new URL(url) } catch { return new Response('bad url', { status: 400 }) }
  if (!isAllowedHost(parsed.host)) {
    return new Response(`host not allowed: ${parsed.host}`, { status: 403 })
  }

  try {
    const upstream = await fetchWithRetry(url)
    if (!upstream.ok) {
      return new Response(`upstream ${upstream.status}`, { status: upstream.status })
    }
    const bytes = await upstream.arrayBuffer()
    return new Response(bytes, {
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
        // Cache aggressively. Airtable signed URLs rotate every 7 days but
        // the underlying bytes for a given attachment ID don't change. Even
        // when the URL expires, browsers will still use their cached copy
        // until the cache TTL is up. s-maxage=86400 = Vercel CDN holds it
        // 1 day; max-age=86400 = browser holds it 1 day.
        'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800',
      },
    })
  } catch (err) {
    return new Response(`proxy failed: ${err.message}`, { status: 502 })
  }
}
