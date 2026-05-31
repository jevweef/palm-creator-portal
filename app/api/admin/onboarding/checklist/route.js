import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { fetchHqRecord, patchHqRecord } from '@/lib/hqAirtable'
import { getOrCreateOnboardingRecord } from '@/lib/creatorSetup'
import { computePhase1, EDITABLE_ONBOARDING_FIELDS } from '@/lib/onboarding/checklist'

export const dynamic = 'force-dynamic'

const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'
const HQ_ONBOARDING = 'tbl4nFzgH6nJHr3q6'

export async function GET(request) {
  try {
    await requireAdmin()

    const hqId = new URL(request.url).searchParams.get('hqId')
    if (!hqId) {
      return NextResponse.json({ error: 'hqId is required' }, { status: 400 })
    }

    const creator = await fetchHqRecord(HQ_CREATORS, hqId)
    const ob = await getOrCreateOnboardingRecord(hqId, creator.fields['Creator'] || creator.fields['AKA'] || '')

    const cf = creator.fields || {}

    return NextResponse.json({
      creator: {
        id: creator.id,
        name: cf['Creator'] || '',
        aka: cf['AKA'] || '',
        status: cf['Status'] || '',
        onboardingStatus: cf['Onboarding Status'] || '',
        managementStartDate: cf['Management Start Date'] || null,
        telegram: cf['Telegram'] || '',
        igAccount: cf['IG Account'] || '',
        email: cf['Communication Email'] || '',
      },
      onboarding: {
        id: ob.id,
        fields: ob.fields || {},
      },
      phase1: computePhase1(creator.fields || {}, ob.fields || {}),
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[onboarding/checklist GET] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PATCH(request) {
  try {
    await requireAdmin()

    const { onboardingId, fields } = await request.json()
    if (!onboardingId || !fields || typeof fields !== 'object') {
      return NextResponse.json({ error: 'onboardingId and fields are required' }, { status: 400 })
    }

    // Whitelist — silently drop anything not editable from the drawer.
    const safe = {}
    for (const [k, v] of Object.entries(fields)) {
      if (EDITABLE_ONBOARDING_FIELDS.has(k)) safe[k] = v
    }
    if (Object.keys(safe).length === 0) {
      return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 })
    }

    const updated = await patchHqRecord(HQ_ONBOARDING, onboardingId, safe)
    return NextResponse.json({ success: true, fields: updated.fields || {} })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[onboarding/checklist PATCH] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
