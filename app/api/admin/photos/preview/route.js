import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord, OPS_BASE } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST || 'instagram-scraper-stable-api.p.rapidapi.com'
// Bumped from manual-only "client cache" to durable server cache —
// the cached scrape lives on the Photo Accounts row's Scrape Cache
// field so we never re-pay RapidAPI for the same handle across
// modal closes / different devices. Editor clicks Refresh to bust.
const CACHE_VALID_FOR_MS = 30 * 24 * 60 * 60 * 1000 // 30 days — generous; the editor decides when stale

// GET /api/admin/photos/preview?handle=X&limit=30
//
// Cheap RapidAPI preview of photo posts for a handle. Returns one
// entry per IMAGE — carousels are exploded into N entries, each with
// its own thumbnail + carousel index. Video posts and video frames
// inside carousels are filtered out. Reels endpoint isn't touched.
//
// Already-imported images (matched by post URL + carousel index) get
// the alreadyImported flag so the UI can dim them.
export async function GET(request) {
  try {
    await requireAdmin()
    if (!RAPIDAPI_KEY) return NextResponse.json({ error: 'RAPIDAPI_KEY not set' }, { status: 500 })

    const u = new URL(request.url)
    let handle = (u.searchParams.get('handle') || '').trim()
    // Defensive normalization in case a URL-shaped value is in Airtable
    // from before we tightened handle parsing in the Add UI.
    handle = handle.replace(/^https?:\/\//i, '').replace(/^www\./i, '')
                   .replace(/^instagram\.com\//i, '')
                   .split(/[\/?#]/)[0]
                   .replace(/^@/, '')
                   .toLowerCase()
    // `limit` is the rough target number of POSTS to scan (each page
    // returns ~12-24 posts, so this controls pagination depth, not the
    // exact image count — a single carousel post can yield 10+ images).
    const limit = Math.min(200, Math.max(5, parseInt(u.searchParams.get('limit') || '60', 10)))
    const forceRefresh = u.searchParams.get('refresh') === '1'
    if (!handle) return NextResponse.json({ error: 'handle required' }, { status: 400 })

    // Already-imported lookup. Photos table holds one record per image
    // so the dup key needs both Post URL and Carousel Index.
    const existingRows = await fetchAirtableRecords('Photos', {
      fields: ['Source Post URL', 'Carousel Index'],
      filterByFormula: `{Source Handle} = "${handle}"`,
    })
    const existingKeys = new Set()
    for (const r of existingRows) {
      const url = r.fields?.['Source Post URL'] || ''
      const idx = r.fields?.['Carousel Index'] || 1
      const m = url.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/)
      if (m) existingKeys.add(`${m[1]}|${idx}`)
    }

    // Look up the Photo Account row so we can read/write its cache.
    const accountRows = await fetchAirtableRecords('Photo Accounts', {
      fields: ['Handle', 'Scrape Cache', 'Last Scraped At', 'Last Photos Scraped'],
      filterByFormula: `LOWER({Handle}) = "${handle.replace(/"/g, '\\"')}"`,
      maxRecords: 1,
    })
    const accountRow = accountRows[0]
    const accountId = accountRow?.id || null

    // Cache hit? Parse the JSON blob, validate freshness, recompute
    // alreadyImported (since the Photos table changes independently
    // of the cache) and return without hitting RapidAPI.
    if (!forceRefresh && accountRow?.fields?.['Scrape Cache']) {
      try {
        const cached = JSON.parse(accountRow.fields['Scrape Cache'])
        const fetchedAt = cached?.fetchedAt ? Date.parse(cached.fetchedAt) : 0
        if (fetchedAt && (Date.now() - fetchedAt) < CACHE_VALID_FOR_MS && Array.isArray(cached.images)) {
          const refreshed = cached.images.map(img => ({
            ...img,
            alreadyImported: existingKeys.has(`${img.code}|${img.carouselIndex || 1}`),
          }))
          return NextResponse.json({
            ok: true,
            handle,
            postsSeen: cached.postsSeen || 0,
            total: refreshed.length,
            alreadyImportedCount: refreshed.filter(i => i.alreadyImported).length,
            images: refreshed,
            cachedAt: cached.fetchedAt,
            fromCache: true,
          })
        }
      } catch (e) { console.warn('[photos/preview] cache parse failed:', e.message) }
    }

    const images = [] // exploded list — one entry per image
    let postsSeen = 0
    let paginationToken = null
    const maxPages = 10
    let firstResponseShape = null // for debug surface when nothing comes back
    for (let page = 0; page < maxPages; page++) {
      let body = `username_or_url=${encodeURIComponent(handle)}&amount=50`
      if (paginationToken) body += `&pagination_token=${paginationToken}`
      const res = await fetch(`https://${RAPIDAPI_HOST}/get_ig_user_posts.php`, {
        method: 'POST',
        headers: {
          'x-rapidapi-host': RAPIDAPI_HOST,
          'x-rapidapi-key': RAPIDAPI_KEY,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      })
      if (!res.ok) return NextResponse.json({ error: `RapidAPI ${res.status}` }, { status: 502 })
      const data = await res.json()
      if (data.error) return NextResponse.json({ error: `RapidAPI: ${data.error}` }, { status: 502 })

      // Capture the top-level shape of the first response so we can
      // diagnose unknown keys when nothing parses. Strips obvious arrays.
      if (page === 0) {
        firstResponseShape = {
          keys: Object.keys(data || {}),
          countsByKey: Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, Array.isArray(v) ? `array[${v.length}]` : typeof v])),
          sampleFirstItem: (() => {
            for (const k of Object.keys(data || {})) {
              const v = data[k]
              if (Array.isArray(v) && v[0]) return { key: k, itemKeys: Object.keys(v[0]).slice(0, 30) }
            }
            return null
          })(),
        }
      }

      const posts = data.posts || data.items || data.data || data.feed_items || data.user?.edge_owner_to_timeline_media?.edges || []
      for (const node of posts) {
        // Instagram GraphQL-style envelope: each item is {node: {...post...}}.
        // The post fields (code, media_type, image_versions2, carousel_media)
        // live directly on .node — NOT inside a .media sub-object. Older
        // scrapers used .node.media so we still check that first as a
        // fallback before unwrapping to .node, then .media, then the
        // raw item.
        const media = node?.node?.media || node?.node || node?.media || node || {}
        const code = media.code || media.shortcode
        if (!code) continue
        const postUrl = `https://www.instagram.com/p/${code}/`
        const takenAt = media.taken_at || media.taken_at_timestamp
        const postedAt = takenAt
          ? new Date(typeof takenAt === 'number' ? takenAt * 1000 : Date.parse(takenAt)).toISOString()
          : null
        const caption = media?.caption?.text || media?.edge_media_to_caption?.edges?.[0]?.node?.text || ''
        const mediaType = media.media_type // 1 photo, 2 video, 8 carousel
        postsSeen++

        // Carousel: walk carousel_media[] and append every photo entry,
        // skipping any video frames inside. Index is 1-based to match
        // how Instagram numbers carousel positions.
        if (mediaType === 8 && Array.isArray(media.carousel_media)) {
          const total = media.carousel_media.length
          let position = 0
          for (const carItem of media.carousel_media) {
            position++
            const itemType = carItem.media_type
            if (itemType === 2 || carItem.video_versions || carItem.is_video) continue
            const thumb = pickThumb(carItem)
            const fullRes = pickFullRes(carItem)
            if (!thumb && !fullRes) continue
            images.push({
              code, postUrl,
              carouselIndex: position,
              carouselTotal: total,
              thumbnail: thumb || fullRes,
              fullResUrl: fullRes || thumb,
              postedAt,
              caption: String(caption || '').slice(0, 500),
              alreadyImported: existingKeys.has(`${code}|${position}`),
            })
          }
          continue
        }

        // Single photo. Skip videos entirely.
        if (mediaType === 1) {
          const thumb = pickThumb(media)
          const fullRes = pickFullRes(media)
          if (!thumb && !fullRes) continue
          images.push({
            code, postUrl,
            carouselIndex: 1,
            carouselTotal: 1,
            thumbnail: thumb || fullRes,
            fullResUrl: fullRes || thumb,
            postedAt,
            caption: String(caption || '').slice(0, 500),
            alreadyImported: existingKeys.has(`${code}|1`),
          })
        }
        // mediaType === 2 (video) is intentionally skipped — this
        // endpoint is for photos only. Reels live in a separate flow.
      }
      paginationToken = data.pagination_token
      // Stop when we hit pagination end OR we've collected enough images.
      // limit*4 image cap = enough headroom for big carousels under the
      // requested post-depth without runaway memory.
      if (!paginationToken || posts.length === 0 || images.length >= limit * 4) break
    }

    // Final trim — generous so carousels don't get cut off mid-post.
    const trimmed = images.slice(0, limit * 5)

    // Persist to the Photo Accounts row so future Browse opens skip
    // RapidAPI entirely. Strip the alreadyImported flag from the
    // cache payload — that's recomputed on every read from the live
    // Photos table. Captions truncated to 200 chars to keep the
    // multilineText field well under the 100KB cell cap (200 imgs
    // x ~400 bytes = ~80KB after pretty-print).
    const fetchedAt = new Date().toISOString()
    if (accountId) {
      try {
        const blob = {
          fetchedAt,
          postsSeen,
          imageCount: trimmed.length,
          images: trimmed.map(({ alreadyImported, caption, ...rest }) => ({ ...rest, caption: (caption || '').slice(0, 200) })),
        }
        const serialized = JSON.stringify(blob)
        // Hard cap at 95KB — Airtable's multilineText soft limit is
        // 100KB. If we exceed it, drop captions and re-serialize.
        let payload = serialized
        if (serialized.length > 95_000) {
          const lean = { ...blob, images: blob.images.map(i => ({ ...i, caption: '' })) }
          payload = JSON.stringify(lean)
        }
        await patchAirtableRecord('Photo Accounts', accountId, {
          'Scrape Cache': payload,
          'Last Scraped At': fetchedAt,
          'Last Photos Scraped': trimmed.length,
        }, { typecast: true })
      } catch (e) {
        console.warn('[photos/preview] cache write failed:', e.message)
      }
    }

    return NextResponse.json({
      ok: true,
      handle,
      postsSeen,
      total: trimmed.length,
      alreadyImportedCount: trimmed.filter(i => i.alreadyImported).length,
      images: trimmed,
      cachedAt: fetchedAt,
      fromCache: false,
      // Diagnostic surface — only meaningful when postsSeen === 0
      // and the editor needs to see why. Lists the response shape so
      // we can spot a renamed key (e.g. "feed_items" vs "posts").
      _debug: (postsSeen === 0 && trimmed.length === 0) ? firstResponseShape : undefined,
    })
  } catch (err) {
    if (err instanceof Response) return err
    const msg = typeof err?.message === 'string' && err.message ? err.message : String(err)
    console.error('[photos/preview] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// RapidAPI returns image_versions2.candidates ordered by size (largest
// usually first). For thumbnails we grab the smallest; for full-res
// we grab the largest. Falls back to display_url shapes.
function pickThumb(m) {
  const cands = m?.image_versions2?.candidates
  if (Array.isArray(cands) && cands.length) {
    const sorted = [...cands].sort((a, b) => (a.width || 0) - (b.width || 0))
    return sorted[0]?.url || cands[cands.length - 1]?.url || ''
  }
  return m?.display_url || m?.thumbnail_url || ''
}

function pickFullRes(m) {
  const cands = m?.image_versions2?.candidates
  if (Array.isArray(cands) && cands.length) {
    const sorted = [...cands].sort((a, b) => (b.width || 0) - (a.width || 0))
    return sorted[0]?.url || ''
  }
  return m?.display_url || ''
}
