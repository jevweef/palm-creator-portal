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
    const extFormula = `OR(${imageExts.map(e => `LOWER({File Extension})='${e}'`).join(',')})`
    const baseFormula = `AND(NOT({Dropbox Shared Link}=''),${extFormula})`
    const formula = forReel
      ? `AND(${baseFormula},NOT({Used As Reel Thumbnail}))`
      : baseFormula

    const assets = await fetchAirtableRecords('Assets', {
      filterByFormula: formula,
      fields: ['Asset Name', 'Dropbox Shared Link', 'Palm Creators', 'Asset Type', 'Pipeline Status', 'Used As Reel Thumbnail', 'File Extension'],
      sort: [{ field: 'Created Time', direction: 'desc' }],
      maxRecords: 500,
    })

    // Filter in memory for this creator
    const photos = assets
      .filter(a => (a.fields?.['Palm Creators'] || []).includes(creatorId))
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
