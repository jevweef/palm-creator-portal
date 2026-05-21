import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST || 'instagram-scraper-stable-api.p.rapidapi.com'

// GET /api/admin/inspo/preview-reels?handle=X&limit=30
//
// Cheap preview scrape — pulls the handle's recent reels from RapidAPI
// (1-2 API calls returning thumbnails + metadata) so the admin can
// browse before paying the full pipeline cost. Reels already in
// Source Reels for this handle are flagged so the UI can dim them
// (no point re-importing). Nothing gets written to Airtable here.
export async function GET(request) {
  try {
    await requireAdmin()
    if (!RAPIDAPI_KEY) return NextResponse.json({ error: 'RAPIDAPI_KEY not set' }, { status: 500 })

    const u = new URL(request.url)
    const handle = (u.searchParams.get('handle') || '').replace(/^@/, '').trim()
    const limit = Math.min(60, Math.max(5, parseInt(u.searchParams.get('limit') || '30', 10)))
    if (!handle) return NextResponse.json({ error: 'handle required' }, { status: 400 })

    // Load existing Source Reels for this handle to mark already-imported
    // ones in the preview grid. Cheap — one Airtable call, all clientside.
    const existing = await fetchAirtableRecords('Source Reels', {
      fields: ['Reel URL'],
      filterByFormula: `{Source Handle} = "${handle}"`,
    })
    const existingCodes = new Set()
    for (const r of existing) {
      const url = r.fields?.['Reel URL'] || ''
      const m = url.match(/\/(?:reel|p)\/([A-Za-z0-9_-]+)/)
      if (m) existingCodes.add(m[1])
    }

    // RapidAPI paginated fetch up to `limit` reels.
    const items = []
    let paginationToken = null
    const maxPages = Math.ceil(limit / 12) + 1
    for (let page = 0; page < maxPages; page++) {
      let body = `username_or_url=${encodeURIComponent(handle)}&amount=50`
      if (paginationToken) body += `&pagination_token=${paginationToken}`
      const res = await fetch(`https://${RAPIDAPI_HOST}/get_ig_user_reels.php`, {
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

      const reels = data.reels || data.items || []
      for (const node of reels) {
        const media = node?.node?.media || node?.media || {}
        const code = media.code || media.shortcode
        if (!code) continue
        const takenAt = media.taken_at || media.taken_at_timestamp
        const likes = media?.like_count || media?.edge_media_preview_like?.count || media?.edge_liked_by?.count || 0
        const comments = media?.comment_count || media?.edge_media_to_comment?.count || 0
        const plays = media?.play_count || media?.video_play_count || 0
        const caption = media?.caption?.text || media?.edge_media_to_caption?.edges?.[0]?.node?.text || ''
        const thumbnail = media?.image_versions2?.candidates?.[0]?.url || media?.display_url || media?.thumbnail_url || ''
        const duration = media?.video_duration || null
        items.push({
          code,
          url: `https://www.instagram.com/reel/${code}/`,
          thumbnail,
          postedAt: takenAt
            ? new Date(typeof takenAt === 'number' ? takenAt * 1000 : Date.parse(takenAt)).toISOString()
            : null,
          likes, comments, plays,
          duration,
          caption: String(caption || '').slice(0, 600),
          alreadyImported: existingCodes.has(code),
        })
      }
      paginationToken = data.pagination_token
      if (!paginationToken || reels.length === 0 || items.length >= limit) break
    }

    return NextResponse.json({
      ok: true,
      handle,
      total: items.length,
      alreadyImportedCount: items.filter(i => i.alreadyImported).length,
      reels: items.slice(0, limit),
    })
  } catch (err) {
    if (err instanceof Response) return err
    const msg = typeof err?.message === 'string' && err.message ? err.message : String(err)
    console.error('[inspo/preview-reels] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
