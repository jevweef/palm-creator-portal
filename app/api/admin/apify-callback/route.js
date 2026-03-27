import { NextResponse } from 'next/server'
import { fetchAirtableRecords, batchCreateRecords, patchAirtableRecord } from '@/lib/adminAuth'

const APIFY_TOKEN = process.env.APIFY_TOKEN
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST || 'instagram-scraper-stable-api.p.rapidapi.com'

function normalizeUrl(url) {
  const match = url.match(/instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/)
  return match ? match[1] : url.trim()
}

function pickFirst(item, keys, defaultVal = null) {
  for (const key of keys) {
    if (item[key] != null) return item[key]
  }
  return defaultVal
}

function normalizeDatetime(value) {
  if (!value) return ''
  if (typeof value === 'number') {
    const ts = value > 10_000_000_000 ? value / 1000 : value
    return new Date(ts * 1000).toISOString()
  }
  return String(value).trim()
}

function buildSourceReelRecord(handle, item, runId, followerCount) {
  const reelUrl = String(pickFirst(item, ['url', 'inputUrl', 'reelUrl', 'postUrl', 'shortCodeUrl'], '') || '').trim()
  if (!reelUrl) return null

  const username = pickFirst(item, ['username', 'ownerUsername', 'authorUsername'], '')
  const caption = pickFirst(item, ['caption', 'text', 'captionText'], '')
  let postedAt = normalizeDatetime(pickFirst(item, ['timestamp', 'takenAtTimestamp', 'createdAt'], ''))
  if (!postedAt && item._rapidapi) postedAt = new Date().toISOString()

  const views = pickFirst(item, ['videoPlayCount', 'videoViewCount', 'playCount', 'viewsCount', 'views'], null)
  const likesRaw = pickFirst(item, ['likesCount', 'likes'], null)
  const likes = likesRaw != null ? Math.max(0, likesRaw) : null
  const comments = pickFirst(item, ['commentsCount', 'comments'], null)
  const shares = pickFirst(item, ['sharesCount', 'shares'], null)
  const duration = pickFirst(item, ['videoDuration', 'duration', 'videoLength'], null)
  const transcript = pickFirst(item, ['transcript'], '')

  // Audio type
  let audioType = null
  const musicInfo = item.musicInfo || {}
  if (musicInfo.usesOriginalAudio === true) audioType = 'Original'
  else if (musicInfo.usesOriginalAudio === false) audioType = 'Song'
  else if (musicInfo.songName || musicInfo.artistName) audioType = 'Song'
  if (!audioType) {
    if (item.isOriginalAudio === true) audioType = 'Original'
    else if (item.isOriginalAudio === false) audioType = 'Song'
  }

  const fields = {
    'Source Handle': handle,
    'Reel URL': reelUrl,
    Username: String(username || '').trim(),
    Caption: String(caption || '').trim(),
    'Data Source': item._rapidapi ? 'RapidAPI' : 'Apify',
    'Apify Run ID': runId,
  }
  if (postedAt) fields['Posted At'] = postedAt
  if (views != null) fields.Views = views
  if (likes != null) fields.Likes = likes
  if (comments != null) fields.Comments = comments
  if (shares != null) fields.Shares = shares
  if (duration != null) fields['Duration Seconds'] = typeof duration === 'string' ? parseFloat(duration) : duration
  if (transcript) fields.Transcript = transcript
  if (audioType) fields['Audio Type'] = audioType
  if (followerCount) fields['Follower Count'] = followerCount

  return { fields }
}

async function fetchFollowerCount(username) {
  if (!RAPIDAPI_KEY) return null
  try {
    const res = await fetch(`https://${RAPIDAPI_HOST}/ig_get_fb_profile_v3.php`, {
      method: 'POST',
      headers: {
        'x-rapidapi-host': RAPIDAPI_HOST,
        'x-rapidapi-key': RAPIDAPI_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `username_or_url=${encodeURIComponent(username)}`,
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.follower_count || data.edge_followed_by?.count || null
  } catch {
    return null
  }
}

export async function POST(request) {
  try {
    // Verify secret
    const { searchParams } = new URL(request.url)
    const secret = searchParams.get('secret')
    const expectedSecret = process.env.APIFY_CALLBACK_SECRET || 'default-secret'

    if (secret !== expectedSecret) {
      return NextResponse.json({ error: 'Invalid secret' }, { status: 403 })
    }

    const sourceId = searchParams.get('sourceId')
    const handle = searchParams.get('handle') || ''

    const body = await request.json()
    const runId = body.resource?.id || body.eventData?.actorRunId || 'unknown'
    const status = body.resource?.status || body.eventData?.status || ''
    const datasetId = body.resource?.defaultDatasetId || body.eventData?.defaultDatasetId || ''

    console.log(`[Apify Callback] @${handle} run=${runId} status=${status}`)

    // Handle failed runs
    if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
      if (sourceId) {
        await patchAirtableRecord('Inspo Sources', sourceId, { 'Pipeline Status': 'Error' })
      }
      return NextResponse.json({ handled: true, status: 'failed' })
    }

    if (!datasetId) {
      return NextResponse.json({ error: 'No dataset ID in callback' }, { status: 400 })
    }

    // Fetch dataset items from Apify
    const dataRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&format=json&clean=true`
    )
    if (!dataRes.ok) throw new Error(`Apify dataset fetch failed: ${dataRes.status}`)
    const items = await dataRes.json()

    console.log(`[Apify Callback] @${handle}: ${items.length} items in dataset`)

    // Load existing URLs for dedup
    const existingReels = await fetchAirtableRecords('Source Reels', { fields: ['Reel URL'] })
    const existingUrls = new Set()
    for (const rec of existingReels) {
      const url = rec.fields?.['Reel URL'] || ''
      if (url) existingUrls.add(normalizeUrl(url))
    }

    // Fetch follower count
    const followerCount = await fetchFollowerCount(handle)

    // Build records, dedup, filter too-new
    const newRecords = []
    const now = new Date()
    const tooNewCutoff = new Date(now - 14 * 86400000)
    let tooNewSkipped = 0

    for (const item of items) {
      const record = buildSourceReelRecord(handle, item, runId, followerCount)
      if (!record) continue

      const urlKey = normalizeUrl(record.fields['Reel URL'] || '')
      if (existingUrls.has(urlKey)) continue

      // Skip too-new reels (Apify only, not RapidAPI)
      if (record.fields['Posted At'] && record.fields['Data Source'] !== 'RapidAPI') {
        try {
          const postedAt = new Date(record.fields['Posted At'])
          if (postedAt > tooNewCutoff) {
            tooNewSkipped++
            continue
          }
        } catch {}
      }

      existingUrls.add(urlKey) // prevent intra-batch dupes
      newRecords.push(record)
    }

    // Batch create
    if (newRecords.length > 0) {
      await batchCreateRecords('Source Reels', newRecords)
    }

    // Update source record
    if (sourceId) {
      const sourceUpdate = {
        'Last Scraped At': now.toISOString(),
        'Reels Scraped': items.length,
        'Too New Skipped': tooNewSkipped,
        'Source Reels Added': newRecords.length,
        'Pipeline Status': 'Complete',
      }
      if (followerCount) sourceUpdate['Follower Count'] = followerCount
      await patchAirtableRecord('Inspo Sources', sourceId, sourceUpdate)
    }

    console.log(`[Apify Callback] @${handle}: added ${newRecords.length}, skipped ${tooNewSkipped} too new`)

    return NextResponse.json({
      handled: true,
      handle,
      added: newRecords.length,
      tooNewSkipped,
      total: items.length,
    })
  } catch (err) {
    console.error('Apify callback error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
