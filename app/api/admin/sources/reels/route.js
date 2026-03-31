import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'

export async function GET(request) {
  try {
    await requireAdmin()

    const { searchParams } = new URL(request.url)
    const handle = searchParams.get('handle')
    if (!handle) return NextResponse.json({ error: 'handle required' }, { status: 400 })

    // Strip leading @ for matching against Username field
    const username = handle.replace(/^@/, '')

    const records = await fetchAirtableRecords('Inspiration', {
      filterByFormula: `{Username} = "${username}"`,
      fields: [
        'Title', 'Username', 'Content link', 'Thumbnail',
        'Tags', 'Suggested Tags', 'Film Format',
        'Views', 'Likes', 'Comments', 'Shares',
        'Grade', 'Normalized Score', 'Rating',
        'Audio Type', 'Creator Posted Date',
        'Notes', 'On-Screen Text', 'DB Share Link',
      ],
      sort: [{ field: 'Views', direction: 'desc' }],
    })

    const reels = records.map(r => {
      const f = r.fields || {}
      const thumb = f.Thumbnail?.[0]
      return {
        id: r.id,
        title: f.Title || '',
        username: f.Username || '',
        contentLink: f['Content link'] || '',
        dbShareLink: f['DB Share Link'] || '',
        thumbnail: thumb?.thumbnails?.large?.url || thumb?.url || '',
        tags: [...(f.Tags || []), ...(f['Suggested Tags'] || [])],
        filmFormat: f['Film Format'] || [],
        views: f.Views || null,
        likes: f.Likes || null,
        comments: f.Comments || null,
        shares: f.Shares || null,
        grade: f.Grade || null,
        normalizedScore: f['Normalized Score'] || null,
        rating: f.Rating || null,
        audioType: f['Audio Type'] || null,
        postedAt: f['Creator Posted Date'] || null,
        notes: f.Notes || '',
        onScreenText: f['On-Screen Text'] || '',
      }
    })

    return NextResponse.json({ reels })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('Source reels GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
