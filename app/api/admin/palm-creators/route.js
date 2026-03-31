import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'

export async function GET() {
  try {
    await requireAdmin()

    const records = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `OR({Status} = 'Active', {Status} = 'Onboarding')`,
      fields: ['Creator', 'AKA', 'Status'],
      sort: [{ field: 'Creator', direction: 'asc' }],
    })

    const creators = records.map(r => ({
      id: r.id,
      name: r.fields?.Creator || '',
      aka: r.fields?.AKA || '',
      status: r.fields?.Status?.name || r.fields?.Status || '',
    }))

    return NextResponse.json({ creators })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('Palm creators GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
