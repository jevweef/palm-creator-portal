export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'

export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }

  const { searchParams } = new URL(request.url)
  const creatorId = searchParams.get('creatorId')
  const forReel = searchParams.get('forReel') === 'true'
  if (!creatorId) return NextResponse.json({ error: 'creatorId required' }, { status: 400 })

  try {
    const imageExts = ['jpg','jpeg','png','gif','webp','heic','heif','bmp','tiff','tif']
    const imageExtRegex = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)/i

    // Fetch all assets with a Dropbox link — paginated, no maxRecords cap
    // Filter by creator, image type, and reel thumbnail flag in memory
    // (ARRAYJOIN on linked records returns display names not IDs, so can't filter creator in formula)
    const assets = await fetchAirtableRecords('Assets', {
      filterByFormula: `NOT({Dropbox Shared Link}='')`,
      fields: ['Asset Name', 'Dropbox Shared Link', 'Palm Creators', 'Asset Type', 'Pipeline Status', 'Used As Reel Thumbnail', 'File Extension'],
      sort: [{ field: 'Created Time', direction: 'desc' }],
    })

    const isImageAsset = (a) => {
      const ext = (a.fields?.['File Extension'] || '').toLowerCase()
      const link = a.fields?.['Dropbox Shared Link'] || ''
      const type = (a.fields?.['Asset Type'] || '').toLowerCase()
      return imageExts.includes(ext) || imageExtRegex.test(link) || type === 'photo' || type === 'image'
    }

    // Debug: log first few assets to inspect structure
    if (assets.length > 0) {
      const sample = assets[0]
      console.log('[Photos] total assets fetched:', assets.length)
      console.log('[Photos] creatorId:', creatorId)
      console.log('[Photos] sample Palm Creators field:', JSON.stringify(sample.fields?.['Palm Creators']))
      console.log('[Photos] sample Asset Type field:', JSON.stringify(sample.fields?.['Asset Type']))
    }

    // Filter in memory for this creator + image type + reel thumbnail flag
    const photos = assets
      .filter(a => {
        if (!(a.fields?.['Palm Creators'] || []).includes(creatorId)) return false
        if (!isImageAsset(a)) return false
        if (forReel && a.fields?.['Used As Reel Thumbnail']) return false
        return true
      })
      .map(a => ({
        id: a.id,
        name: a.fields['Asset Name'] || '',
        dropboxLink: a.fields['Dropbox Shared Link'] || '',
        pipelineStatus: a.fields['Pipeline Status'] || '',
      }))

    return NextResponse.json({ photos })
  } catch (err) {
    console.error('[Photos] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH — mark an asset as used as reel thumbnail
export async function PATCH(request) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const { assetId } = await request.json()
    if (!assetId) return NextResponse.json({ error: 'assetId required' }, { status: 400 })
    await patchAirtableRecord('Assets', assetId, { 'Used As Reel Thumbnail': true })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
