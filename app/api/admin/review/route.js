import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord, batchCreateRecords } from '@/lib/adminAuth'

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST || 'instagram-scraper-stable-api.p.rapidapi.com'
const GITHUB_PAT = process.env.GITHUB_PAT
const GITHUB_REPO = 'jevweef/inspo-pipeline'

const SHORTCODE_RE = /instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/

function extractShortcode(url) {
  const m = url?.match(SHORTCODE_RE)
  return m ? m[1] : null
}

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
    return data.follower_count || data.edge_followed_by?.count || null
  } catch {
    console.log(`[Review] Follower count fetch failed for @${username}`)
    return null
  }
}

async function fetchReelData(shortcode) {
  if (!RAPIDAPI_KEY || !shortcode) return null
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(
      `https://${RAPIDAPI_HOST}/get_media_data.php?reel_post_code_or_url=${shortcode}&type=reel`,
      {
        headers: {
          'x-rapidapi-host': RAPIDAPI_HOST,
          'x-rapidapi-key': RAPIDAPI_KEY,
        },
        signal: controller.signal,
      }
    )
    clearTimeout(timeout)
    if (!res.ok) return null
    return await res.json()
  } catch {
    console.log(`[Review] Reel data fetch failed for ${shortcode}`)
    return null
  }
}

function triggerAnalysis() {
  if (!GITHUB_PAT) return
  fetch(`https://api.github.com/repos/${GITHUB_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      'Authorization': `token ${GITHUB_PAT}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_type: 'run-analysis',
      client_payload: { trigger: 'review-approve', timestamp: new Date().toISOString() },
    }),
  }).catch(err => console.error('[Review] GitHub Actions trigger failed:', err))
}

// GET — fetch review queue from Source Reels + palm creators + existing source handles
export async function GET(request) {
  try {
    await requireAdmin()
  } catch (e) { return e }

  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')

    // Sub-routes for creators and sources (unchanged)
    if (action === 'creators') {
      const records = await fetchAirtableRecords('Palm Creators', {
        fields: ['Creator', 'AKA'],
        filterByFormula: "OR({Status}='Active',{Status}='Onboarding')",
        sort: [{ field: 'Creator', direction: 'asc' }],
      })
      const creators = records
        .map(r => ({ id: r.id, name: (r.fields.AKA || r.fields.Creator || '').trim() }))
        .filter(c => c.name)
      return NextResponse.json({ creators })
    }

    if (action === 'sources') {
      const records = await fetchAirtableRecords('Inspo Sources', { fields: ['Handle'] })
      const handles = records
        .map(r => (r.fields.Handle || '').trim().replace(/^@/, '').toLowerCase())
        .filter(Boolean)
      return NextResponse.json({ handles })
    }

    // Default: fetch review queue from Source Reels
    // Manual/IG Export reels that haven't been promoted to Inspiration yet
    const records = await fetchAirtableRecords('Source Reels', {
      filterByFormula: "AND(OR({Data Source}='Manual',{Data Source}='IG Export'),OR({Review Status}='Pending Review',{Review Status}=BLANK()),NOT({Imported to Inspiration}='Yes'))",
      fields: [
        'Reel URL', 'Source Handle', 'Username', 'Caption',
        'Views', 'Likes', 'Comments', 'Shares', 'Grade',
        'Data Source', 'Review Status', 'Rating', 'For Creator',
        'Reviewer Notes', 'Follower Count', 'Date Saved', 'Posted At',
      ],
      sort: [{ field: 'Date Saved', direction: 'desc' }],
    })

    const queue = records.map(r => ({
      id: r.id,
      url: r.fields['Reel URL'] || '',
      username: r.fields.Username || r.fields['Source Handle'] || '',
      caption: r.fields.Caption || '',
      views: r.fields.Views || null,
      likes: r.fields.Likes || null,
      comments: r.fields.Comments || null,
      shares: r.fields.Shares || null,
      grade: r.fields.Grade || null,
      dataSource: r.fields['Data Source'] || '',
      reviewStatus: r.fields['Review Status'] || '',
      rating: r.fields.Rating || null,
      forCreator: r.fields['For Creator'] || [],
      reviewerNotes: r.fields['Reviewer Notes'] || '',
      followerCount: r.fields['Follower Count'] || null,
      dateSaved: r.fields['Date Saved'] || null,
      postedAt: r.fields['Posted At'] || null,
    }))

    return NextResponse.json({ queue, total: queue.length })
  } catch (err) {
    console.error('[review] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export const maxDuration = 60

// PATCH — approve: enrich + promote Source Reel → Inspiration record → trigger analysis
export async function PATCH(request) {
  try {
    await requireAdmin()
  } catch (e) { return e }

  try {
    const { recordId, rating, creatorIds, reviewerNotes } = await request.json()
    if (!recordId) return NextResponse.json({ error: 'Missing recordId' }, { status: 400 })

    // 1. Read full Source Reel record
    const srRecords = await fetchAirtableRecords('Source Reels', {
      filterByFormula: `RECORD_ID()='${recordId}'`,
    })
    if (!srRecords.length) return NextResponse.json({ error: 'Record not found' }, { status: 404 })

    const sr = srRecords[0].fields
    const sc = extractShortcode(sr['Reel URL'])
    const username = (sr.Username || sr['Source Handle'] || '').trim()

    console.log(`[Review] Approving reel from @${username}, shortcode=${sc}`)

    // 2. Enrich: get follower count
    let followerCount = sr['Follower Count'] || null

    if (!followerCount && username) {
      // Check Inspo Sources first
      console.log(`[Review] Looking up follower count for @${username} in Inspo Sources...`)
      const inspoSources = await fetchAirtableRecords('Inspo Sources', {
        fields: ['Handle', 'Follower Count'],
        filterByFormula: `LOWER({Handle}) = "${username.toLowerCase()}"`,
      })
      if (inspoSources.length && inspoSources[0].fields['Follower Count']) {
        followerCount = inspoSources[0].fields['Follower Count']
        console.log(`[Review] Found followers in Inspo Sources: ${followerCount}`)
      } else {
        // Fallback: RapidAPI
        console.log(`[Review] Not in Inspo Sources, fetching from RapidAPI...`)
        followerCount = await fetchFollowerCount(username)
        console.log(`[Review] RapidAPI followers: ${followerCount}`)
      }
    }

    // 3. Enrich: get engagement data if missing
    let views = sr.Views || null
    let likes = sr.Likes != null ? sr.Likes : null
    let comments = sr.Comments || null
    let shares = sr.Shares || null
    let duration = sr['Duration Seconds'] || null
    let audioType = sr['Audio Type'] || null
    let caption = sr.Caption || ''
    let postedAt = sr['Posted At'] || null

    if (!views && sc) {
      console.log(`[Review] Missing engagement data, fetching from RapidAPI...`)
      const reelData = await fetchReelData(sc)
      if (reelData) {
        views = reelData.play_count || reelData.video_play_count || views
        likes = reelData.like_count || likes
        comments = reelData.comment_count || comments
        duration = reelData.video_duration || duration
        if (!caption && reelData.caption?.text) caption = reelData.caption.text
        console.log(`[Review] RapidAPI reel data: views=${views}, likes=${likes}, comments=${comments}`)
      }
    }

    // 4. Calculate scores
    let engagementScore = null
    let normalizedScore = null
    let performanceScore = null

    if (views && views > 0) {
      const l = Math.max(likes || 0, 0)
      const c = Math.max(comments || 0, 0)
      const s = Math.max(shares || 0, 0)
      const weighted = (l * 1 + c * 3 + s * 5) / views
      engagementScore = Math.round(weighted * 1e6) / 1e6
      performanceScore = Math.round(weighted * Math.log10(Math.max(views, 10)) * 1e6) / 1e6

      if (followerCount && followerCount > 0) {
        normalizedScore = Math.round((views / followerCount) * 1e4) / 1e4
      }
    }

    // 5. Build Inspiration record — straight to Ready for Analysis, no filter
    const inspoFields = {
      'Content link': sc ? `https://www.instagram.com/reel/${sc}/` : sr['Reel URL'],
      'Username': username,
      'Status': 'Ready for Analysis',
      'Ingestion Source': 'Manual',
    }

    if (views != null) inspoFields['Views'] = views
    if (likes != null) inspoFields['Likes'] = Math.max(likes, 0)
    if (comments != null) inspoFields['Comments'] = comments
    if (shares != null) inspoFields['Shares'] = shares
    if (duration != null) inspoFields['Duration'] = typeof duration === 'string' ? parseFloat(duration) : duration
    if (audioType) inspoFields['Audio Type'] = audioType
    if (followerCount != null) inspoFields['Follower Count'] = followerCount
    if (caption) inspoFields['Captions'] = caption
    if (sr.Transcript) inspoFields['Transcript'] = sr.Transcript
    if (engagementScore != null) inspoFields['Engagement Score'] = engagementScore
    if (normalizedScore != null) inspoFields['Normalized Score'] = normalizedScore
    if (sr['Z Score'] != null) inspoFields['Z Score'] = sr['Z Score']
    if (sr.Grade) inspoFields['Grade'] = sr.Grade

    // Date: prioritize Posted At, fall back to Date Saved
    const dateForInspo = postedAt || sr['Date Saved']
    if (dateForInspo) inspoFields['Creator Posted Date'] = dateForInspo

    // Review data
    if (rating != null) inspoFields['Rating'] = rating
    if (creatorIds?.length) inspoFields['For Creator'] = creatorIds  // plain string array
    if (reviewerNotes) inspoFields['Reviewer Notes'] = reviewerNotes

    const created = await batchCreateRecords('Inspiration', [{ fields: inspoFields }])
    const inspoRecordId = created[0]?.id

    console.log(`[Review] Created Inspiration record ${inspoRecordId} with views=${views}, followers=${followerCount}, engScore=${engagementScore}`)

    // 6. Update Source Reel with enriched data + mark as imported
    const srUpdateFields = {
      'Imported to Inspiration': 'Yes',
      'Review Status': 'Approved',
    }
    if (rating != null) srUpdateFields['Rating'] = rating
    if (creatorIds?.length) srUpdateFields['For Creator'] = creatorIds
    if (reviewerNotes) srUpdateFields['Reviewer Notes'] = reviewerNotes
    if (views != null && !sr.Views) srUpdateFields['Views'] = views
    if (likes != null && sr.Likes == null) srUpdateFields['Likes'] = likes
    if (comments != null && !sr.Comments) srUpdateFields['Comments'] = comments
    if (followerCount && !sr['Follower Count']) srUpdateFields['Follower Count'] = followerCount

    await patchAirtableRecord('Source Reels', recordId, srUpdateFields)

    // 7. Trigger GitHub Actions for OpenAI analysis
    triggerAnalysis()

    return NextResponse.json({ ok: true, inspoRecordId, enriched: { views, followerCount, engagementScore } })
  } catch (err) {
    console.error('[review] PATCH error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE — soft delete: mark as Rejected (don't actually delete)
export async function DELETE(request) {
  try {
    await requireAdmin()
  } catch (e) { return e }

  try {
    const { recordId } = await request.json()
    if (!recordId) return NextResponse.json({ error: 'Missing recordId' }, { status: 400 })

    await patchAirtableRecord('Source Reels', recordId, {
      'Review Status': 'Rejected',
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[review] DELETE error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
