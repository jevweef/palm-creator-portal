import { NextResponse } from 'next/server'
import { fetchHqRecords } from '@/lib/hqAirtable'

const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')

  if (!token) {
    return NextResponse.json({ valid: false, error: 'No token provided' })
  }

  try {
    const records = await fetchHqRecords(HQ_CREATORS, {
      filterByFormula: `{Onboarding Token}="${token}"`,
      maxRecords: 1,
      fields: ['Creator', 'Communication Email', 'Onboarding Status'],
    })

    if (records.length === 0) {
      return NextResponse.json({ valid: false, error: 'Invalid or expired token' })
    }

    const rec = records[0]
    return NextResponse.json({
      valid: true,
      name: rec.fields['Creator'] || '',
      email: rec.fields['Communication Email'] || '',
      hqId: rec.id,
      status: rec.fields['Onboarding Status'] || '',
    })
  } catch (err) {
    console.error('[validate-token] Error:', err.message)
    return NextResponse.json({ valid: false, error: 'Server error' }, { status: 500 })
  }
}
