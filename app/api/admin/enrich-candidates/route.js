import { NextResponse } from 'next/server'
import { requireAdmin, batchUpdateRecords } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST || 'instagram-scraper-stable-api.p.rapidapi.com'

async function fetchFollowerCount(username) {
  if (!RAPIDAPI_KEY || !username) return null
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(`https://${RAPIDAPI_HOST}/ig_get_fb_profile_v3.php`, {
      method: 'POST',
      headers: {
        'x-rapidapi-host': RAPIDAPI_HOST,
        'x-rapidapi-key': RAPIDAPI_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `username_or_url=${encodeURIComponent(username)}`,
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) return null
    const data = await res.json()
    return Number(data.follower_count || data.edge_followed_by?.count) || null
  } catch {
    return null
  }
}

/**
 * POST — enrich Follower Count for an explicit list of handles passed in
 * by the client. The client computes the unknown set once via
 * /api/admin/source-candidates and pages through here in small batches.
 *
 * We deliberately do NOT refetch Source Reels on every call — that pagination
 * step was the 504 cause; with 5000+ records it eats 15-25s before any
 * RapidAPI call fires.
 *
 * Body: { handles: [{ handle: string, recordId: string }] }
 * Returns: { results: [{ handle, followerCount }] }
 *
 * Misses are persisted to Airtable as 0 so /source-candidates sees them as
 * `attempted: true` and they leave the unknown set.
 */
export async function POST(request) {
  try {
    await requireAdmin()
  } catch (e) { return e }

  if (!RAPIDAPI_KEY) {
    return NextResponse.json({ error: 'RAPIDAPI_KEY not configured' }, { status: 500 })
  }

  let handles = []
  try {
    const body = await request.json()
    if (Array.isArray(body.handles)) handles = body.handles
  } catch {}

  handles = handles
    .filter(h => h && typeof h.handle === 'string' && typeof h.recordId === 'string')
    .slice(0, 15) // defensive cap — keeps serial loop under 60s

  if (handles.length === 0) {
    return NextResponse.json({ results: [] })
  }

  try {
    const results = []
    for (const h of handles) {
      const followerCount = await fetchFollowerCount(h.handle)
      results.push({ handle: h.handle, recordId: h.recordId, followerCount })
    }

    const updates = results.map(r => ({
      id: r.recordId,
      fields: { 'Follower Count': r.followerCount ?? 0 },
    }))

    await batchUpdateRecords('Source Reels', updates)

    return NextResponse.json({
      results: results.map(r => ({ handle: r.handle, followerCount: r.followerCount })),
    })
  } catch (err) {
    console.error('[enrich-candidates] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
