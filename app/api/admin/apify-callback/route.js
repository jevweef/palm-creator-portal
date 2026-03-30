import { NextResponse } from 'next/server'
import { fetchAirtableRecords, batchCreateRecords, batchUpdateRecords, patchAirtableRecord } from '@/lib/adminAuth'

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

async function fetchRapidApiReels(username, maxReels = 50) {
  if (!RAPIDAPI_KEY || !username) return []
  try {
    const items = []
    let paginationToken = null
    const maxPages = Math.ceil(maxReels / 12) + 1 // ~12 per page

    for (let page = 0; page < maxPages; page++) {
      let body = `username_or_url=${encodeURIComponent(username)}&amount=50`
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
      if (!res.ok) {
        console.log(`[Apify Callback] RapidAPI reels error ${res.status} for @${username} (page ${page + 1})`)
        break
      }
      const data = await res.json()
      if (data.error) {
        console.log(`[Apify Callback] RapidAPI reels error for @${username}: ${data.error}`)
        break
      }

      const reels = data.reels || []
      for (const node of reels) {
        const media = node?.node?.media || {}
        const code = media.code
        if (!code) continue

        const takenAt = media.taken_at
        const likes = media?.edge_media_preview_like?.count || media.like_count || 0
        const comments = media?.edge_media_to_comment?.count || media.comment_count || 0
        const caption = media?.caption?.text || media?.edge_media_to_caption?.edges?.[0]?.node?.text || ''
        const playCount = media.play_count || 0
        const duration = media.video_duration || null

        items.push({
          url: `https://www.instagram.com/reel/${code}/`,
          username,
          timestamp: takenAt ? new Date(takenAt * 1000).toISOString() : '',
          videoPlayCount: playCount,
          likesCount: likes,
          commentsCount: comments,
          caption,
          videoDuration: duration,
          _rapidapi: true,
        })
      }

      console.log(`[Apify Callback] RapidAPI page ${page + 1}: ${reels.length} reels (total: ${items.length})`)

      paginationToken = data.pagination_token
      if (!paginationToken || reels.length === 0 || items.length >= maxReels) break
    }

    return items.slice(0, maxReels)
  } catch (err) {
    console.log(`[Apify Callback] RapidAPI reels exception for @${username}: ${err.message}`)
    return []
  }
}

async function fetchFollowerCount(username) {
  if (!RAPIDAPI_KEY) return null
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000) // 8s max (Pro plan)
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
    return data.follower_count || data.edge_followed_by?.count || null
  } catch {
    console.log(`[Apify Callback] Follower count fetch timed out or failed for @${username}`)
    return null
  }
}

export const maxDuration = 60

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

    // Check if Apify returned real reels or just profile stubs (age-restricted accounts)
    const realItems = items.filter(i =>
      i.videoPlayCount || i.videoViewCount || i.playCount || i.views || i.viewsCount
    )
    let useItems = items
    let dataSource = 'apify'

    if (items.length > 0 && realItems.length === 0) {
      // Age-restricted: Apify returned stubs with no engagement data — fall back to RapidAPI
      console.log(`[Apify Callback] @${handle}: Apify returned ${items.length} stubs (age-restricted?) — falling back to RapidAPI`)
      const rapidItems = await fetchRapidApiReels(handle, 50)
      if (rapidItems.length > 0) {
        useItems = rapidItems
        dataSource = 'rapidapi-fallback'
        console.log(`[Apify Callback] @${handle}: RapidAPI returned ${rapidItems.length} reels`)
      } else {
        console.log(`[Apify Callback] @${handle}: RapidAPI also returned nothing`)
      }
    }

    // Load existing URLs for dedup — only this handle's reels
    const [existingReels, followerCount] = await Promise.all([
      fetchAirtableRecords('Source Reels', {
        fields: ['Reel URL'],
        filterByFormula: `{Source Handle} = "${handle}"`,
      }),
      fetchFollowerCount(handle),
    ])
    const existingUrls = new Set()
    for (const rec of existingReels) {
      const url = rec.fields?.['Reel URL'] || ''
      if (url) existingUrls.add(normalizeUrl(url))
    }

    // Build records, dedup, filter too-new
    const newRecords = []
    const now = new Date()
    const tooNewCutoff = new Date(now - 14 * 86400000)
    let tooNewSkipped = 0

    for (const item of useItems) {
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

    // Batch create — just the basic reel data, no scores yet
    if (newRecords.length > 0) {
      await batchCreateRecords('Source Reels', newRecords)
      console.log(`[Apify Callback] Created ${newRecords.length} records for @${handle}`)
    }

    // Update source record
    if (sourceId) {
      const sourceUpdate = {
        'Last Scraped At': now.toISOString(),
        'Reels Scraped': useItems.length,
        'Too New Skipped': tooNewSkipped,
        'Source Reels Added': newRecords.length,
        'Pipeline Status': 'Complete',
      }
      if (followerCount) sourceUpdate['Follower Count'] = followerCount
      if (dataSource === 'rapidapi-fallback') sourceUpdate['Age Restricted'] = true
      await patchAirtableRecord('Inspo Sources', sourceId, sourceUpdate)
    }

    console.log(`[Apify Callback] @${handle}: added ${newRecords.length}, skipped ${tooNewSkipped} too new`)

    // --- INLINE SCORING (no self-referencing HTTP calls) ---
    let scored = 0
    if (newRecords.length > 0) {
      try {
        // Fetch the just-created records that need scoring
        const unscoredReels = await fetchAirtableRecords('Source Reels', {
          filterByFormula: `AND({Source Handle} = "${handle}", {Views} > 0, {Performance Score} = BLANK())`,
        })

        console.log(`[Callback] Found ${unscoredReels.length} unscored reels for @${handle}`)

        if (unscoredReels.length > 0) {
          // Calculate engagement scores
          const scoredItems = unscoredReels.map(r => {
            const f = r.fields || {}
            const views = f.Views || 0
            const likes = Math.max(0, f.Likes || 0)
            const comments = Math.max(0, f.Comments || 0)
            const shares = Math.max(0, f.Shares || 0)
            const weighted = views > 0 ? (likes * 1 + comments * 3 + shares * 5) / views : 0
            const score = views > 0 ? weighted * Math.log10(Math.max(views, 10)) : 0
            const fc = f['Follower Count'] || 0

            const update = { 'Performance Score': Math.round(score * 1e6) / 1e6 }
            if (fc > 0 && views > 0) update['Normalized Score'] = Math.round((views / fc) * 10000) / 10000

            return { record: r, score, update }
          })

          // Z-scores across batch
          const scores = scoredItems.map(s => s.score)
          const mean = scores.reduce((a, b) => a + b, 0) / scores.length
          const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length
          const stdDev = Math.sqrt(variance) || 1

          for (const s of scoredItems) {
            const z = (s.score - mean) / stdDev
            s.update['Z Score'] = Math.round(z * 1000) / 1000
            if (z >= 2.0) s.update.Grade = 'A+'
            else if (z >= 1.5) s.update.Grade = 'A'
            else if (z >= 1.0) s.update.Grade = 'A-'
            else if (z >= 0.5) s.update.Grade = 'B+'
            else if (z >= 0.0) s.update.Grade = 'B'
            else if (z >= -0.5) s.update.Grade = 'B-'
            else if (z >= -1.0) s.update.Grade = 'C+'
            else if (z >= -1.5) s.update.Grade = 'C'
            else if (z >= -2.0) s.update.Grade = 'C-'
            else s.update.Grade = 'D'
          }

          // Batch update scores
          const updates = scoredItems.map(s => ({ id: s.record.id, fields: s.update }))
          await batchUpdateRecords('Source Reels', updates)
          scored = updates.length
          console.log(`[Callback] Scored ${scored} reels. Grades: ${scoredItems.map(s => s.update.Grade).join(', ')}`)
        }
      } catch (err) {
        console.error(`[Callback] Scoring error for @${handle}:`, err)
      }

      // --- INLINE PROMOTE ---
      try {
        const callbackSecret = process.env.APIFY_CALLBACK_SECRET || 'default-secret'
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.palm-mgmt.com'
        const promoteRes = await fetch(`${baseUrl}/api/admin/promote-handle?secret=${callbackSecret}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ handle }),
        })
        const promoteData = await promoteRes.json()
        console.log(`[Callback] Promote result: ${JSON.stringify(promoteData)}`)
      } catch (err) {
        console.error(`[Callback] Promote error for @${handle}:`, err)
      }
    }

    return NextResponse.json({
      handled: true,
      handle,
      added: newRecords.length,
      scored,
      tooNewSkipped,
      total: useItems.length,
      dataSource,
    })
  } catch (err) {
    console.error('Apify callback error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
