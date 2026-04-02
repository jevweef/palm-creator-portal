import { NextResponse } from 'next/server'
import { requireAdmin, airtableHeaders, OPS_BASE } from '@/lib/adminAuth'

const PALM_CREATORS_TABLE = 'tbls2so6pHGbU4Uhh'

// POST /api/admin/creator-profile/reset
// Body: { creatorId }
// Clears profile fields and resets status. Does not touch documents or tag weights.
export async function POST(request) {
  try {
    await requireAdmin()

    const { creatorId } = await request.json()
    if (!creatorId) {
      return NextResponse.json({ error: 'creatorId is required' }, { status: 400 })
    }

    const res = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/${PALM_CREATORS_TABLE}/${creatorId}`,
      {
        method: 'PATCH',
        headers: airtableHeaders,
        body: JSON.stringify({
          fields: {
            'Profile Summary': '',
            'Brand Voice Notes': '',
            'Content Direction Notes': '',
            'Do / Don\'t Notes': '',
            'Profile Analysis Status': 'Not Started',
            'Profile Last Analyzed': null,
          },
        }),
      }
    )
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Airtable PATCH ${res.status}: ${text}`)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('Creator profile reset error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
