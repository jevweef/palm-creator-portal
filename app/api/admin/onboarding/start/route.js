import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { requireAdmin } from '@/lib/adminAuth'
import { fetchHqRecords, createHqRecord, patchHqRecord } from '@/lib/hqAirtable'
import { createAirtableRecord } from '@/lib/adminAuth'

const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'
const OPS_CREATORS = 'tbls2so6pHGbU4Uhh'

export async function POST(request) {
  try {
    await requireAdmin()

    const { name, email } = await request.json()
    if (!name || !email) {
      return NextResponse.json({ error: 'name and email are required' }, { status: 400 })
    }

    const lower = email.toLowerCase()

    // Check for existing HQ creator by email (dedup)
    const existing = await fetchHqRecords(HQ_CREATORS, {
      filterByFormula: `OR(LOWER({Communication Email})="${lower}",LOWER({OF Email})="${lower}")`,
      maxRecords: 1,
    })

    let hqId
    let isExisting = false

    if (existing.length > 0) {
      // Creator already exists — update with onboarding token
      hqId = existing[0].id
      isExisting = true
    } else {
      // Create new HQ creator record
      const hqRecord = await createHqRecord(HQ_CREATORS, {
        'Creator': name,
        'Communication Email': email,
        'Onboarding Status': 'Link Sent',
      })
      hqId = hqRecord.id
    }

    // Generate onboarding token
    const token = randomUUID()
    await patchHqRecord(HQ_CREATORS, hqId, {
      'Onboarding Token': token,
      'Onboarding Token Created At': new Date().toISOString(),
      'Onboarding Status': 'Link Sent',
    })

    // Check for existing Ops creator record
    const opsExisting = await (async () => {
      const { fetchAirtableRecords } = await import('@/lib/adminAuth')
      return fetchAirtableRecords(OPS_CREATORS, {
        filterByFormula: `{Creator}="${name}"`,
        maxRecords: 1,
      })
    })()

    let opsId
    if (opsExisting.length > 0) {
      opsId = opsExisting[0].id
    } else {
      const opsRecord = await createAirtableRecord(OPS_CREATORS, {
        'Creator': name,
      })
      opsId = opsRecord.id
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.palm-mgmt.com'
    const onboardingUrl = `${baseUrl}/onboarding?token=${token}`

    return NextResponse.json({
      hqId,
      opsId,
      token,
      onboardingUrl,
      isExisting,
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[onboarding/start] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
