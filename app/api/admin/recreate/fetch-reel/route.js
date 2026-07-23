import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// POST { url } — fetch ANY public Instagram reel's video on demand via Apify
// (synchronous run, ~20-60s). Lets the Text-to-Video bridge accept reels that
// were never scraped into the inspo library: we only need a fetchable video
// URL for the dissection, not a stored library record.
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const { url } = await request.json()
    const m = String(url || '').match(/instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/)
    if (!m) return NextResponse.json({ error: 'Not an Instagram reel URL' }, { status: 400 })
    const token = process.env.APIFY_TOKEN
    if (!token) return NextResponse.json({ error: 'APIFY_TOKEN not configured' }, { status: 500 })

    const cleanUrl = `https://www.instagram.com/reel/${m[1]}/`
    const res = await fetch(
      `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${token}&timeout=90`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directUrls: [cleanUrl], resultsType: 'posts', resultsLimit: 1, addParentData: false }),
      }
    )
    const items = await res.json().catch(() => null)
    if (!res.ok || !Array.isArray(items)) {
      return NextResponse.json({ error: `Instagram fetch failed (${res.status}) — is the reel public?` }, { status: 502 })
    }
    const item = items[0] || {}
    const videoUrl = item.videoUrl || item.video_url || null
    if (!videoUrl) {
      return NextResponse.json({ error: 'Could not get the video from Instagram — reel may be private or removed' }, { status: 404 })
    }
    return NextResponse.json({
      ok: true,
      shortcode: m[1],
      videoUrl,
      username: item.ownerUsername || item.owner_username || '',
      caption: (item.caption || '').slice(0, 300),
      thumbnail: item.displayUrl || item.display_url || null,
    })
  } catch (err) {
    console.error('[fetch-reel] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
