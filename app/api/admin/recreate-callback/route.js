import { NextResponse } from 'next/server'
import { fetchAirtableRecords, patchAirtableRecord, createAirtableRecord, OPS_BASE } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'

const APIFY_TOKEN = process.env.APIFY_TOKEN
const AIRTABLE_PAT = process.env.AIRTABLE_PAT

// Reels downloaded + uploaded to Dropbox per invocation. Each reel is a
// fetch (IG CDN) + Dropbox upload + Airtable write, so keep this low enough
// that a batch finishes well inside maxDuration. The callback re-invokes
// itself for the next batch until the dataset is exhausted.
const CHUNK = 10

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

export async function POST(request) {
  try {
    const { searchParams } = new URL(request.url)
    const secret = searchParams.get('secret')
    const expectedSecret = process.env.APIFY_CALLBACK_SECRET || 'default-secret'
    if (secret !== expectedSecret) {
      return NextResponse.json({ error: 'Invalid secret' }, { status: 403 })
    }

    const sourceId = searchParams.get('sourceId')
    const handle = searchParams.get('handle') || ''

    let body = {}
    try { body = await request.json() } catch {}

    // --- Continuation invocation (self-triggered for the next batch) ---
    if (body.continue) {
      return processBatch({
        datasetId: body.datasetId,
        sourceId: body.sourceId,
        handle: body.handle,
        creatorIds: body.creatorIds || [],
        offset: body.offset || 0,
        totalFound: body.totalFound || 0,
        storedSoFar: body.storedSoFar || 0,
      })
    }

    // --- Initial Apify webhook ---
    const runId = body.resource?.id || body.eventData?.actorRunId || 'unknown'
    const status = body.resource?.status || body.eventData?.status || ''
    const datasetId = body.resource?.defaultDatasetId || body.eventData?.defaultDatasetId || ''

    console.log(`[Recreate Callback] @${handle} run=${runId} status=${status}`)

    if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
      if (sourceId) {
        await patchAirtableRecord('Recreate Sources', sourceId, {
          Status: 'Error',
          Error: `Apify run ${status}`,
        }, { typecast: true }).catch(() => {})
      }
      return NextResponse.json({ handled: true, status: 'failed' })
    }

    if (!datasetId) {
      return NextResponse.json({ error: 'No dataset ID in callback' }, { status: 400 })
    }

    // Resolve which creator this account was queued for.
    let creatorIds = []
    if (sourceId) {
      const srcRes = await fetch(
        `https://api.airtable.com/v0/${OPS_BASE}/Recreate%20Sources/${sourceId}`,
        { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
      )
      if (srcRes.ok) {
        const f = (await srcRes.json()).fields || {}
        creatorIds = Array.isArray(f.Creator) ? f.Creator : []
      }
    }

    const items = await fetchDatasetItems(datasetId)
    const totalFound = items.length
    console.log(`[Recreate Callback] @${handle}: ${totalFound} reels in dataset`)

    if (sourceId) {
      await patchAirtableRecord('Recreate Sources', sourceId, {
        'Reels Found': totalFound,
      }, { typecast: true }).catch(() => {})
    }

    return processBatch({
      datasetId,
      sourceId,
      handle,
      creatorIds,
      offset: 0,
      totalFound,
      storedSoFar: 0,
    })
  } catch (err) {
    console.error('[Recreate Callback] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

async function processBatch({ datasetId, sourceId, handle, creatorIds, offset, totalFound, storedSoFar }) {
  const items = await fetchDatasetItems(datasetId)
  const creatorId = creatorIds[0] || null

  // Dedup: a reel already stored for this creator (by primary "Reel ID"
  // = shortcode-creatorRec) is skipped so re-queues only cost new reels.
  const existing = await fetchAirtableRecords('Recreate Reels', {
    fields: ['Reel ID'],
    filterByFormula: `{Source Handle} = "${handle}"`,
  })
  const existingIds = new Set(existing.map(r => r.fields?.['Reel ID']).filter(Boolean))

  const accessToken = await getDropboxAccessToken()
  const rootNs = await getDropboxRootNamespaceId(accessToken)

  const batch = items.slice(offset, offset + CHUNK)
  let stored = storedSoFar

  for (const item of batch) {
    try {
      const reelUrl = String(pickFirst(item, ['url', 'inputUrl', 'reelUrl', 'postUrl'], '') || '').trim()
      const shortcode = pickFirst(item, ['shortCode', 'shortcode'], null) || shortcodeFromUrl(reelUrl)
      if (!shortcode) continue

      const reelId = creatorId ? `${shortcode}-${creatorId}` : shortcode
      if (existingIds.has(reelId)) continue

      const videoUrl = pickFirst(item, ['videoUrl', 'videoUrlHd', 'video_url'], null)
      if (!videoUrl) {
        console.warn(`[Recreate Callback] no videoUrl for ${shortcode}`)
        continue
      }

      // Download the reel mp4 from the (short-lived) IG CDN URL.
      const vidRes = await fetch(videoUrl)
      if (!vidRes.ok) {
        console.warn(`[Recreate Callback] video fetch ${vidRes.status} for ${shortcode}`)
        continue
      }
      const videoBuf = Buffer.from(await vidRes.arrayBuffer())

      const dropboxPath = `/Palm Ops/Recreate Staging/${handle}/reels/${shortcode}/video.mp4`
      await uploadToDropbox(accessToken, rootNs, dropboxPath, videoBuf, { overwrite: true })
      let sharedLink = ''
      try {
        sharedLink = await createDropboxSharedLink(accessToken, rootNs, dropboxPath)
      } catch (e) {
        console.warn(`[Recreate Callback] shared link failed for ${shortcode}: ${e.message}`)
      }

      const fields = {
        'Reel ID': reelId,
        'Source Handle': handle,
        'Reel URL': reelUrl,
        Caption: String(pickFirst(item, ['caption', 'text'], '') || '').trim(),
        'Dropbox Video Path': dropboxPath,
        'Dropbox Video Link': sharedLink,
        Status: 'Available',
        'Apify Run ID': String(pickFirst(item, ['_runId'], '') || ''),
      }
      const views = pickFirst(item, ['videoPlayCount', 'videoViewCount', 'playCount'], null)
      if (views != null) fields.Views = views
      const postedAt = normalizeDatetime(pickFirst(item, ['timestamp', 'takenAtTimestamp'], ''))
      if (postedAt) fields['Posted At'] = postedAt
      if (sourceId) fields.Source = [sourceId]
      if (creatorId) fields.Creator = [creatorId]

      const created = await createAirtableRecord('Recreate Reels', fields)
      const newId = created?.records?.[0]?.id || created?.id

      // Attach the thumbnail (poster frame) to the new record.
      const thumbUrl = pickFirst(item, ['displayUrl', 'thumbnailUrl', 'imageUrl'], null)
      if (newId && thumbUrl) {
        try {
          const tRes = await fetch(thumbUrl)
          if (tRes.ok) {
            const tB64 = Buffer.from(await tRes.arrayBuffer()).toString('base64')
            await fetch(
              `https://content.airtable.com/v0/${OPS_BASE}/${newId}/Thumbnail/uploadAttachment`,
              {
                method: 'POST',
                headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ contentType: 'image/jpeg', filename: `${shortcode}.jpg`, file: tB64 }),
              }
            )
          }
        } catch (e) {
          console.warn(`[Recreate Callback] thumb attach failed for ${shortcode}: ${e.message}`)
        }
      }

      existingIds.add(reelId)
      stored++
    } catch (err) {
      console.error(`[Recreate Callback] reel error:`, err.message)
    }
  }

  const nextOffset = offset + CHUNK
  const done = nextOffset >= items.length

  if (done) {
    if (sourceId) {
      await patchAirtableRecord('Recreate Sources', sourceId, {
        Status: 'Ready',
        'Reels Stored': stored,
        'Last Scraped': new Date().toISOString(),
        'Dropbox Folder': `/Palm Ops/Recreate Staging/${handle}`,
      }, { typecast: true }).catch(() => {})
    }
    console.log(`[Recreate Callback] @${handle}: DONE — stored ${stored}/${totalFound}`)
    return NextResponse.json({ handled: true, done: true, handle, stored, totalFound })
  }

  // More reels remain — re-invoke ourselves for the next batch so no
  // single invocation runs past the timeout. Fire-and-forget.
  const callbackSecret = process.env.APIFY_CALLBACK_SECRET || 'default-secret'
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.palm-mgmt.com'
  fetch(`${baseUrl}/api/admin/recreate-callback?secret=${callbackSecret}&handle=${encodeURIComponent(handle)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      continue: true,
      datasetId,
      sourceId,
      handle,
      creatorIds,
      offset: nextOffset,
      totalFound,
      storedSoFar: stored,
    }),
  }).catch(e => console.error(`[Recreate Callback] continuation trigger failed: ${e.message}`))

  if (sourceId) {
    await patchAirtableRecord('Recreate Sources', sourceId, {
      'Reels Stored': stored,
    }, { typecast: true }).catch(() => {})
  }

  return NextResponse.json({ handled: true, done: false, handle, stored, nextOffset })
}
