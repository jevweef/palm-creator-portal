export const dynamic = 'force-dynamic'
export const maxDuration = 120

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST || 'instagram-scraper-stable-api.p.rapidapi.com'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

// Pull profile info (bio, counts, avatar) for an IG handle.
async function scrapeIgProfile(handle) {
  if (!RAPIDAPI_KEY) return null
  const cleanHandle = handle.replace(/^@/, '').trim()
  const res = await fetch(`https://${RAPIDAPI_HOST}/ig_get_fb_profile_v3.php`, {
    method: 'POST',
    headers: {
      'x-rapidapi-host': RAPIDAPI_HOST,
      'x-rapidapi-key': RAPIDAPI_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `username_or_url=${encodeURIComponent(cleanHandle)}`,
  })
  if (!res.ok) throw new Error(`profile ${res.status}`)
  const d = await res.json()
  if (d.error) throw new Error(`profile: ${d.error}`)
  return {
    followers: d.follower_count ?? d.edge_followed_by?.count ?? null,
    following: d.following_count ?? d.edge_follow?.count ?? null,
    bio: d.biography || d.bio || '',
    fullName: d.full_name || d.fullname || '',
    profilePicUrl: d.hd_profile_pic_url_info?.url || d.profile_pic_url_hd || d.profile_pic_url || '',
    isVerified: !!d.is_verified,
    isPrivate: !!d.is_private,
    postCount: d.media_count ?? d.edge_owner_to_timeline_media?.count ?? null,
  }
}

// Pull the last ~30 reels from an IG handle, extract thumbnails + dates + URLs.
// RapidAPI is synchronous (unlike Apify batch jobs) so this finishes in a few seconds.
async function scrapeIgFeed(handle) {
  if (!RAPIDAPI_KEY) throw new Error('RAPIDAPI_KEY not set')
  const cleanHandle = handle.replace(/^@/, '').trim()
  if (!cleanHandle) return []

  const items = []
  let paginationToken = null
  // 3 pages ~ 36 posts — plenty for grid planning
  for (let page = 0; page < 3; page++) {
    let body = `username_or_url=${encodeURIComponent(cleanHandle)}&amount=50`
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
    if (!res.ok) throw new Error(`RapidAPI ${res.status} for @${cleanHandle}`)
    const data = await res.json()
    if (data.error) throw new Error(`RapidAPI: ${data.error}`)

    const reels = data.reels || []
    for (const node of reels) {
      const media = node?.node?.media || node?.media || {}
      const code = media.code
      if (!code) continue
      const takenAt = media.taken_at
      const caption = media?.caption?.text || ''
      const likes = media?.like_count || media?.edge_media_preview_like?.count || 0
      // Thumbnail: try multiple paths
      const thumbnail =
        media?.image_versions2?.candidates?.[0]?.url ||
        media?.display_uri ||
        media?.display_url ||
        ''
      items.push({
        url: `https://www.instagram.com/reel/${code}/`,
        thumbnail,
        postedAt: takenAt ? new Date(takenAt * 1000).toISOString() : null,
        likes,
        caption: caption.slice(0, 200),
      })
    }
    paginationToken = data.pagination_token
    if (!paginationToken || reels.length === 0 || items.length >= 30) break
  }

  // Dedupe by url, sort newest first
  const byUrl = {}
  for (const it of items) byUrl[it.url] = it
  return Object.values(byUrl)
    .sort((a, b) => new Date(b.postedAt || 0) - new Date(a.postedAt || 0))
    .slice(0, 30)
}

// POST /api/admin/grid-planner/refresh-feed
//   body: { accountId: 'rec...' } → refresh ONE account
//   body: { creatorId: 'rec...' } → refresh ALL IG accounts for a creator (in parallel)
//   body: { force: true } → bypass the 6h cache, re-scrape everything
//
// Cache behavior (to avoid burning RapidAPI quota):
//   If an account's Scraped Feed Updated is within CACHE_TTL_MS (6h), skip it.
//   Returns { skipped: N } for those.
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { accountId, creatorId, force } = await request.json()
    if (!accountId && !creatorId) {
      return NextResponse.json({ error: 'accountId or creatorId required' }, { status: 400 })
    }

    // Resolve target accounts — include Scraped Feed Updated for cache check
    const commonFields = ['Account Name', 'Handle/ Username', 'Handle Override', 'Platform', 'Scraped Feed Updated']
    let accounts
    if (accountId) {
      accounts = await fetchAirtableRecords('Creator Platform Directory', {
        filterByFormula: `RECORD_ID()='${accountId}'`,
        fields: commonFields,
      })
    } else {
      accounts = await fetchAirtableRecords('Creator Platform Directory', {
        filterByFormula: `AND({Platform}='Instagram',{Managed by Palm}=1,{Status}!='Does Not Exist',FIND('${creatorId}', ARRAYJOIN({Creator}))>0)`,
        fields: [...commonFields, 'Creator'],
      })
      // Fallback: ARRAYJOIN returns names, not IDs — if the filter missed, widen and filter in JS
      if (!accounts.length) {
        const all = await fetchAirtableRecords('Creator Platform Directory', {
          filterByFormula: `AND({Platform}='Instagram',{Managed by Palm}=1,{Status}!='Does Not Exist')`,
          fields: [...commonFields, 'Creator'],
        })
        accounts = all.filter(a => (a.fields?.Creator || []).includes(creatorId))
      }
    }

    if (!accounts.length) {
      return NextResponse.json({ error: 'No accounts found' }, { status: 404 })
    }

    // Scrape in parallel, isolate per-account failures. Write a timestamp either
    // way so the UI can distinguish "never attempted" vs "tried and failed"
    // (failed writes store an error message in the JSON so the grid cell can
    // show the reason).
    const now = Date.now()
    const results = await Promise.all(accounts.map(async (a) => {
      const name = a.fields?.['Account Name'] || ''
      // Prefer Handle Override (manually set) over the synced Handle/Username field.
      // CPD's Handle/Username syncs from HQ and can be stale.
      const handle = ((a.fields?.['Handle Override'] || '').trim() || (a.fields?.['Handle/ Username'] || '').trim())
      if (!handle) return { id: a.id, name, ok: false, error: 'No handle' }

      // Cache: skip if scraped recently, unless force=true
      const lastUpdated = a.fields?.['Scraped Feed Updated']
      if (!force && lastUpdated) {
        const ageMs = now - new Date(lastUpdated).getTime()
        if (ageMs < CACHE_TTL_MS) {
          const ageHours = (ageMs / (60 * 60 * 1000)).toFixed(1)
          return { id: a.id, name, ok: true, skipped: true, ageHours: Number(ageHours) }
        }
      }

      // Fetch profile + posts in parallel
      try {
        const [profile, feed] = await Promise.all([
          scrapeIgProfile(handle).catch(err => { console.warn(`[Refresh] profile ${name}:`, err.message); return null }),
          scrapeIgFeed(handle),
        ])
        const update = {
          'Scraped Feed': JSON.stringify(feed),
          'Scraped Feed Updated': new Date().toISOString(),
        }
        if (profile) {
          update['Scraped Profile'] = JSON.stringify(profile)
          // Also write to the canonical Follower Count field (number, sortable in Airtable)
          if (profile.followers != null) update['Follower Count'] = profile.followers
        }
        await patchAirtableRecord('Creator Platform Directory', a.id, update)
        return { id: a.id, name, ok: true, count: feed.length, followers: profile?.followers }
      } catch (err) {
        console.error(`[Grid Planner Refresh] ${name} failed:`, err.message)
        try {
          await patchAirtableRecord('Creator Platform Directory', a.id, {
            'Scraped Feed': JSON.stringify({ error: err.message, attemptedAt: new Date().toISOString() }),
            'Scraped Feed Updated': new Date().toISOString(),
          })
        } catch {}
        return { id: a.id, name, ok: false, error: err.message }
      }
    }))

    return NextResponse.json({
      ok: true,
      refreshed: results.filter(r => r.ok && !r.skipped).length,
      skipped: results.filter(r => r.skipped).length,
      failed: results.filter(r => !r.ok).length,
      results,
    })
  } catch (err) {
    console.error('[Grid Planner Refresh] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
