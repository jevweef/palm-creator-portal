import { getInspirationRecords } from '@/lib/airtable'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 300 // cache for 5 minutes

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const tags = searchParams.get('tags')?.split(',').filter(Boolean) || []
    const formats = searchParams.get('formats')?.split(',').filter(Boolean) || []
    const creator = searchParams.get('creator') || ''
    // Effort filter: comma-separated list of Easy/Moderate/Niche.
    // Default = Easy + Moderate (hide Niche unless explicitly requested).
    // Pass effort=all to disable filtering.
    const effortParam = searchParams.get('effort')
    const effortFilter = effortParam === 'all'
      ? null
      : (effortParam ? effortParam.split(',').filter(Boolean) : ['Easy', 'Moderate'])

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

    if (effortFilter) {
      // Until backfill completes, records without an Effort value (still on the
      // OpenAI analysis) are shown by default — no info to filter on yet.
      records = records.filter((r) => !r.effort || effortFilter.includes(r.effort))
    }

    return NextResponse.json({ records, total: records.length })
  } catch (err) {
    console.error('API error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
