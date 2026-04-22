export const dynamic = 'force-dynamic'
export const maxDuration = 120

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST || 'instagram-scraper-stable-api.p.rapidapi.com'

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
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { accountId, creatorId } = await request.json()
    if (!accountId && !creatorId) {
      return NextResponse.json({ error: 'accountId or creatorId required' }, { status: 400 })
    }

    // Resolve target accounts
    let accounts
    if (accountId) {
      accounts = await fetchAirtableRecords('Creator Platform Directory', {
        filterByFormula: `RECORD_ID()='${accountId}'`,
        fields: ['Account Name', 'Handle/ Username', 'Platform'],
      })
    } else {
      accounts = await fetchAirtableRecords('Creator Platform Directory', {
        filterByFormula: `AND({Platform}='Instagram',{Managed by Palm}=1,{Status}!='Does Not Exist',FIND('${creatorId}', ARRAYJOIN({Creator}))>0)`,
        fields: ['Account Name', 'Handle/ Username', 'Platform', 'Creator'],
      })
      // Fallback: ARRAYJOIN returns names, not IDs — if the filter missed, widen and filter in JS
      if (!accounts.length) {
        const all = await fetchAirtableRecords('Creator Platform Directory', {
          filterByFormula: `AND({Platform}='Instagram',{Managed by Palm}=1,{Status}!='Does Not Exist')`,
          fields: ['Account Name', 'Handle/ Username', 'Platform', 'Creator'],
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
    const results = await Promise.all(accounts.map(async (a) => {
      const name = a.fields?.['Account Name'] || ''
      const handle = (a.fields?.['Handle/ Username'] || '').trim()
      if (!handle) return { id: a.id, name, ok: false, error: 'No handle' }
      try {
        const feed = await scrapeIgFeed(handle)
        await patchAirtableRecord('Creator Platform Directory', a.id, {
          'Scraped Feed': JSON.stringify(feed),
          'Scraped Feed Updated': new Date().toISOString(),
        })
        return { id: a.id, name, ok: true, count: feed.length }
      } catch (err) {
        console.error(`[Grid Planner Refresh] ${name} failed:`, err.message)
        // Mark as attempted so the UI knows to show the error state
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
      refreshed: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      results,
    })
  } catch (err) {
    console.error('[Grid Planner Refresh] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
