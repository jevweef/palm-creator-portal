import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'

const HQ_BASE = 'appL7c4Wtotpz07KS'
const HQ_CREATORS_TABLE = 'tblYhkNvrNuOAHfgw'

export async function GET() {
  try {
    await requireAdmin()

    const [opsRecords, hqRecords] = await Promise.all([
      fetchAirtableRecords('Palm Creators', {
        filterByFormula: `OR({Status} = 'Active', {Status} = 'Onboarding')`,
        fields: ['Creator', 'AKA', 'Status'],
        sort: [{ field: 'Creator', direction: 'asc' }],
      }),
      // Fetch HQ creators to get hqId by matching name
      fetchHqCreators(),
    ])

    // Build name + AKA → hqId map (case-insensitive, try both fields)
    const hqMap = {}
    for (const r of hqRecords) {
      const name = (r.fields?.Creator || '').toLowerCase().trim()
      const aka = (r.fields?.AKA || '').toLowerCase().trim()
      if (name) hqMap[name] = r.id
      if (aka) hqMap[aka] = r.id
    }

    const creators = opsRecords.map(r => {
      const name = r.fields?.Creator || ''
      const aka = r.fields?.AKA || ''
      const hqId = hqMap[name.toLowerCase().trim()]
        || hqMap[aka.toLowerCase().trim()]
        || null
      return {
        id: r.id,
        hqId,
        name,
        aka,
        status: r.fields?.Status?.name || r.fields?.Status || '',
      }
    })

    return NextResponse.json({ creators })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('Palm creators GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

async function fetchHqCreators() {
  const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY
  const url = `https://api.airtable.com/v0/${HQ_BASE}/${HQ_CREATORS_TABLE}?fields%5B%5D=Creator&fields%5B%5D=AKA&pageSize=100`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
    next: { revalidate: 0 },
  })
  if (!res.ok) return []
  const data = await res.json()
  return data.records || []
}
