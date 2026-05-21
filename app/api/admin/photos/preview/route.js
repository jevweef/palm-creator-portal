import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST || 'instagram-scraper-stable-api.p.rapidapi.com'

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
    const handle = (u.searchParams.get('handle') || '').replace(/^@/, '').trim()
    const limit = Math.min(60, Math.max(5, parseInt(u.searchParams.get('limit') || '30', 10)))
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

    const images = [] // exploded list — one entry per image
    let postsSeen = 0
    let paginationToken = null
    const maxPages = 4
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

      const posts = data.posts || data.items || data.data || []
      for (const node of posts) {
        const media = node?.node?.media || node?.media || node || {}
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
      if (!paginationToken || posts.length === 0 || images.length >= limit * 2) break
    }

    // Cap returned image count. Carousels can balloon fast — 30 posts
    // could be 100+ images — so we trim after explosion so the grid
    // stays a reasonable size.
    const trimmed = images.slice(0, limit * 3)

    return NextResponse.json({
      ok: true,
      handle,
      postsSeen,
      total: trimmed.length,
      alreadyImportedCount: trimmed.filter(i => i.alreadyImported).length,
      images: trimmed,
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
