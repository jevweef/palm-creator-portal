import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { fetchHqRecords } from '@/lib/hqAirtable'

const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'

export async function GET() {
  try {
    await requireAdmin()

    const records = await fetchHqRecords(HQ_CREATORS, {
      fields: [
        'Creator', 'AKA', 'Communication Email', 'Onboarding Status',
        'Onboarding Token', 'Onboarding Token Created At', 'Onboarding Date',
        'IG Account', 'Status', 'Lead Source', 'Lead Notes',
      ],
      sort: [{ field: 'Onboarding Token Created At', direction: 'desc' }],
    })

    const creators = records.map(rec => ({
      id: rec.id,
      name: rec.fields['Creator'] || '',
      aka: rec.fields['AKA'] || '',
      email: rec.fields['Communication Email'] || '',
      onboardingStatus: rec.fields['Onboarding Status'] || 'Not Started',
      hasToken: !!rec.fields['Onboarding Token'],
      tokenCreatedAt: rec.fields['Onboarding Token Created At'] || null,
      onboardingDate: rec.fields['Onboarding Date'] || null,
      igAccount: rec.fields['IG Account'] || '',
      status: rec.fields['Status'] || '',
      leadSource: rec.fields['Lead Source'] || '',
      leadNotes: rec.fields['Lead Notes'] || '',
    }))

    return NextResponse.json({ creators })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[onboarding/status] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
