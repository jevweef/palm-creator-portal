import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

// GET — data for the whale dashboard: creators (+ OF API connection status)
// and the Fan Tracker watchlist grouped per creator.
export async function GET() {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const [creators, tracker] = await Promise.all([
      fetchAirtableRecords('Palm Creators', {
        fields: ['Creator', 'AKA', 'Status', 'OF API Account ID', 'Whale Runs'],
      }),
      fetchAirtableRecords('Fan Tracker', {
        fields: ['Fan Name', 'OF Username', 'Creator', 'Status', 'Lifetime Spend',
          'First Flagged', 'Last Alert Sent', 'Alert Count', 'Effectiveness', 'Notes', 'Last Chat Upload', 'Cadence'],
      }),
    ])

    // Only ACTIVE managed creators (leads/paused/offboarded have no whale work).
    // Connected accounts always show — keeps the test account visible even if
    // its status ever changes.
    const creatorList = creators
      .filter((c) => {
        const status = typeof c.fields?.Status === 'string' ? c.fields.Status : c.fields?.Status?.name
        return status === 'Active' || !!c.fields?.['OF API Account ID']
      })
      .map((c) => ({
        id: c.id,
        name: c.fields?.Creator || '',
        aka: c.fields?.AKA || c.fields?.Creator || '',
        connected: !!c.fields?.['OF API Account ID'],
        runs: (() => { try { return JSON.parse(c.fields?.['Whale Runs'] || '{}') } catch { return {} } })(),
      }))
      .sort((a, b) => (b.connected - a.connected) || a.aka.localeCompare(b.aka))

    const nameById = Object.fromEntries(creatorList.map((c) => [c.id, c.aka]))
    const watchlist = tracker
      .map((r) => {
        const f = r.fields || {}
        const creatorId = (f.Creator || [])[0] || null
        const status = typeof f.Status === 'string' ? f.Status : f.Status?.name
        return {
          id: r.id,
          fanName: f['Fan Name'] || '',
          ofUsername: f['OF Username'] || '',
          creatorId,
          creator: nameById[creatorId] || '',
          status: status || '',
          lifetime: f['Lifetime Spend'] || 0,
          firstFlagged: f['First Flagged'] || null,
          lastAlert: f['Last Alert Sent'] || null,
          alertCount: f['Alert Count'] || 0,
          effectiveness: typeof f.Effectiveness === 'string' ? f.Effectiveness : f.Effectiveness?.name || '',
          notes: f.Notes || '',
          cadence: (() => { try { return JSON.parse(f.Cadence || 'null') } catch { return null } })(),
        }
      })
      .filter((w) => w.status && !['Reactivated', 'Lost', 'Banned'].includes(w.status))
      .sort((a, b) => b.lifetime - a.lifetime)

    return NextResponse.json({ creators: creatorList, watchlist })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
