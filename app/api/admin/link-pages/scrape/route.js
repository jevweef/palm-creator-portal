import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Domain → builder platform vocabulary (must match PLATFORMS in the builder so
// the icon renders). Order matters — first substring hit wins.
const DOMAIN_MAP = [
  ['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['onlyfans', 'OnlyFans'],
  ['fanvue', 'Fanvue'], ['twitter.com', 'Twitter'], ['x.com', 'Twitter'],
  ['threads', 'Threads'], ['youtube', 'YouTube'], ['youtu.be', 'YouTube'],
  ['spotify', 'Spotify'], ['patreon', 'Patreon'], ['twitch', 'Twitch'],
  ['kick.com', 'Kick'], ['snapchat', 'Snapchat'], ['discord', 'Discord'],
  ['t.me', 'Telegram'], ['telegram', 'Telegram'], ['amazon', 'Amazon'], ['amzn', 'Amazon'],
  ['cash.app', 'Cash App'], ['cash.me', 'Cash App'],
]
function classify(url, hint = '') {
  const d = `${url} ${hint}`.toLowerCase()
  for (const [frag, plat] of DOMAIN_MAP) if (d.includes(frag)) return plat
  return 'link'
}
// The service's own assets / nav / infra — never a creator link.
function isJunk(url) {
  const d = url.toLowerCase()
  return /\.(png|jpe?g|webp|gif|svg|ico|css|js|woff2?|mp4)(\?|$)/.test(d) ||
    /(link\.me|linktr\.ee|beacons\.ai|snipfeed|media\.|cdn\.|cloudfront|_resize|schema\.org|w3\.org|googleapis|gstatic|fonts\.|google-analytics|facebook\.com\/tr|doubleclick|sentry|cookiebot)/.test(d)
}
// Bare/base platform URLs with no handle (e.g. instagram.com/, spotify.com/user/).
function isBare(url) {
  const path = url.replace(/^https?:\/\/[^/]+/i, '').split('?')[0].replace(/^\/|\/$/g, '')
  return path === '' || ['user', 'u', 'channel'].includes(path)
}
// Decode the HTML entities that show up in anchor hrefs (&amp; etc.) so the
// encoded and JSON copies of the same URL dedupe against each other.
function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&#38;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}
function stripTracking(url) {
  try {
    const u = new URL(url)
    for (const p of [...u.searchParams.keys()]) {
      if (/^utm_/i.test(p) || /^(fbclid|gclid|igshid|mc_eid|_ga|ref|si|aem|_aem)$/i.test(p)) u.searchParams.delete(p)
    }
    return u.toString().replace(/\?$/, '')
  } catch { return url.split('?')[0] }
}
function handleFrom(url) {
  const path = url.replace(/^https?:\/\/[^/]+/i, '').split('?')[0].replace(/^\/|\/$/g, '')
  const seg = path.split('/').filter(Boolean).pop() || ''
  return seg.replace(/^@/, '')
}

// Walk arbitrary JSON collecting real destination URLs from link-ish fields.
// Deliberately ignores `baseUrl`-type fields (platform stubs, not real links).
function harvestJson(node, out, adultByUrl) {
  if (Array.isArray(node)) { for (const x of node) harvestJson(x, out, adultByUrl) ; return }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string' && /^https?:\/\//.test(v) &&
          /^(url|link|href|linkvalue|destination|targeturl|value)$/i.test(k)) {
        const dv = decodeEntities(v)
        out.add(dv)
        if (node.isAdult === true || node.isAdult === 1) adultByUrl.add(dv)
      } else {
        harvestJson(v, out, adultByUrl)
      }
    }
  }
}

/**
 * GET /api/admin/link-pages/scrape?url=<link-in-bio url>
 * Fetches the page and returns the creator's links, classified by platform
 * (with the right icon) and OnlyFans/Fanvue/adult links pre-gated.
 * Returns { links: [{label, url, platform, gated}], count, source }.
 */
export async function GET(request) {
  try {
    await requireAdmin()
    const target = new URL(request.url).searchParams.get('url')
    if (!target || !/^https?:\/\//i.test(target)) {
      return NextResponse.json({ error: 'A valid http(s) url is required' }, { status: 400 })
    }

    let html = ''
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 12000)
      const res = await fetch(target, {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36' },
      })
      clearTimeout(t)
      if (!res.ok) return NextResponse.json({ error: `Page returned ${res.status}` }, { status: 400 })
      html = await res.text()
    } catch (e) {
      return NextResponse.json({ error: `Couldn't fetch the page (${e.name === 'AbortError' ? 'timed out' : e.message})` }, { status: 400 })
    }

    const urls = new Set()
    const adult = new Set()

    // 1) Structured JSON blobs (__NEXT_DATA__, __NUXT__, generic inline JSON).
    const blobs = [...html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1])
    for (const b of blobs) {
      try { harvestJson(JSON.parse(b), urls, adult) } catch { /* skip non-JSON */ }
    }
    // 2) Real anchor hrefs (clickable links on the rendered page).
    for (const m of html.matchAll(/<a\b[^>]*href="(https?:\/\/[^"]+)"/gi)) urls.add(decodeEntities(m[1]))

    // Classify, filter, dedup.
    const byKey = new Map()
    for (const raw of urls) {
      if (isJunk(raw) || isBare(raw)) continue
      const url = stripTracking(raw)
      if (isJunk(url) || isBare(url)) continue
      const platform = classify(url)
      const key = url.replace(/\/$/, '').toLowerCase()
      if (byKey.has(key)) continue
      byKey.set(key, {
        label: handleFrom(url) || platform,
        url,
        platform,
        gated: platform === 'OnlyFans' || platform === 'Fanvue' || adult.has(raw),
      })
    }

    // Known platforms first, generic 'link' last; cap to a sane number.
    const links = [...byKey.values()]
      .sort((a, b) => (a.platform === 'link' ? 1 : 0) - (b.platform === 'link' ? 1 : 0))
      .slice(0, 60)

    return NextResponse.json({ links, count: links.length, source: target })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[link-pages/scrape] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
