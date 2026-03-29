import { NextResponse } from 'next/server'
import { fetchAirtableRecords, batchCreateRecords, batchUpdateRecords, patchAirtableRecord } from '@/lib/adminAuth'

const APIFY_TOKEN = process.env.APIFY_TOKEN
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST || 'instagram-scraper-stable-api.p.rapidapi.com'
const MAKE_ANALYSIS_WEBHOOK_URL = process.env.MAKE_ANALYSIS_WEBHOOK_URL

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

// --- Promote + Analysis chain ---

const LOOKBACK_DAYS = 180
const MIN_AGE_DAYS = 10
const TOP_PERCENT = 0.25
const MAX_PER_CREATOR = 20

function engagementScore(fields) {
  const views = fields.Views || 0
  if (views === 0) return 0
  const likes = Math.max(0, fields.Likes || 0)
  const comments = Math.max(0, fields.Comments || 0)
  const shares = Math.max(0, fields.Shares || 0)
  const weighted = (likes * 1 + comments * 3 + shares * 5) / views
  return weighted * Math.log10(Math.max(views, 10))
}

function canonicalUrl(url) {
  const shortcode = normalizeUrl(url)
  if (shortcode && shortcode !== url.trim()) {
    return `https://www.instagram.com/reel/${shortcode}/`
  }
  return url.trim()
}

async function runPromoteForHandle(handle) {
  const now = new Date()
  const cutoff = new Date(now - LOOKBACK_DAYS * 86400000)
  const tooNew = new Date(now - MIN_AGE_DAYS * 86400000)

  const [sourceReels, inspoRecords, inspoSources] = await Promise.all([
    fetchAirtableRecords('Source Reels'),
    fetchAirtableRecords('Inspiration', { fields: ['Content link'] }),
    fetchAirtableRecords('Inspo Sources', { fields: ['Handle', 'Palm Creators', 'Follower Count'] }),
  ])

  const existingInspoUrls = new Set()
  for (const rec of inspoRecords) {
    const url = rec.fields?.['Content link'] || ''
    if (url) existingInspoUrls.add(normalizeUrl(url))
  }

  const palmCreatorMap = {}
  const followerMap = {}
  for (const rec of inspoSources) {
    const h = (rec.fields?.Handle || '').trim().toLowerCase()
    if (!h) continue
    const creators = rec.fields?.['Palm Creators'] || []
    if (creators.length) palmCreatorMap[h] = creators
    if (rec.fields?.['Follower Count']) followerMap[h] = rec.fields['Follower Count']
  }

  // Filter eligible — only this handle's reels
  const eligible = []
  for (const rec of sourceReels) {
    const f = rec.fields || {}
    const srcHandle = (f['Source Handle'] || '').trim().toLowerCase()
    if (srcHandle !== handle.toLowerCase()) continue
    if (!f['Reel URL'] || !f.Views) continue

    const postedRaw = f['Posted At'] || ''
    const isRapidAPI = f['Data Source'] === 'RapidAPI'
    if (postedRaw) {
      try {
        const postedAt = new Date(postedRaw)
        if (postedAt < cutoff) continue
        if (!isRapidAPI && postedAt > tooNew) continue
      } catch {}
    }

    eligible.push({ record: rec, score: engagementScore(f) })
  }

  eligible.sort((a, b) => b.score - a.score)
  const target = Math.min(Math.max(1, Math.floor(eligible.length * TOP_PERCENT)), MAX_PER_CREATOR)

  const toPromote = []
  const goldenSet = []
  let totalSelected = 0

  for (const item of eligible) {
    if (totalSelected >= target) break
    const f = item.record.fields
    const urlKey = normalizeUrl(f['Reel URL'] || '')

    if (f['Imported to Inspiration'] || existingInspoUrls.has(urlKey)) {
      goldenSet.push(item)
      totalSelected++
      continue
    }

    goldenSet.push(item)
    toPromote.push(item)
    totalSelected++
  }

  if (toPromote.length === 0) {
    console.log(`[Promote] @${handle}: nothing new to promote`)
    return 0
  }

  // Update scores
  const scoreUpdates = goldenSet.map(item => ({
    id: item.record.id,
    fields: { 'Performance Score': Math.round(item.score * 1e6) / 1e6, 'Selected for Inspo': 'Yes' },
  }))
  await batchUpdateRecords('Source Reels', scoreUpdates)

  // Build Inspiration records
  const inspoRecordsToCreate = []
  const sourceIdsToMark = []

  for (const item of toPromote) {
    const f = item.record.fields
    const dataSource = f['Data Source'] || 'Apify'
    const handleKey = (f['Source Handle'] || '').trim().toLowerCase()
    const followerCt = f['Follower Count'] || followerMap[handleKey] || null

    const inspoFields = {
      'Content link': canonicalUrl(f['Reel URL'] || ''),
      Username: f.Username || '',
      'Ingestion Source': dataSource,
      'Data Source': dataSource,
      Views: f.Views || 0,
      Likes: f.Likes || 0,
      Comments: f.Comments || 0,
      'Engagement Score': Math.round(item.score * 1e6) / 1e6,
      Captions: f.Caption || '',
      'Creator Posted Date': f['Posted At'] || null,
      Duration: f['Duration Seconds'] || null,
      Status: 'Ready for Analysis',
    }

    if (f.Shares) inspoFields.Shares = f.Shares
    if (f['Audio Type']) inspoFields['Audio Type'] = f['Audio Type']
    if (f.Transcript) inspoFields.Transcript = f.Transcript
    if (f['Z Score'] != null) inspoFields['Z Score'] = f['Z Score']
    if (f.Grade) inspoFields.Grade = f.Grade

    if (followerCt) {
      inspoFields['Follower Count'] = followerCt
      if (inspoFields.Views) {
        inspoFields['Normalized Score'] = Math.round((inspoFields.Views / followerCt) * 10000) / 10000
      }
    }

    const palmCreators = palmCreatorMap[handleKey] || []
    if (palmCreators.length) inspoFields['For Creator'] = palmCreators

    inspoRecordsToCreate.push({ fields: inspoFields })
    sourceIdsToMark.push(item.record.id)
  }

  let created = 0
  for (let i = 0; i < inspoRecordsToCreate.length; i += 10) {
    const chunk = inspoRecordsToCreate.slice(i, i + 10)
    const idChunk = sourceIdsToMark.slice(i, i + 10)
    await batchCreateRecords('Inspiration', chunk)
    await batchUpdateRecords('Source Reels', idChunk.map(id => ({
      id, fields: { 'Imported to Inspiration': 'Yes' },
    })))
    created += chunk.length
  }

  console.log(`[Promote] @${handle}: promoted ${created} reels`)
  return created
}

async function triggerAnalysis() {
  if (!MAKE_ANALYSIS_WEBHOOK_URL) {
    console.log('[Analysis] No MAKE_ANALYSIS_WEBHOOK_URL configured, skipping')
    return false
  }
  try {
    const res = await fetch(MAKE_ANALYSIS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger: 'auto-chain', timestamp: new Date().toISOString() }),
    })
    console.log(`[Analysis] Triggered Make webhook: ${res.status}`)
    return res.ok
  } catch (err) {
    console.error('[Analysis] Failed to trigger:', err)
    return false
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

    // Fire-and-forget: trigger promote + analysis in a separate function
    if (newRecords.length > 0) {
      const callbackSecret = process.env.APIFY_CALLBACK_SECRET || 'default-secret'
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.palm-mgmt.com'
      fetch(`${baseUrl}/api/admin/promote-handle?secret=${callbackSecret}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle }),
      }).catch(err => console.error(`[Chain] Failed to trigger promote for @${handle}:`, err))
    }

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
