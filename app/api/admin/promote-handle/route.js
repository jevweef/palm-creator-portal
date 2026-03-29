import { NextResponse } from 'next/server'
import { fetchAirtableRecords, batchCreateRecords, batchUpdateRecords } from '@/lib/adminAuth'

const GITHUB_PAT = process.env.GITHUB_PAT
const GITHUB_REPO = 'jevweef/inspo-pipeline'
const LOOKBACK_DAYS = 180
const MIN_AGE_DAYS = 10
const TOP_PERCENT = 0.25
const MAX_PER_CREATOR = 20

function normalizeUrl(url) {
  const match = url.match(/instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/)
  return match ? match[1] : url.trim()
}

function canonicalUrl(url) {
  const shortcode = normalizeUrl(url)
  if (shortcode && shortcode !== url.trim()) {
    return `https://www.instagram.com/reel/${shortcode}/`
  }
  return url.trim()
}

function engagementScore(fields) {
  const views = fields.Views || 0
  if (views === 0) return 0
  const likes = Math.max(0, fields.Likes || 0)
  const comments = Math.max(0, fields.Comments || 0)
  const shares = Math.max(0, fields.Shares || 0)
  const weighted = (likes * 1 + comments * 3 + shares * 5) / views
  return weighted * Math.log10(Math.max(views, 10))
}

export const maxDuration = 60

// Public endpoint — secured by secret param (called from apify-callback)
export async function POST(request) {
  try {
    const { searchParams } = new URL(request.url)
    const secret = searchParams.get('secret')
    const expectedSecret = process.env.APIFY_CALLBACK_SECRET || 'default-secret'

    if (secret !== expectedSecret) {
      return NextResponse.json({ error: 'Invalid secret' }, { status: 403 })
    }

    const body = await request.json()
    const handle = body.handle

    if (!handle) {
      return NextResponse.json({ error: 'handle required' }, { status: 400 })
    }

    console.log(`[Promote-Handle] Starting promote for @${handle}`)

    const now = new Date()
    const cutoff = new Date(now - LOOKBACK_DAYS * 86400000)
    const tooNew = new Date(now - MIN_AGE_DAYS * 86400000)

    // Fetch only this handle's Source Reels, only this handle's Inspo Source, and existing Inspiration URLs for this username
    const [sourceReels, inspoRecords, inspoSources] = await Promise.all([
      fetchAirtableRecords('Source Reels', {
        filterByFormula: `{Source Handle} = "${handle}"`,
      }),
      fetchAirtableRecords('Inspiration', {
        fields: ['Content link'],
        filterByFormula: `{Username} = "${handle}"`,
      }),
      fetchAirtableRecords('Inspo Sources', {
        fields: ['Handle', 'Palm Creators', 'Follower Count'],
        filterByFormula: `LOWER({Handle}) = "${handle.toLowerCase()}"`,
      }),
    ])

    console.log(`[Promote-Handle] @${handle}: ${sourceReels.length} source reels, ${inspoRecords.length} existing inspo, ${inspoSources.length} source configs`)

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

    // Filter eligible
    const eligible = []
    for (const rec of sourceReels) {
      const f = rec.fields || {}
      if (!f['Reel URL'] || !f.Views || f.Views < 5000) continue

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
      console.log(`[Promote-Handle] @${handle}: nothing new to promote`)
      return NextResponse.json({ promoted: 0, analysisTriggered: false })
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

    console.log(`[Promote-Handle] @${handle}: promoted ${created} reels`)

    // Trigger GitHub Actions analysis workflow
    let analysisTriggered = false
    if (created > 0 && GITHUB_PAT) {
      try {
        const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/dispatches`, {
          method: 'POST',
          headers: {
            'Authorization': `token ${GITHUB_PAT}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            event_type: 'run-analysis',
            client_payload: { handle, trigger: 'auto-chain', timestamp: new Date().toISOString() },
          }),
        })
        analysisTriggered = res.status === 204
        console.log(`[Promote-Handle] GitHub Actions dispatch: ${res.status}`)
      } catch (err) {
        console.error('[Promote-Handle] GitHub Actions trigger failed:', err)
      }
    }

    return NextResponse.json({ promoted: created, analysisTriggered })
  } catch (err) {
    console.error('Promote-handle error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
