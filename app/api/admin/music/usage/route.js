export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdminOrEditor, fetchAirtableRecords, createAirtableRecord } from '@/lib/adminAuth'

// GET — fetch spotify IDs used by a creator in the last 14 days
export async function GET(request) {
  try { await requireAdminOrEditor() } catch (e) { return e }

  const { searchParams } = new URL(request.url)
  const creatorId = searchParams.get('creatorId')
  if (!creatorId) return NextResponse.json({ error: 'creatorId required' }, { status: 400 })

  try {
    const records = await fetchAirtableRecords('Music Usage', {
      filterByFormula: `AND(FIND('${creatorId}', ARRAYJOIN({Creator})), IS_AFTER({Used Date}, DATEADD(NOW(), -14, 'days')))`,
      fields: ['Spotify ID'],
    })

    const usedIds = new Set(records.map(r => r.fields?.['Spotify ID']).filter(Boolean))
    return NextResponse.json({ ok: true, usedIds: [...usedIds] })
  } catch (err) {
    console.error('[Music Usage] GET error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST — log a song as used for a creator
export async function POST(request) {
  try { await requireAdminOrEditor() } catch (e) { return e }

  try {
    const { creatorId, spotifyId, songTitle, artist } = await request.json()
    if (!creatorId || !spotifyId) return NextResponse.json({ error: 'creatorId and spotifyId required' }, { status: 400 })

    await createAirtableRecord('Music Usage', {
      'Song Title': songTitle || '',
      'Artist': artist || '',
      'Spotify ID': spotifyId,
      'Creator': [creatorId],
      'Used Date': new Date().toISOString(),
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[Music Usage] POST error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
