import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { fetchHqRecord, patchHqRecord } from '@/lib/hqAirtable'
import { getOrCreateOnboardingRecord } from '@/lib/creatorSetup'
import { computePhase1, computeReadiness } from '@/lib/onboarding/checklist'
import { quoteAirtableString } from '@/lib/airtableFormula'

export const dynamic = 'force-dynamic'

const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'
const HQ_ONBOARDING = 'tbl4nFzgH6nJHr3q6'
const OPS_PALM_CREATORS = 'Palm Creators'

// Is Palm running this creator's socials? Lives on the Ops Palm Creators record
// (same flag the dashboard "Editor" toggle writes). Needed so the go-live gate
// doesn't require social-only tasks (bios/pics/first-week/QA) for OF-only creators.
async function isSocialManaged(hqId, name, aka) {
  try {
    const byLink = await fetchAirtableRecords(OPS_PALM_CREATORS, {
      filterByFormula: `{HQ Record ID}='${hqId}'`, maxRecords: 1,
    })
    let rec = byLink[0]
    if (!rec) {
      const clauses = []
      if (name) clauses.push(`{Creator}=${quoteAirtableString(name)}`)
      if (aka) clauses.push(`{AKA}=${quoteAirtableString(aka)}`)
      if (clauses.length) {
        const byName = await fetchAirtableRecords(OPS_PALM_CREATORS, {
          filterByFormula: `OR(${clauses.join(',')})`, maxRecords: 1,
        })
        rec = byName[0]
      }
    }
    return rec?.fields?.['Social Media Editing'] === true
  } catch {
    return true // fail safe: keep the full (stricter) gate if lookup fails
  }
}

/**
 * POST /api/admin/onboarding/go-live
 * Body: { hqId }
 *
 * Flips the creator live once every required Phase 1-3 item is satisfied:
 *   - Creators.Status            -> "Active"
 *   - Creators.Management Start Date -> today
 *   - Onboarding.Go-Live Approved    -> true
 *
 * Re-validates readiness server-side (the UI gates the button, but never
 * trust the client). Idempotent — re-running on an already-active creator
 * just re-stamps the same values.
 */
export async function POST(request) {
  try {
    await requireAdmin()

    const { hqId } = await request.json()
    if (!hqId) {
      return NextResponse.json({ error: 'hqId is required' }, { status: 400 })
    }

    const creator = await fetchHqRecord(HQ_CREATORS, hqId)
    const ob = await getOrCreateOnboardingRecord(hqId, creator.fields['Creator'] || creator.fields['AKA'] || '')

    const cf = creator.fields || {}
    const socialManaged = await isSocialManaged(hqId, cf['Creator'] || '', cf['AKA'] || '')
    const phase1 = computePhase1(cf, ob.fields || {})
    const { ready, missing } = computeReadiness(phase1, ob.fields || {}, socialManaged)

    if (!ready) {
      return NextResponse.json(
        { error: 'Not all required items are complete', missing },
        { status: 422 }
      )
    }

    const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

    // Preserve an existing Management Start Date if one was already set.
    const startDate = creator.fields['Management Start Date'] || today

    await Promise.all([
      patchHqRecord(HQ_CREATORS, hqId, {
        'Status': 'Active',
        'Management Start Date': startDate,
      }),
      patchHqRecord(HQ_ONBOARDING, ob.id, {
        'Go-Live Approved': true,
      }),
    ])

    return NextResponse.json({
      success: true,
      hqId,
      status: 'Active',
      managementStartDate: startDate,
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[onboarding/go-live] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
