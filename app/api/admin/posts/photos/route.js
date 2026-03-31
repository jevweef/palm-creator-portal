export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'

export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }

  const { searchParams } = new URL(request.url)
  const creatorId = searchParams.get('creatorId')
  if (!creatorId) return NextResponse.json({ error: 'creatorId required' }, { status: 400 })

  try {
    const assets = await fetchAirtableRecords('Assets', {
      filterByFormula: `AND({Asset Type}='Photo',NOT({Dropbox Shared Link}=''))`,
      fields: ['Asset Name', 'Dropbox Shared Link', 'Palm Creators', 'Asset Type', 'Pipeline Status'],
      sort: [{ field: 'Created Time', direction: 'desc' }],
      maxRecords: 200,
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
