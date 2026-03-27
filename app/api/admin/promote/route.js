import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, batchCreateRecords, batchUpdateRecords } from '@/lib/adminAuth'

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

export async function POST() {
  try {
    await requireAdmin()

    const now = new Date()
    const cutoff = new Date(now - LOOKBACK_DAYS * 86400000)
    const tooNew = new Date(now - MIN_AGE_DAYS * 86400000)

    // Fetch all data in parallel
    const [sourceReels, inspoRecords, inspoSources] = await Promise.all([
      fetchAirtableRecords('Source Reels'),
      fetchAirtableRecords('Inspiration', { fields: ['Content link'] }),
      fetchAirtableRecords('Inspo Sources', { fields: ['Handle', 'Palm Creators', 'Follower Count'] }),
    ])

    // Build existing Inspiration URL set
    const existingInspoUrls = new Set()
    for (const rec of inspoRecords) {
      const url = rec.fields?.['Content link'] || ''
      if (url) existingInspoUrls.add(normalizeUrl(url))
    }

    // Build palm creator + follower maps from Inspo Sources
    const palmCreatorMap = {}
    const followerMap = {}
    for (const rec of inspoSources) {
      const handle = (rec.fields?.Handle || '').trim().toLowerCase()
      if (!handle) continue
      const creators = rec.fields?.['Palm Creators'] || []
      if (creators.length) palmCreatorMap[handle] = creators
      if (rec.fields?.['Follower Count']) followerMap[handle] = rec.fields['Follower Count']
    }

    // Filter eligible source reels
    const eligible = []
    for (const rec of sourceReels) {
      const f = rec.fields || {}
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

    // Group by creator, select top performers
    const byCreator = {}
    for (const item of eligible) {
      const handle = item.record.fields?.['Source Handle'] || 'unknown'
      if (!byCreator[handle]) byCreator[handle] = []
      byCreator[handle].push(item)
    }

    const toPromote = []
    const goldenSet = []

    for (const [handle, reels] of Object.entries(byCreator)) {
      reels.sort((a, b) => b.score - a.score)
      const target = Math.min(Math.max(1, Math.floor(reels.length * TOP_PERCENT)), MAX_PER_CREATOR)
      let totalSelected = 0

      for (const item of reels) {
        if (totalSelected >= target) break
        const f = item.record.fields
        const urlKey = normalizeUrl(f['Reel URL'] || '')

        if (f['Imported to Inspiration']) {
          goldenSet.push(item)
          totalSelected++
          continue
        }
        if (existingInspoUrls.has(urlKey)) {
          goldenSet.push(item)
          totalSelected++
          continue
        }

        goldenSet.push(item)
        toPromote.push(item)
        totalSelected++
      }
    }

    if (toPromote.length === 0) {
      return NextResponse.json({ promoted: 0, message: 'Nothing new to promote — all top performers already in Inspiration.' })
    }

    // Update scores on golden set
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

    // Create in batches, mark as imported after each batch
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

    return NextResponse.json({
      promoted: created,
      message: `Promoted ${created} reels to Inspiration.`,
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('Promote error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
