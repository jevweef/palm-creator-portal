import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, batchUpdateRecords } from '@/lib/adminAuth'

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
    const n = Number(data.follower_count || data.edge_followed_by?.count) || null
    return n
  } catch {
    return null
  }
}

/**
 * POST — fetch missing Follower Count values for handles in the review queue
 * via RapidAPI, in batches small enough to fit a single Vercel invocation.
 *
 * Body: { limit?: number }   (default 25)
 * Returns: { processed, remaining, totalUnknown, results: [{handle, followerCount}] }
 *
 * The Candidates API takes the max Follower Count across a handle's Source
 * Reels records, so we only update ONE representative record per handle and
 * the Candidates view picks it up immediately.
 */
export async function POST(request) {
  try {
    await requireAdmin()
  } catch (e) { return e }

  if (!RAPIDAPI_KEY) {
    return NextResponse.json({ error: 'RAPIDAPI_KEY not configured' }, { status: 500 })
  }

  let limit = 25
  try {
    const body = await request.json()
    if (typeof body.limit === 'number') limit = Math.min(Math.max(body.limit, 1), 50)
  } catch {}

  try {
    // Pull pending Source Reels grouped by handle. Pick handles that have
    // no follower count anywhere across their records and aren't already on
    // Inspo Sources (no need to enrich accounts the admin has already classified).
    const reels = await fetchAirtableRecords('Source Reels', {
      fields: ['Username', 'Source Handle', 'Review Status', 'Follower Count'],
    })

    const byHandle = new Map() // handleLower -> { handle, anyFollower, firstRecordId }
    for (const r of reels) {
      const f = r.fields || {}
      const status = (f['Review Status']?.name || f['Review Status'] || '').toLowerCase()
      if (status && status !== 'pending review') continue
      const raw = (f.Username || f['Source Handle'] || '').toString().trim().replace(/^@/, '')
      if (!raw) continue
      const key = raw.toLowerCase()
      const fc = Number(f['Follower Count']) || 0
      const cur = byHandle.get(key)
      if (!cur) {
        byHandle.set(key, { handle: raw, anyFollower: fc, firstRecordId: r.id })
      } else if (fc && fc > cur.anyFollower) {
        cur.anyFollower = fc
      }
    }

    const sources = await fetchAirtableRecords('Inspo Sources', { fields: ['Handle'] })
    const onSources = new Set()
    for (const r of sources) {
      const h = (r.fields?.Handle || '').toString().trim().replace(/^@/, '').toLowerCase()
      if (h) onSources.add(h)
    }

    const unknownHandles = []
    for (const [key, v] of byHandle.entries()) {
      if (onSources.has(key)) continue
      if (v.anyFollower) continue
      unknownHandles.push(v)
    }

    const totalUnknown = unknownHandles.length
    const batch = unknownHandles.slice(0, limit)

    // Fetch follower counts in parallel
    const results = await Promise.all(
      batch.map(async (h) => ({
        handle: h.handle,
        recordId: h.firstRecordId,
        followerCount: await fetchFollowerCount(h.handle),
      }))
    )

    // Build Airtable updates — only for handles where the fetch succeeded.
    // We mark misses by writing 0 so we don't re-fetch them on the next pass.
    const updates = results.map(r => ({
      id: r.recordId,
      fields: { 'Follower Count': r.followerCount ?? 0 },
    }))

    if (updates.length > 0) {
      await batchUpdateRecords('Source Reels', updates)
    }

    return NextResponse.json({
      processed: results.length,
      remaining: Math.max(totalUnknown - results.length, 0),
      totalUnknown,
      results: results.map(r => ({ handle: r.handle, followerCount: r.followerCount })),
    })
  } catch (err) {
    console.error('[enrich-candidates] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
