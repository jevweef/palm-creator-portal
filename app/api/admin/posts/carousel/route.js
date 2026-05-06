export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, createAirtableRecord } from '@/lib/adminAuth'

function recordIdFormula(ids) {
  if (!ids.length) return 'FALSE()'
  return `OR(${ids.map(id => `RECORD_ID()='${id}'`).join(',')})`
}

// POST — create one Post per IG account, each linking N photo Assets in order.
// Body: { assetIds: string[] (1–10, ordered), creatorIds: string[], caption?, hashtags? }
// Returns: { posts: [{ id, creatorId, name }, ...] }
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { assetIds, creatorIds, caption, hashtags } = await request.json()

    if (!Array.isArray(assetIds) || assetIds.length < 1) {
      return NextResponse.json({ error: 'assetIds must be a non-empty array' }, { status: 400 })
    }
    if (assetIds.length > 10) {
      return NextResponse.json({ error: 'IG carousels max 10 slides' }, { status: 400 })
    }
    if (!Array.isArray(creatorIds) || creatorIds.length < 1) {
      return NextResponse.json({ error: 'creatorIds must be a non-empty array' }, { status: 400 })
    }

    const assets = await fetchAirtableRecords('Assets', {
      filterByFormula: recordIdFormula(assetIds),
      fields: ['Asset Name', 'Asset Type'],
    })
    if (assets.length !== assetIds.length) {
      const found = new Set(assets.map(a => a.id))
      const missing = assetIds.filter(id => !found.has(id))
      return NextResponse.json({ error: `Assets not found: ${missing.join(', ')}` }, { status: 404 })
    }
    const nonPhoto = assets.filter(a => a.fields?.['Asset Type'] !== 'Photo')
    if (nonPhoto.length) {
      return NextResponse.json({
        error: `All assets must be Asset Type='Photo'. Non-photo: ${nonPhoto.map(a => a.id).join(', ')}`,
      }, { status: 400 })
    }

    const creators = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: recordIdFormula(creatorIds),
      fields: ['AKA', 'Creator'],
    })
    if (creators.length !== creatorIds.length) {
      const found = new Set(creators.map(c => c.id))
      const missing = creatorIds.filter(id => !found.has(id))
      return NextResponse.json({ error: `Creators not found: ${missing.join(', ')}` }, { status: 404 })
    }
    const creatorMap = Object.fromEntries(creators.map(c => [c.id, c.fields]))

    const shortDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const slideLabel = assetIds.length === 1 ? '1 photo' : `${assetIds.length} photos`

    const created = []
    for (const creatorId of creatorIds) {
      const c = creatorMap[creatorId] || {}
      const aka = c.AKA || c.Creator || ''
      const postName = [aka, shortDate, slideLabel].filter(Boolean).join(' – ')

      const fields = {
        'Post Name': postName,
        'Creator': [creatorId],
        'Asset': assetIds,
        'Status': 'Prepping',
      }
      if (caption) fields['Caption'] = caption
      if (hashtags) fields['Hashtags'] = hashtags

      const rec = await createAirtableRecord('Posts', fields)
      created.push({ id: rec.id, creatorId, name: postName })
    }

    return NextResponse.json({ posts: created })
  } catch (err) {
    console.error('[Posts/carousel] POST error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
