import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'

export async function GET(request) {
  try {
    await requireAdmin()

    const { searchParams } = new URL(request.url)
    const handle = searchParams.get('handle')
    if (!handle) return NextResponse.json({ error: 'handle required' }, { status: 400 })

    const records = await fetchAirtableRecords('Source Reels', {
      filterByFormula: `{Source Handle} = "${handle}"`,
      fields: ['Reel URL', 'Views', 'Likes', 'Comments', 'Shares', 'Posted At', 'Grade', 'Z Score', 'Normalized Score', 'Data Source', 'Audio Type', 'Caption'],
      sort: [{ field: 'Views', direction: 'desc' }],
      maxRecords: 100,
    })

    const reels = records.map(r => ({
      id: r.id,
      url: r.fields?.['Reel URL'] || '',
      views: r.fields?.Views || null,
      likes: r.fields?.Likes || null,
      comments: r.fields?.Comments || null,
      shares: r.fields?.Shares || null,
      postedAt: r.fields?.['Posted At'] || null,
      grade: r.fields?.Grade || null,
      zScore: r.fields?.['Z Score'] || null,
      normalizedScore: r.fields?.['Normalized Score'] || null,
      dataSource: r.fields?.['Data Source'] || null,
      audioType: r.fields?.['Audio Type'] || null,
      caption: r.fields?.['Caption'] || null,
    }))

    return NextResponse.json({ reels })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('Source reels GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
