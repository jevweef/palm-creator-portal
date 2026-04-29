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
      fields: ['Creator', 'AKA', 'Status'],
      sort: [{ field: 'AKA', direction: 'asc' }],
    })

    const creators = records
      .filter(r => {
        const status = r.fields?.Status
        // Skip churned/paused if you want — for now include everyone so admin
        // can map historical chats to inactive creators too.
        return r.fields?.AKA || r.fields?.Creator
      })
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
