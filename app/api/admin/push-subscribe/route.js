export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, createAirtableRecord, OPS_BASE, airtableHeaders } from '@/lib/adminAuth'

const TABLE = 'Push Subscriptions'

export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { endpoint, keys } = await request.json()
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json({ error: 'Invalid subscription object' }, { status: 400 })
    }

    // De-duplicate: delete any existing record with the same endpoint
    const existing = await fetchAirtableRecords(TABLE, {
      filterByFormula: `FIND("${endpoint.replace(/"/g, '\\"').replace(/'/g, "\\'")}",{Endpoint})>0`,
      fields: ['Endpoint'],
    })
    for (const rec of existing) {
      await fetch(
        `https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(TABLE)}/${rec.id}`,
        { method: 'DELETE', headers: airtableHeaders }
      )
    }

    await createAirtableRecord(TABLE, {
      Endpoint: endpoint,
      P256dh: keys.p256dh,
      Auth: keys.auth,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[Push Subscribe] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
