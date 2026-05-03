// Lightweight creator list for the chat→creator mapping dropdown.
// Reads HQ Creators table, returns id + AKA + full name. Active only.

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireInboxOwner } from '@/lib/adminAuth'
import { fetchHqRecords } from '@/lib/hqAirtable'

const HQ_CREATORS = 'Creators'

export async function GET() {
  const auth = await requireInboxOwner()
  if (auth instanceof NextResponse) return auth

  try {
    const records = await fetchHqRecords(HQ_CREATORS, {
      // Only Active + Onboarding creators are relevant for current chat mapping.
      // Leads aren't real creators yet; Offboarded ones don't generate new tasks.
      filterByFormula: `OR({Status} = 'Active', {Status} = 'Onboarding')`,
      fields: ['Creator', 'AKA', 'Status'],
      sort: [{ field: 'AKA', direction: 'asc' }],
    })

    const creators = records
      .filter(r => r.fields?.AKA || r.fields?.Creator)
      .map(r => ({
        id: r.id,
        aka: r.fields?.AKA || r.fields?.Creator || '',
        creator: r.fields?.Creator || '',
        status: r.fields?.Status || null,
      }))

    return NextResponse.json({ creators })
  } catch (err) {
    console.error('[inbox/creators] error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
