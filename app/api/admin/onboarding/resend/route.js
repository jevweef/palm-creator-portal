import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { requireAdmin } from '@/lib/adminAuth'
import { patchHqRecord } from '@/lib/hqAirtable'

const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'

export async function POST(request) {
  try {
    await requireAdmin()

    const { hqId } = await request.json()
    if (!hqId) {
      return NextResponse.json({ error: 'hqId is required' }, { status: 400 })
    }

    const token = randomUUID()
    await patchHqRecord(HQ_CREATORS, hqId, {
      'Onboarding Token': token,
      'Onboarding Token Created At': new Date().toISOString(),
      'Onboarding Status': 'Link Sent',
    })

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.palm-mgmt.com'
    const onboardingUrl = `${baseUrl}/onboarding?token=${token}`

    return NextResponse.json({ token, onboardingUrl })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[onboarding/resend] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
