import { NextResponse } from 'next/server'
import { requireAdminOrAiEditor, fetchAirtableRecords, OPS_BASE } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'
import { uploadVideoByUrl } from '@/lib/cloudflareStream'
import { waitUntil } from '@vercel/functions'

const APIFY_TOKEN = process.env.APIFY_TOKEN
const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const ACTOR_ID = 'apify/instagram-reel-scraper'
const REELS_TABLE = 'Recreate Reels'

export const maxDuration = 120  // Apify single-URL scrape typically 20-60s

// Extract the shortcode from any IG URL form: /p/{code}, /reel/{code}, /reels/{code}
function shortcodeFromUrl(url) {
  const m = String(url || '').match(/instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/)
  return m ? m[1] : null
}

// Try to extract a handle from the URL if it's present
// (https://www.instagram.com/{handle}/reel/{code}/). Returns '' if the URL
// is the short form without a handle.
function handleFromUrl(url) {
  const m = String(url || '').match(/instagram\.com\/([A-Za-z0-9_.]+)\/(?:p|reel|reels)\/[A-Za-z0-9_-]+/)
  return m ? m[1] : ''
}

function rawDbx(url) {
  if (!url) return ''
  const clean = String(url).replace(/[?&]dl=0/, '').replace(/[?&]dl=1/, '').replace(/[?&]raw=1/, '')
  return clean + (clean.includes('?') ? '&raw=1' : '?raw=1')
}

// POST { instagramUrl } — Editor-driven single-reel scrape. Bypasses the
// pool-of-handles model and pulls one specific reel by URL. Reuses the
// same Apify actor as the batch scraper but with `directUrls` so we get
// THIS reel, not the account's last 50.
//
// Synchronous: polls Apify until the run completes (~20-60s for one URL).
// On success, creates the Recreate Reel record with Dropbox + Stream
// mirror, returns the new reel ID for the client to navigate to.
//
// requireAdminOrAiEditor — the AI editor needs to drive this from the
// workflow, not just the admin.
export async function POST(request) {
  try {
    // Grab the user identity so we can stamp Added By on the new reel —
    // lets the library filter by "reels Yassine added" vs "reels Josh
    // added" when multiple editors are uploading.
    const user = await requireAdminOrAiEditor()
    const userEmail = (user?.emailAddresses?.[0]?.emailAddress || user?.primaryEmailAddress?.emailAddress || '').toLowerCase()
    if (!APIFY_TOKEN) {
      return NextResponse.json({ error: 'APIFY_TOKEN not configured' }, { status: 500 })
    }

    const { instagramUrl } = await request.json()
    if (!instagramUrl || typeof instagramUrl !== 'string') {
      return NextResponse.json({ error: 'instagramUrl required' }, { status: 400 })
    }
    const shortcode = shortcodeFromUrl(instagramUrl)
    if (!shortcode) {
      return NextResponse.json({ error: 'Not a valid Instagram reel / post URL' }, { status: 400 })
    }
    // Canonical URL for Apify — strip query string + trailing junk.
    const canonicalUrl = `https://www.instagram.com/reel/${shortcode}/`

    // Short-circuit: if this reel already exists in the library, just
    // return its existing ID — editor probably double-clicked or this
    // URL was already scraped. Cheap, idempotent.
    const existing = await fetchAirtableRecords(REELS_TABLE, {
      fields: ['Reel ID', 'Source Handle'],
      filterByFormula: `{Reel ID} = '${shortcode}'`,
      maxRecords: 1,
    })
    if (existing.length) {
      return NextResponse.json({
        ok: true,
        alreadyExisted: true,
        reelId: existing[0].id,
        shortcode,
        message: 'Reel already in the library — returning the existing record.',
      })
    }

    // Trigger Apify with directUrls (single reel, much faster than scraping
    // an account's recent N). The actor accepts an empty `username` array
    // when directUrls is set — but we provide both for safety.
    const handleHint = handleFromUrl(instagramUrl)
    const payload = {
      directUrls: [canonicalUrl],
      ...(handleHint ? { username: [handleHint] } : {}),
      resultsLimit: 1,
      skipPinnedPosts: false,
      includeTranscript: false,
      includeSharesCount: false,
    }

    const runRes = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR_ID.replace('/', '~')}/runs?token=${APIFY_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    )
    if (!runRes.ok) {
      const t = await runRes.text()
      return NextResponse.json({ error: `Apify ${runRes.status}: ${t.slice(0, 300)}` }, { status: 502 })
    }
    const runData = await runRes.json()
    const runId = runData.data?.id
    const datasetId = runData.data?.defaultDatasetId
    if (!runId || !datasetId) {
      return NextResponse.json({ error: 'Apify run did not return run id / dataset id' }, { status: 502 })
    }

    // Poll for completion. Apify reel scrape for ONE URL usually finishes
    // in 15-45s; cap at ~90s to leave room for our own post-processing
    // before maxDuration (120s) kicks in.
    const t0 = Date.now()
    let runStatus = 'RUNNING'
    while (Date.now() - t0 < 90_000) {
      const sRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`)
      if (sRes.ok) {
        const sJson = await sRes.json()
        runStatus = sJson.data?.status || runStatus
        if (runStatus === 'SUCCEEDED') break
        if (runStatus === 'FAILED' || runStatus === 'ABORTED' || runStatus === 'TIMED-OUT') {
          return NextResponse.json({ error: `Apify run ${runStatus.toLowerCase()}` }, { status: 502 })
        }
      }
      await new Promise(r => setTimeout(r, 3000))
    }
    if (runStatus !== 'SUCCEEDED') {
      return NextResponse.json(
        { error: 'Apify run still in progress past timeout — try refreshing the library in a minute' },
        { status: 504 }
      )
    }

    // Fetch the items the run produced.
    const itemsRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&format=json&clean=true`
    )
    if (!itemsRes.ok) {
      return NextResponse.json({ error: `Apify dataset fetch failed: ${itemsRes.status}` }, { status: 502 })
    }
    const items = await itemsRes.json()
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Apify returned no items for this URL — IG may be blocking it or the URL is private' }, { status: 502 })
    }
    // Find the item that actually matches our shortcode. directUrls returns
    // exactly the requested URL when supported; username fallback returns
    // recent reels, so we filter.
    const item = items.find(i => (i.shortcode === shortcode) || (shortcodeFromUrl(i.url) === shortcode)) || items[0]

    const handle = (item.ownerUsername || item.username || handleHint || '').trim()
    if (!handle) {
      return NextResponse.json({ error: 'Could not determine the owner handle for this reel from Apify' }, { status: 502 })
    }

    // Pull mp4 → Dropbox → shared link.
    const videoUrl = item.videoUrl || item.video_url
    if (!videoUrl) {
      return NextResponse.json({ error: 'Apify did not return a video URL for this reel (age-restricted account?)' }, { status: 502 })
    }
    const vRes = await fetch(videoUrl)
    if (!vRes.ok) {
      return NextResponse.json({ error: `Could not download video bytes: HTTP ${vRes.status}` }, { status: 502 })
    }
    const buf = Buffer.from(await vRes.arrayBuffer())
    if (buf.length < 10_000) {
      return NextResponse.json({ error: 'Video bytes look invalid (<10KB)' }, { status: 502 })
    }

    const accessToken = await getDropboxAccessToken()
    const rootNs = await getDropboxRootNamespaceId(accessToken)
    const dropboxPath = `/Palm Ops/Recreate Staging/${handle}/reels/${shortcode}/video.mp4`
    await uploadToDropbox(accessToken, rootNs, dropboxPath, buf, { overwrite: true })
    let sharedLink = ''
    try { sharedLink = await createDropboxSharedLink(accessToken, rootNs, dropboxPath) } catch {}

    // Create the Recreate Reel record via upsert (idempotent on Reel ID).
    // Field set matches the admin scrape callback so editor-uploaded reels
    // operate identically in the library (same display, same Stage B usage,
    // same playback). Added Via + Added By distinguish the source for
    // filtering — there's no behavioral difference between the two paths.
    const fields = {
      'Reel ID': shortcode,
      'Source Handle': handle,
      'Reel URL': canonicalUrl,
      Caption: String(item.caption || '').trim(),
      'Dropbox Video Path': dropboxPath,
      'Dropbox Video Link': sharedLink,
      Status: 'Available',
      'Added Via': 'Editor Upload',
      ...(userEmail ? { 'Added By': userEmail } : {}),
    }
    // Match the admin callback's field naming exactly so the same Apify
    // payload populates the same downstream columns regardless of path.
    if (item.views != null) fields.Views = item.views
    if (item.postedAt) {
      const ts = item.postedAt
      const iso = typeof ts === 'number'
        ? new Date((ts > 1e12 ? ts : ts * 1000)).toISOString()
        : String(ts)
      fields['Posted At'] = iso
    } else if (item.timestamp) {
      // Some Apify schema versions emit timestamp instead of postedAt.
      const ts = item.timestamp
      const iso = typeof ts === 'number'
        ? new Date((ts > 1e12 ? ts : ts * 1000)).toISOString()
        : String(ts)
      fields['Posted At'] = iso
    }

    const upRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(REELS_TABLE)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        performUpsert: { fieldsToMergeOn: ['Reel ID'] },
        records: [{ fields }],
      }),
    })
    if (!upRes.ok) {
      const t = await upRes.text()
      return NextResponse.json({ error: `Airtable upsert failed: ${upRes.status} ${t.slice(0, 300)}` }, { status: 502 })
    }
    const upJson = await upRes.json()
    const reelId = upJson?.records?.[0]?.id

    // Mirror to Cloudflare Stream in the background — non-fatal, the
    // mirror-stream cron backfills any that fail. waitUntil keeps the
    // Vercel function alive past response for the mirror to complete.
    if (reelId && sharedLink) {
      waitUntil((async () => {
        try {
          const { uid } = await uploadVideoByUrl(rawDbx(sharedLink), { airtableId: reelId, kind: 'recreate-reels' })
          if (uid) {
            await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(REELS_TABLE)}/${reelId}`, {
              method: 'PATCH',
              headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ fields: { 'Stream UID': uid } }),
            })
          }
        } catch (e) {
          console.warn(`[upload-inspo] Stream mirror failed for ${shortcode}: ${e.message}`)
        }
      })())
    }

    return NextResponse.json({
      ok: true,
      reelId,
      shortcode,
      handle,
      dropboxPath,
      streamMirroring: !!(reelId && sharedLink),
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[upload-inspo] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
