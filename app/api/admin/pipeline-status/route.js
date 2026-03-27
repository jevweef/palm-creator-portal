import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'

export async function GET() {
  try {
    await requireAdmin()

    // Fetch all data in parallel
    const [inspoRecords, sourceReels, inspoSources] = await Promise.all([
      fetchAirtableRecords('Inspiration', {
        fields: ['Status', 'Marked Complete'],
      }),
      fetchAirtableRecords('Source Reels', {
        fields: ['Source Handle'],
      }),
      fetchAirtableRecords('Inspo Sources', {
        fields: ['Handle', 'Enabled', 'Last Scraped At', 'Pipeline Status', 'Reels Scraped', 'Source Reels Added', 'Follower Count'],
      }),
    ])

    // Count Inspiration by status
    const statusCounts = {}
    for (const rec of inspoRecords) {
      const status = rec.fields?.Status || 'Unknown'
      statusCounts[status] = (statusCounts[status] || 0) + 1
    }

    // Source stats
    const enabledSources = inspoSources.filter(r => r.fields?.Enabled)
    let lastScrape = null
    for (const rec of inspoSources) {
      const ts = rec.fields?.['Last Scraped At']
      if (ts && (!lastScrape || ts > lastScrape)) {
        lastScrape = ts
      }
    }

    return NextResponse.json({
      inspiration: {
        total: inspoRecords.length,
        byStatus: statusCounts,
      },
      sourceReels: {
        total: sourceReels.length,
      },
      sources: {
        total: inspoSources.length,
        enabled: enabledSources.length,
        lastScrape,
      },
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('Pipeline status error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
