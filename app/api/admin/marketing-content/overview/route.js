export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'

// Marketing Content hub KPI feed. Read-only aggregation from existing tables.
// No new schema. `activeWarmups` returns 0 until Batch 2 ships the Warmup
// Tasks table; the tile still renders, just with a 0.
export async function GET() {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const settle = (p) => p.then(v => v).catch(() => null)

    const [aiInFlightRecords, realInFlightRecords, needsReviewRecords] = await Promise.all([
      settle(fetchAirtableRecords('Posts', {
        // Publer Phase 1+2 stamps Publer Status = 'Submitted' once a post is
        // sent to Publer and awaiting publish.
        filterByFormula: "{Publer Status}='Submitted'",
        fields: ['Publer Status'],
      })),
      settle(fetchAirtableRecords('Posts', {
        // Real-stream content sitting in the Telegram queue (sent to Amin
        // for manual posting). Two states bracket "in flight."
        filterByFormula: "OR({Status}='Queued for Telegram',{Status}='Sending to Telegram')",
        fields: ['Status'],
      })),
      settle(fetchAirtableRecords('Tasks', {
        // Same filter as the For Review API uses.
        filterByFormula: "AND({Status}='Done',{Admin Review Status}='Pending Review')",
        fields: ['Status'],
      })),
    ])

    return NextResponse.json({
      aiInFlight:    aiInFlightRecords    ? aiInFlightRecords.length    : 0,
      realInFlight:  realInFlightRecords  ? realInFlightRecords.length  : 0,
      needsReview:   needsReviewRecords   ? needsReviewRecords.length   : 0,
      activeWarmups: 0, // Wired in Batch 2.
      asOf: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[marketing-content/overview] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
