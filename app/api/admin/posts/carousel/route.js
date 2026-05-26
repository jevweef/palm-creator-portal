export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, createAirtableRecord } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'

function recordIdFormula(ids) {
  if (!ids.length) return 'FALSE()'
  return `OR(${ids.map(id => `RECORD_ID() = ${quoteAirtableString(id)}`).join(',')})`
}

// POST — create one carousel Post per creator.
// Body (preferred): { photoIds: string[], creatorIds: string[], caption?, hashtags? }
//   photoIds reference rows in the Photos table; we mirror each into a new
//   Asset record (Asset Type=Photo) so the existing Post.Asset linkage and
//   send pipeline work uniformly.
// Body (legacy): { assetIds: string[], ... } — pass-through, expects Asset records.
// Photos table fields read: Source Handle, Caption, Dropbox Link, Dropbox Path, CDN URL, Creator, Source Post URL, Carousel Index.
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const body = await request.json()
    const { creatorIds, caption, hashtags } = body
    let { photoIds, assetIds } = body

    photoIds = Array.isArray(photoIds) ? photoIds : []
    assetIds = Array.isArray(assetIds) ? assetIds : []

    if (!photoIds.length && !assetIds.length) {
      return NextResponse.json({ error: 'photoIds or assetIds required' }, { status: 400 })
    }
    if (photoIds.length + assetIds.length > 10) {
      return NextResponse.json({ error: 'IG carousels max 10 slides' }, { status: 400 })
    }
    if (!Array.isArray(creatorIds) || creatorIds.length < 1) {
      return NextResponse.json({ error: 'creatorIds must be a non-empty array' }, { status: 400 })
    }

    // Mirror Photos → Assets. Ordered: each Photo becomes a fresh Asset so
    // the carousel slide order is preserved by linking the Assets in order.
    let mirroredAssetIds = []
    if (photoIds.length) {
      const photos = await fetchAirtableRecords('Photos', {
        filterByFormula: recordIdFormula(photoIds),
        fields: ['Source Handle', 'Caption', 'Dropbox Link', 'Dropbox Path', 'CDN URL', 'Creator', 'Source Post URL', 'Carousel Index', 'Source Type'],
      })
      const photoById = Object.fromEntries(photos.map(p => [p.id, p]))
      const missing = photoIds.filter(id => !photoById[id])
      if (missing.length) {
        return NextResponse.json({ error: `Photos not found: ${missing.join(', ')}` }, { status: 404 })
      }
      for (const pid of photoIds) {
        const p = photoById[pid]
        const f = p.fields || {}
        const handle = f['Source Handle'] || ''
        const capSnippet = (f['Caption'] || '').slice(0, 40).replace(/\s+/g, ' ').trim()
        const name = `Carousel slide — ${capSnippet || handle || pid}`
        const assetFields = {
          'Asset Name': name,
          'Asset Type': 'Photo',
        }
        if (f['Creator']?.length) assetFields['Palm Creators'] = f['Creator']
        if (f['Dropbox Link']) assetFields['Dropbox Shared Link'] = f['Dropbox Link']
        if (f['Dropbox Path']) assetFields['Dropbox Path (Current)'] = f['Dropbox Path']
        if (f['CDN URL']) assetFields['CDN URL'] = f['CDN URL']
        const rec = await createAirtableRecord('Assets', assetFields, { typecast: true })
        mirroredAssetIds.push(rec.id)
      }
    }

    // Legacy assetIds pass-through: validate they exist and are Photo type.
    if (assetIds.length) {
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
    }

    // Order: mirrored photos first (in input order), then any legacy assetIds.
    const orderedAssetIds = [...mirroredAssetIds, ...assetIds]

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
    const slideLabel = orderedAssetIds.length === 1 ? '1 photo' : `${orderedAssetIds.length} photos`

    const created = []
    for (const creatorId of creatorIds) {
      const c = creatorMap[creatorId] || {}
      const aka = c.AKA || c.Creator || ''
      const postName = [aka, shortDate, slideLabel].filter(Boolean).join(' – ')

      const fields = {
        'Post Name': postName,
        'Creator': [creatorId],
        'Asset': orderedAssetIds,
        'Type': 'Carousel',
        'Status': 'Ready to Go',
      }
      if (caption) fields['Caption'] = caption
      if (hashtags) fields['Hashtags'] = hashtags

      const rec = await createAirtableRecord('Posts', fields, { typecast: true })
      created.push({ id: rec.id, creatorId, name: postName })
    }

    return NextResponse.json({ posts: created, mirroredAssetIds })
  } catch (err) {
    console.error('[Posts/carousel] POST error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
