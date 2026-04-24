export const dynamic = 'force-dynamic'
export const maxDuration = 120

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST || 'instagram-scraper-stable-api.p.rapidapi.com'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours
const AUTO_LINK_WINDOW_MS = 24 * 60 * 60 * 1000 // ±24h to match planned↔posted

// ─── Scrapers ──────────────────────────────────────────────────────────────────

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

// Normalize a RapidAPI media node into our cell shape.
// /p/{code}/ works for both reels AND photo posts (IG redirects /reel/ → /p/).
// Using /p/ universally avoids 404s when the scraper classifies a post as a
// reel but IG deleted the reel or it was actually a regular post.
function normalizeMediaNode(node) {
  const media = node?.node?.media || node?.media || node || {}
  const code = media.code || media.shortcode || media.shortcode_media?.shortcode
  if (!code) return null
  const takenAt = media.taken_at || media.taken_at_timestamp
  const caption =
    media?.caption?.text ||
    media?.edge_media_to_caption?.edges?.[0]?.node?.text ||
    ''
  const likes =
    media?.like_count ||
    media?.edge_media_preview_like?.count ||
    media?.edge_liked_by?.count ||
    0
  const thumbnail =
    media?.image_versions2?.candidates?.[0]?.url ||
    media?.display_uri ||
    media?.display_url ||
    media?.thumbnail_url ||
    ''
  const mediaType = media.media_type // 1 photo, 2 video, 8 carousel
  const isVideo = mediaType === 2 || !!media.video_versions || !!media.is_video
  return {
    url: `https://www.instagram.com/p/${code}/`,
    code,
    thumbnail,
    postedAt: takenAt
      ? new Date((typeof takenAt === 'number' ? takenAt * 1000 : Date.parse(takenAt))).toISOString()
      : null,
    likes,
    caption: caption.slice(0, 200),
    isVideo,
  }
}

async function rapidPost(endpoint, body) {
  const res = await fetch(`https://${RAPIDAPI_HOST}/${endpoint}`, {
    method: 'POST',
    headers: {
      'x-rapidapi-host': RAPIDAPI_HOST,
      'x-rapidapi-key': RAPIDAPI_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })
  if (!res.ok) throw new Error(`${endpoint} ${res.status}`)
  const data = await res.json()
  if (data.error) throw new Error(`${endpoint}: ${data.error}`)
  return data
}

// Scrape REELS (vertical short videos). Paginated.
async function scrapeReels(cleanHandle) {
  const items = []
  let paginationToken = null
  for (let page = 0; page < 3; page++) {
    let body = `username_or_url=${encodeURIComponent(cleanHandle)}&amount=50`
    if (paginationToken) body += `&pagination_token=${paginationToken}`
    const data = await rapidPost('get_ig_user_reels.php', body)
    const reels = data.reels || data.items || []
    for (const node of reels) {
      const item = normalizeMediaNode(node)
      if (item) items.push(item)
    }
    paginationToken = data.pagination_token
    if (!paginationToken || reels.length === 0 || items.length >= 30) break
  }
  return items
}

// Scrape regular FEED POSTS (photos, carousels, videos in the grid tab).
// Reels live in a separate endpoint on IG. We need both to match what the
// admin actually sees on the profile page.
async function scrapePosts(cleanHandle) {
  const items = []
  let paginationToken = null
  for (let page = 0; page < 3; page++) {
    let body = `username_or_url=${encodeURIComponent(cleanHandle)}&amount=50`
    if (paginationToken) body += `&pagination_token=${paginationToken}`
    // Endpoint naming varies across RapidAPI scrapers; try the common one first.
    const data = await rapidPost('get_ig_user_posts.php', body)
    const posts = data.posts || data.items || data.data || []
    for (const node of posts) {
      const item = normalizeMediaNode(node)
      if (item) items.push(item)
    }
    paginationToken = data.pagination_token
    if (!paginationToken || posts.length === 0 || items.length >= 30) break
  }
  return items
}

async function scrapeIgFeed(handle) {
  if (!RAPIDAPI_KEY) throw new Error('RAPIDAPI_KEY not set')
  const cleanHandle = handle.replace(/^@/, '').trim()
  if (!cleanHandle) return []

  // Fetch reels + posts in parallel. If either fails, we still return what we
  // got from the other so the grid at least shows something.
  const [reelResult, postsResult] = await Promise.allSettled([
    scrapeReels(cleanHandle),
    scrapePosts(cleanHandle),
  ])

  const reels = reelResult.status === 'fulfilled' ? reelResult.value : []
  const posts = postsResult.status === 'fulfilled' ? postsResult.value : []

  // If BOTH failed, throw so the caller records the error.
  if (reelResult.status === 'rejected' && postsResult.status === 'rejected') {
    throw new Error(reelResult.reason?.message || postsResult.reason?.message || 'scrape failed')
  }

  // Combine and dedupe by shortcode (some items appear in both feeds).
  const byCode = new Map()
  for (const it of [...posts, ...reels]) {
    if (!byCode.has(it.code)) byCode.set(it.code, it)
  }
  return Array.from(byCode.values()).sort((a, b) =>
    new Date(b.postedAt || 0) - new Date(a.postedAt || 0)
  )
}

// ─── Accumulate helpers ────────────────────────────────────────────────────────

// When the scraper returns a non-empty result, REPLACE the cached feed with it.
// Previously we merged, which meant deleted IG posts lingered in the grid
// forever (and produced broken /reel/ links). Fresh wins: if IG says these
// are the current top 30 posts, those are what we show.
// If fresh is empty (API blip) we keep existing so we don't wipe data on a
// transient failure.
function mergeFeeds(existing, fresh) {
  if (!fresh || fresh.length === 0) return existing || []
  return [...fresh].sort((a, b) =>
    new Date(b.postedAt || 0) - new Date(a.postedAt || 0)
  )
}

// Parse old Scraped Feed safely. Returns [] if the field held an error shape
// (our older code used to overwrite posts with error JSON — we tolerate it).
function parseExistingFeed(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
    return [] // error-shaped object from older versions — we now store errors separately
  } catch {
    return []
  }
}

// ─── Planned → Posted auto-matching ────────────────────────────────────────────

// When a newly-scraped IG post lands, see if it corresponds to one of our
// "Prepping" or "Scheduled" Post records. If so, flip that Post record to Posted
// and link the IG URL. This closes the loop between our planner and reality.
//
// Match rules (first one that matches wins):
//   1. Caption prefix (≥30 chars) matches a scheduled post's Caption → strong link
//   2. Scheduled Date within ±AUTO_LINK_WINDOW_MS of postedAt, and the planned
//      Post is linked to the same Account → time-proximity link (only if there
//      is exactly one such candidate; ambiguous matches are skipped)
async function autoLinkScrapedToPlanned(accountId, scrapedPosts) {
  if (!accountId || !scrapedPosts?.length) return { linked: 0, skipped: 0 }

  // Load not-yet-posted Post records linked to this Account
  const plannedRecs = await fetchAirtableRecords('Posts', {
    filterByFormula: `AND(FIND('${accountId}', ARRAYJOIN({Account}))>0, {Posted At}='', {Post Link}='')`,
    fields: ['Post Name', 'Caption', 'Scheduled Date', 'Status', 'Account', 'Posted At', 'Post Link'],
  })
  // Filter in JS: ARRAYJOIN returns account NAMES not IDs on 'Account', so the
  // formula above is a coarse filter. Narrow down here.
  const accountMatched = plannedRecs.filter(r => (r.fields?.Account || []).includes(accountId))
  if (!accountMatched.length) return { linked: 0, skipped: 0 }

  let linked = 0
  let skipped = 0
  const used = new Set() // track planned post IDs already linked this pass

  // Only consider recently-posted scraped items (last 7 days) to avoid linking
  // ancient history to upcoming scheduled posts.
  const now = Date.now()
  const candidates = scrapedPosts.filter(sp => {
    if (!sp.postedAt) return false
    const age = now - new Date(sp.postedAt).getTime()
    return age >= 0 && age < 7 * 24 * 60 * 60 * 1000
  })

  for (const sp of candidates) {
    const spPostedAt = new Date(sp.postedAt).getTime()

    // Rule 1: caption prefix match
    let match = null
    if (sp.caption && sp.caption.length >= 30) {
      const scrapedPrefix = sp.caption.slice(0, 30).toLowerCase().replace(/\s+/g, ' ').trim()
      match = accountMatched.find(p => {
        if (used.has(p.id)) return false
        const cap = (p.fields?.Caption || '').slice(0, 30).toLowerCase().replace(/\s+/g, ' ').trim()
        return cap.length >= 30 && cap === scrapedPrefix
      })
    }

    // Rule 2: unambiguous time-proximity match
    if (!match) {
      const inWindow = accountMatched.filter(p => {
        if (used.has(p.id)) return false
        const sd = p.fields?.['Scheduled Date']
        if (!sd) return false
        return Math.abs(new Date(sd).getTime() - spPostedAt) <= AUTO_LINK_WINDOW_MS
      })
      if (inWindow.length === 1) match = inWindow[0]
      else if (inWindow.length > 1) { skipped++; continue }
    }

    if (!match) continue

    try {
      await patchAirtableRecord('Posts', match.id, {
        'Status': 'Posted',
        'Posted At': sp.postedAt,
        'Post Link': sp.url,
      })
      used.add(match.id)
      linked++
      console.log(`[Auto-link] Planned post ${match.id} → ${sp.url}`)
    } catch (err) {
      console.warn(`[Auto-link] Failed to update ${match.id}:`, err.message)
    }
  }

  return { linked, skipped }
}

// ─── Endpoint ──────────────────────────────────────────────────────────────────

export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { accountId, creatorId, force } = await request.json()
    if (!accountId && !creatorId) {
      return NextResponse.json({ error: 'accountId or creatorId required' }, { status: 400 })
    }

    const commonFields = [
      'Account Name', 'Handle/ Username', 'Handle Override', 'Platform',
      'Scraped Feed', 'Scraped Feed Updated',
    ]
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

    const now = Date.now()
    const results = await Promise.all(accounts.map(async (a) => {
      const name = a.fields?.['Account Name'] || ''
      const handle = ((a.fields?.['Handle Override'] || '').trim() || (a.fields?.['Handle/ Username'] || '').trim())
      if (!handle) return { id: a.id, name, ok: false, error: 'No handle' }

      // Cache: skip if scraped recently (unless force)
      const lastUpdated = a.fields?.['Scraped Feed Updated']
      if (!force && lastUpdated) {
        const ageMs = now - new Date(lastUpdated).getTime()
        if (ageMs < CACHE_TTL_MS) {
          return { id: a.id, name, ok: true, skipped: true, ageHours: Number((ageMs / 3600000).toFixed(1)) }
        }
      }

      const existingFeed = parseExistingFeed(a.fields?.['Scraped Feed'])

      try {
        const [profile, fresh] = await Promise.all([
          scrapeIgProfile(handle).catch(err => { console.warn(`[Refresh] profile ${name}:`, err.message); return null }),
          scrapeIgFeed(handle),
        ])

        // Merge fresh into existing (fresh replaces when non-empty)
        const mergedFeed = mergeFeeds(existingFeed, fresh)
        // Compare by code, not URL — we recently changed URL format from
        // /reel/{code}/ to /p/{code}/ so full-URL comparison would flag
        // everything as "new" on the first post-format migration.
        const existingCodes = new Set(
          (existingFeed || []).map(e => e.code || (e.url || '').split('/').filter(Boolean).pop())
        )
        const newOnes = fresh.filter(f => !existingCodes.has(f.code))

        // Auto-link any newly-seen scraped posts to planned Post records
        const { linked } = newOnes.length
          ? await autoLinkScrapedToPlanned(a.id, newOnes)
          : { linked: 0 }

        const update = {
          'Scraped Feed': JSON.stringify(mergedFeed),
          'Scraped Feed Updated': new Date().toISOString(),
          'Scraped Error': '', // clear any prior error
        }
        if (profile) update['Scraped Profile'] = JSON.stringify(profile)
        await patchAirtableRecord('Creator Platform Directory', a.id, update)

        return {
          id: a.id, name, ok: true,
          total: mergedFeed.length,
          newCount: newOnes.length,
          linked,
          followers: profile?.followers,
        }
      } catch (err) {
        console.error(`[Refresh] ${name} failed:`, err.message)
        // Preserve existing Scraped Feed — only write the error field
        try {
          await patchAirtableRecord('Creator Platform Directory', a.id, {
            'Scraped Error': err.message.slice(0, 500),
          })
        } catch {}
        return { id: a.id, name, ok: false, error: err.message, preservedCount: existingFeed.length }
      }
    }))

    return NextResponse.json({
      ok: true,
      refreshed: results.filter(r => r.ok && !r.skipped).length,
      skipped: results.filter(r => r.skipped).length,
      failed: results.filter(r => !r.ok).length,
      totalLinked: results.reduce((s, r) => s + (r.linked || 0), 0),
      results,
    })
  } catch (err) {
    console.error('[Refresh] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
