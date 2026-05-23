import { NextResponse } from 'next/server'
import { fetchAirtableRecords, patchAirtableRecord, OPS_BASE } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'
import { uploadVideoByUrl } from '@/lib/cloudflareStream'
import { waitUntil } from '@vercel/functions'

function rawDbx(url) {
  if (!url) return ''
  const clean = String(url).replace(/[?&]dl=0/, '').replace(/[?&]dl=1/, '').replace(/[?&]raw=1/, '')
  return clean + (clean.includes('?') ? '&raw=1' : '?raw=1')
}
const APIFY_TOKEN = process.env.APIFY_TOKEN
const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST || 'instagram-scraper-stable-api.p.rapidapi.com'

// Reels processed per invocation (resolve fresh CDN url + download +
// Dropbox upload + Airtable write each). Keep low so a batch finishes
// inside maxDuration; the callback re-invokes itself for the next batch.
const CHUNK = 20

export const maxDuration = 300

function pickFirst(item, keys, def = null) {
  for (const k of keys) if (item[k] != null && item[k] !== '') return item[k]
  return def
}
function shortcodeFromUrl(url) {
  const m = String(url || '').match(/instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/)
  return m ? m[1] : null
}
function normalizeDatetime(value) {
  if (!value) return ''
  if (typeof value === 'number') {
    const ts = value > 10_000_000_000 ? value / 1000 : value
    return new Date(ts * 1000).toISOString()
  }
  return String(value).trim()
}

async function fetchDatasetItems(datasetId) {
  const res = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&format=json&clean=true`
  )
  if (!res.ok) throw new Error(`Apify dataset fetch failed: ${res.status}`)
  return res.json()
}

// Age-restricted (18+) accounts: Apify (logged-out) can't see reels and
// returns a profile stub. RapidAPI's reels endpoint works without an IG
// session — but only returns METADATA (no video). Pair with
// resolveRapidVideoUrl() to get the actual mp4.
async function fetchRapidApiReels(handle, maxReels) {
  if (!RAPIDAPI_KEY || !handle) return []
  const out = []
  let token = null
  const maxPages = Math.ceil(maxReels / 12) + 1
  for (let page = 0; page < maxPages; page++) {
    let body = `username_or_url=${encodeURIComponent(handle)}&amount=50`
    if (token) body += `&pagination_token=${token}`
    let data
    try {
      const res = await fetch(`https://${RAPIDAPI_HOST}/get_ig_user_reels.php`, {
        method: 'POST',
        headers: {
          'x-rapidapi-host': RAPIDAPI_HOST,
          'x-rapidapi-key': RAPIDAPI_KEY,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      })
      if (!res.ok) break
      data = await res.json()
    } catch { break }
    if (!data || data.error) break
    const reels = data.reels || []
    for (const node of reels) {
      const media = node?.node?.media || {}
      const code = media.code
      if (!code) continue
      out.push({
        shortcode: code,
        url: `https://www.instagram.com/reel/${code}/`,
        caption: media?.caption?.text || media?.edge_media_to_caption?.edges?.[0]?.node?.text || '',
        views: media.play_count || 0,
        postedAt: media.taken_at ? new Date(media.taken_at * 1000).toISOString() : '',
        thumbUrl: media.display_url || media.thumbnail_src || null,
      })
      if (out.length >= maxReels) return out
    }
    token = data.pagination_token
    if (!token || reels.length === 0) break
  }
  return out
}

// Resolve a FRESH direct CDN .mp4 for a single reel by shortcode. Works
// for age-restricted reels (no IG session). Also used as the fallback
// when an Apify-supplied videoUrl is missing/expired.
async function resolveRapidVideoUrl(shortcode) {
  if (!RAPIDAPI_KEY || !shortcode) return null
  try {
    const res = await fetch(
      `https://${RAPIDAPI_HOST}/get_media_data.php?reel_post_code_or_url=${encodeURIComponent(shortcode)}&type=reel`,
      { headers: { 'x-rapidapi-host': RAPIDAPI_HOST, 'x-rapidapi-key': RAPIDAPI_KEY } }
    )
    if (!res.ok) return null
    const j = await res.json()
    return j.video_url || null
  } catch {
    return null
  }
}

export async function POST(request) {
  try {
    const { searchParams } = new URL(request.url)
    const fwdHost = request.headers.get('x-forwarded-host') || request.headers.get('host')
    const fwdProto = request.headers.get('x-forwarded-proto') || 'https'
    const selfBaseUrl = fwdHost ? `${fwdProto}://${fwdHost}` : null
    const secret = searchParams.get('secret')
    const expectedSecret = process.env.APIFY_CALLBACK_SECRET || 'default-secret'
    if (secret !== expectedSecret) {
      return NextResponse.json({ error: 'Invalid secret' }, { status: 403 })
    }

    const sourceId = searchParams.get('sourceId')
    const handle = searchParams.get('handle') || ''

    let body = {}
    try { body = await request.json() } catch {}

    if (body.continue) {
      return processBatch({
        selfBaseUrl,
        sourceId: body.sourceId,
        handle: body.handle,
        reels: body.reels || [],
        offset: body.offset || 0,
        storedSoFar: body.storedSoFar || 0,
      })
    }

    const runId = body.resource?.id || body.eventData?.actorRunId || 'unknown'
    const status = body.resource?.status || body.eventData?.status || ''
    const datasetId = body.resource?.defaultDatasetId || body.eventData?.defaultDatasetId || ''
    console.log(`[Recreate Callback] @${handle} run=${runId} status=${status}`)

    if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
      if (sourceId) {
        await patchAirtableRecord('Recreate Sources', sourceId, {
          Status: 'Error', Error: `Apify run ${status}`,
        }, { typecast: true }).catch(() => {})
      }
      return NextResponse.json({ handled: true, status: 'failed' })
    }
    if (!datasetId) {
      return NextResponse.json({ error: 'No dataset ID in callback' }, { status: 400 })
    }

    // How many reels we're allowed to keep for this account
    let maxReels = 50
    if (sourceId) {
      try {
        const sr = await fetch(
          `https://api.airtable.com/v0/${OPS_BASE}/Recreate%20Sources/${sourceId}`,
          { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
        )
        if (sr.ok) maxReels = Number((await sr.json()).fields?.['Max Reels']) || 50
      } catch {}
    }

    const items = await fetchDatasetItems(datasetId)
    const realItems = items.filter(i =>
      i.videoPlayCount || i.videoViewCount || i.playCount || i.views || i.viewsCount
    )

    let reels = []
    let dataSource = 'apify'
    if (realItems.length > 0) {
      reels = realItems.slice(0, maxReels).map(it => {
        const url = String(pickFirst(it, ['url', 'inputUrl', 'reelUrl', 'postUrl'], '') || '').trim()
        const sc = pickFirst(it, ['shortCode', 'shortcode'], null) || shortcodeFromUrl(url)
        return {
          shortcode: sc,
          url,
          caption: String(pickFirst(it, ['caption', 'text'], '') || '').trim(),
          views: pickFirst(it, ['videoPlayCount', 'videoViewCount', 'playCount'], 0),
          postedAt: normalizeDatetime(pickFirst(it, ['timestamp', 'takenAtTimestamp'], '')),
          thumbUrl: pickFirst(it, ['displayUrl', 'thumbnailUrl', 'imageUrl'], null),
          videoUrl: pickFirst(it, ['videoUrl', 'videoUrlHd', 'video_url'], null),
        }
      }).filter(r => r.shortcode)
    } else {
      // Age-restricted / private to logged-out Apify → RapidAPI metadata
      console.log(`[Recreate Callback] @${handle}: ${items.length} stub(s), no engagement — RapidAPI fallback`)
      reels = await fetchRapidApiReels(handle, maxReels)
      dataSource = 'rapidapi'
    }

    if (reels.length === 0) {
      if (sourceId) {
        await patchAirtableRecord('Recreate Sources', sourceId, {
          Status: 'Error',
          'Reels Found': 0,
          Error: 'No reels found — account may be private, banned, or unreachable via Apify + RapidAPI.',
        }, { typecast: true }).catch(() => {})
      }
      return NextResponse.json({ handled: true, reels: 0, dataSource })
    }

    if (sourceId) {
      await patchAirtableRecord('Recreate Sources', sourceId, {
        'Reels Found': reels.length,
      }, { typecast: true }).catch(() => {})
    }
    console.log(`[Recreate Callback] @${handle}: ${reels.length} reels via ${dataSource}`)

    return processBatch({ selfBaseUrl, sourceId, handle, reels, offset: 0, storedSoFar: 0 })
  } catch (err) {
    console.error('[Recreate Callback] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

async function processBatch({ selfBaseUrl, sourceId, handle, reels, offset, storedSoFar }) {
  // Supersede guard: if the source row was deleted or is no longer
  // 'Scraping' (user removed/re-added it, or another run took over),
  // abort this chain so an orphaned run doesn't keep inserting dupes.
  if (sourceId) {
    const sr = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/Recreate%20Sources/${sourceId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
    ).catch(() => null)
    if (!sr || !sr.ok) {
      console.log(`[Recreate Callback] @${handle}: source ${sourceId} gone — aborting orphaned run`)
      return NextResponse.json({ handled: true, aborted: 'source-deleted' })
    }
    const st = (await sr.json()).fields?.Status
    if ((st?.name || st) !== 'Scraping') {
      console.log(`[Recreate Callback] @${handle}: source status=${st?.name || st} — aborting superseded run`)
      return NextResponse.json({ handled: true, aborted: 'superseded' })
    }
  }

  // Global library: one row per IG reel (Reel ID = shortcode). Dedup so a
  // re-scrape only stores genuinely new reels.
  const existing = await fetchAirtableRecords('Recreate Reels', {
    fields: ['Reel ID'],
    filterByFormula: `{Source Handle} = "${handle}"`,
  })
  const existingIds = new Set(existing.map(r => r.fields?.['Reel ID']).filter(Boolean))

  const accessToken = await getDropboxAccessToken()
  const rootNs = await getDropboxRootNamespaceId(accessToken)

  const batch = reels.slice(offset, offset + CHUNK)
  let stored = storedSoFar

  for (const item of batch) {
    try {
      const shortcode = item.shortcode || shortcodeFromUrl(item.url)
      if (!shortcode || existingIds.has(shortcode)) continue

      // Prefer an Apify-supplied url; fall back to a freshly resolved
      // RapidAPI CDN url (required for age-restricted; also rescues an
      // expired Apify url since later batches run minutes later).
      let buf = null
      if (item.videoUrl) {
        try {
          const r = await fetch(item.videoUrl)
          if (r.ok) buf = Buffer.from(await r.arrayBuffer())
        } catch {}
      }
      if (!buf) {
        const fresh = await resolveRapidVideoUrl(shortcode)
        if (fresh) {
          try {
            const r = await fetch(fresh)
            if (r.ok) buf = Buffer.from(await r.arrayBuffer())
          } catch {}
        }
      }
      if (!buf || buf.length < 10_000) {
        console.warn(`[Recreate Callback] no video for ${shortcode}`)
        continue
      }

      const dropboxPath = `/Palm Ops/Recreate Staging/${handle}/reels/${shortcode}/video.mp4`
      await uploadToDropbox(accessToken, rootNs, dropboxPath, buf, { overwrite: true })
      let sharedLink = ''
      try { sharedLink = await createDropboxSharedLink(accessToken, rootNs, dropboxPath) } catch {}

      const fields = {
        'Reel ID': shortcode,
        'Source Handle': handle,
        'Reel URL': item.url || `https://www.instagram.com/reel/${shortcode}/`,
        Caption: String(item.caption || '').trim(),
        'Dropbox Video Path': dropboxPath,
        'Dropbox Video Link': sharedLink,
        Status: 'Available',
        // Classify the path the reel arrived via — pairs with 'Editor Upload'
        // on the upload-inspo route. Lets the library filter "admin vs
        // editor added" cleanly without inferring from the Source link.
        'Added Via': 'Admin Scrape',
      }
      if (item.views != null) fields.Views = item.views
      if (item.postedAt) fields['Posted At'] = item.postedAt
      if (sourceId) fields.Source = [sourceId]

      // UPSERT on "Reel ID" instead of plain create — structural dedup.
      // If any chain (even a concurrent one) already wrote this shortcode,
      // this merges into that row instead of creating a duplicate. This is
      // the real fix; the in-memory existingIds check is just a fast skip.
      const upRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/Recreate%20Reels`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          performUpsert: { fieldsToMergeOn: ['Reel ID'] },
          records: [{ fields }],
        }),
      })
      if (!upRes.ok) {
        console.error(`[Recreate Callback] upsert failed ${shortcode}: ${upRes.status} ${await upRes.text()}`)
        continue
      }
      const upJson = await upRes.json()
      const wasCreated = (upJson.createdRecords || []).length > 0
      const newId = upJson?.records?.[0]?.id
      if (!wasCreated) {
        // Already existed (another chain or prior run) — don't double-count
        // or re-kick Stream; just move on.
        existingIds.add(shortcode)
        continue
      }

      // NOTE: poster generation is intentionally NOT done here. ffmpeg per
      // reel was the heaviest per-invocation cost and made the chain long
      // + stall-prone. Posters are backfilled by the "Optimize
      // (Cloudflare)" button + mirror-stream cron (Dropbox thumbnail), and
      // once the Stream copy below transcodes it serves a poster anyway.
      // Keeping the per-reel loop lean = fewer hops = far fewer stalls.

      // Mirror to Cloudflare Stream for fast grid loading/playback.
      // Non-fatal — the mirror-stream cron backfills any that fail.
      if (newId && sharedLink) {
        try {
          const { uid } = await uploadVideoByUrl(rawDbx(sharedLink), { airtableId: newId, kind: 'recreate-reels' })
          if (uid) {
            await fetch(`https://api.airtable.com/v0/${OPS_BASE}/Recreate%20Reels/${newId}`, {
              method: 'PATCH',
              headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ fields: { 'Stream UID': uid } }),
            })
          }
        } catch (e) {
          console.warn(`[Recreate Callback] stream mirror failed ${shortcode}: ${e.message}`)
        }
      }

      existingIds.add(shortcode)
      stored++
    } catch (err) {
      console.error('[Recreate Callback] reel error:', err.message)
    }
  }

  const nextOffset = offset + CHUNK
  const done = nextOffset >= reels.length

  if (done) {
    if (sourceId) {
      await patchAirtableRecord('Recreate Sources', sourceId, {
        Status: 'Ready',
        'Reels Stored': stored,
        'Last Scraped': new Date().toISOString(),
        'Dropbox Folder': `/Palm Ops/Recreate Staging/${handle}`,
      }, { typecast: true }).catch(() => {})
    }
    console.log(`[Recreate Callback] @${handle}: DONE — stored ${stored}/${reels.length}`)
    return NextResponse.json({ handled: true, done: true, handle, stored })
  }

  const callbackSecret = process.env.APIFY_CALLBACK_SECRET || 'default-secret'
  // Re-invoke on the SAME deployment that received this webhook (preview
  // or prod), not a hardcoded env — see recreate-scrape for rationale.
  const baseUrl = selfBaseUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://app.palm-mgmt.com'

  if (sourceId) {
    await patchAirtableRecord('Recreate Sources', sourceId, {
      'Reels Stored': stored,
    }, { typecast: true }).catch(() => {})
  }

  // CRITICAL: a bare fire-and-forget fetch gets killed when Vercel freezes
  // the function on return — that's why the chain kept dying after a hop
  // or two. waitUntil keeps the invocation alive until the next-hop
  // request is delivered. Retry a few times for transient failures.
  const kickNext = async () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await fetch(
          `${baseUrl}/api/admin/recreate-callback?secret=${callbackSecret}&handle=${encodeURIComponent(handle)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ continue: true, sourceId, handle, reels, offset: nextOffset, storedSoFar: stored }),
          }
        )
        if (r.ok) return
        console.error(`[Recreate Callback] continuation hop ${r.status} (attempt ${attempt})`)
      } catch (e) {
        console.error(`[Recreate Callback] continuation trigger failed (attempt ${attempt}): ${e.message}`)
      }
      await new Promise(res => setTimeout(res, 1500 * attempt))
    }
  }
  waitUntil(kickNext())

  return NextResponse.json({ handled: true, done: false, handle, stored, nextOffset })
}
