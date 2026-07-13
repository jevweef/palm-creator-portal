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

    const [aiInFlightRecords, realInFlightRecords, needsReviewRecords, activeWarmupsRecords] = await Promise.all([
      settle(fetchAirtableRecords('Posts', {
        // AI in flight = handed off to an outbound channel, not yet posted.
        //  • Publer AI accounts: Publer Status='Submitted'.
        //  • AI reels routed to the AI Telegram topic (Pipeline Target='AI'):
        //    queued/sending/sent to Telegram but not yet posted (the ❤️
        //    reaction stamps Posted At and drops it out of flight).
        filterByFormula: "OR({Publer Status}='Submitted',AND({Pipeline Target}='AI',{Posted At}='',OR({Status}='Queued for Telegram',{Status}='Sending to Telegram',{Status}='Sent to Telegram')))",
        fields: ['Status'],
      })),
      settle(fetchAirtableRecords('Posts', {
        // Real content sitting in the manager's Telegram, awaiting manual
        // posting. In flight = queued/sending/sent to Telegram but not yet
        // posted. Exclude AI (that's the AI-in-flight tile).
        filterByFormula: "AND({Pipeline Target}!='AI',{Posted At}='',OR({Status}='Queued for Telegram',{Status}='Sending to Telegram',{Status}='Sent to Telegram'))",
        fields: ['Status'],
      })),
      settle(fetchAirtableRecords('Tasks', {
        // Same filter as the For Review API uses.
        filterByFormula: "AND({Status}='Done',{Admin Review Status}='Pending Review')",
        fields: ['Status'],
      })),
      settle(fetchAirtableRecords('AI Account Profile', {
        // Setup + Warming Up both count as active (operator has work to do).
        // Live/Paused/Retired excluded.
        filterByFormula: "OR({Warmup Status}='Setup',{Warmup Status}='Warming Up')",
        fields: ['Warmup Status'],
      })),
    ])

    return NextResponse.json({
      aiInFlight:    aiInFlightRecords    ? aiInFlightRecords.length    : 0,
      realInFlight:  realInFlightRecords  ? realInFlightRecords.length  : 0,
      needsReview:   needsReviewRecords   ? needsReviewRecords.length   : 0,
      activeWarmups: activeWarmupsRecords ? activeWarmupsRecords.length : 0,
      asOf: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[marketing-content/overview] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
