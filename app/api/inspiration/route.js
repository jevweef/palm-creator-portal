import { getInspirationRecords } from '@/lib/airtable'
import { NextResponse } from 'next/server'

export const revalidate = 300 // cache for 5 minutes

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const tags = searchParams.get('tags')?.split(',').filter(Boolean) || []
    const formats = searchParams.get('formats')?.split(',').filter(Boolean) || []
    const creator = searchParams.get('creator') || ''

    let records = await getInspirationRecords()

    if (creator) {
      records = records.filter((r) =>
        r.username.toLowerCase().includes(creator.toLowerCase())
      )
    }

    if (tags.length > 0) {
      records = records.filter((r) =>
        tags.some((tag) => r.tags.includes(tag) || r.suggestedTags.includes(tag))
      )
    }

    if (formats.length > 0) {
      records = records.filter((r) =>
        formats.some((fmt) => r.filmFormat.includes(fmt))
      )
    }

    return NextResponse.json({ records, total: records.length })
  } catch (err) {
    console.error('API error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
