export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { NextResponse } from 'next/server'
import {
  requireAdminOrSocialMedia,
  fetchAirtableRecords,
  patchAirtableRecord,
} from '@/lib/adminAuth'
import { createSmmTopicForHandle, isSmmGroupConfigured } from '@/lib/telegramTopics'

const SM_SETUP_REQUESTS_TABLE = 'SM Setup Requests'
const CPD_TABLE = 'Creator Platform Directory'

// POST /api/admin/sm-requests/:id/complete-account
// Body: { slot: 1|2|3, handle: string }
//
// Marks an existing CPD row Live by writing the handle/URL onto it. Default
// CPD records (Palm IG 1/2/3 + IG Main) are pre-created for every creator —
// this flow ADDS THE USERNAME, it does not create new rows. Also creates the
// matching forum topic in the SMM master Telegram group.
export async function POST(request, { params }) {
  try { await requireAdminOrSocialMedia() } catch (e) { return e }

  try {
    const { slot, handle } = await request.json()
    if (![1, 2, 3].includes(slot)) {
      return NextResponse.json({ error: 'slot must be 1, 2, or 3' }, { status: 400 })
    }
    const cleanHandle = (handle || '').trim().replace(/^@/, '')
    if (!cleanHandle) {
      return NextResponse.json({ error: 'handle is required' }, { status: 400 })
    }

    // Load the request
    const reqRecs = await fetchAirtableRecords(SM_SETUP_REQUESTS_TABLE, {
      filterByFormula: `RECORD_ID()='${params.id}'`,
      maxRecords: 1,
    })
    const reqRec = reqRecs[0]
    if (!reqRec) return NextResponse.json({ error: 'Request not found' }, { status: 404 })

    const f = reqRec.fields || {}
    const creatorLinks = f.Creator || []
    const creatorId = creatorLinks[0]
    const aka = f.AKA || ''

    if (!creatorId) {
      return NextResponse.json({ error: 'Setup request has no linked creator' }, { status: 400 })
    }

    // Find the existing default CPD row for this creator + slot. Account Name
    // pattern: "{AKA} - Palm IG {N}". Can't filter linked records by record ID
    // in Airtable formulas, so fetch IG records for this slot and filter in
    // memory by the creator link.
    const candidates = await fetchAirtableRecords(CPD_TABLE, {
      filterByFormula: `AND({Platform}='Instagram', FIND('Palm IG ${slot}', {Account Name}))`,
    })
    const cpdRec = candidates.find(r => (r.fields?.Creator || []).includes(creatorId))
    if (!cpdRec) {
      return NextResponse.json({
        error: `No existing Palm IG ${slot} record found for this creator. Default account records should be created upstream — contact admin.`,
      }, { status: 404 })
    }

    // Patch handle + Setup Status onto the existing row.
    // URL and Status are synced fields — read-only via API. Managed by Palm
    // is set on default rows already.
    const cpdUpdates = {
      'Handle Override': cleanHandle,
      'Setup Status': 'Live',
    }
    await patchAirtableRecord(CPD_TABLE, cpdRec.id, cpdUpdates)

    // Create the matching forum topic in the SMM master Telegram group.
    // Best-effort — if Telegram fails, the CPD update + slot completion still
    // go through; admin can re-trigger topic creation later if needed.
    let topicId = null
    if (isSmmGroupConfigured()) {
      try {
        topicId = await createSmmTopicForHandle(cleanHandle, { creatorAka: aka })
        if (topicId) {
          await patchAirtableRecord(CPD_TABLE, cpdRec.id, { 'Telegram Topic ID': topicId })
        }
      } catch (err) {
        console.error('[complete-account] topic creation failed (non-fatal):', err.message)
      }
    }

    // Mark slot done on the request + save handle
    const slotUpdates = {
      [`Slot ${slot} Handle`]: cleanHandle,
      [`Slot ${slot} Done`]: true,
    }

    // If all 3 slots will be done after this, flip status Complete
    const otherSlotsDone = [1, 2, 3].filter(n => n !== slot).every(n => !!f[`Slot ${n} Done`])
    if (otherSlotsDone) {
      slotUpdates.Status = 'Complete'
      slotUpdates['Completed At'] = new Date().toISOString()
    } else if (f.Status === 'Pending') {
      slotUpdates.Status = 'In Progress'
    }

    await patchAirtableRecord(SM_SETUP_REQUESTS_TABLE, params.id, slotUpdates)

    return NextResponse.json({
      ok: true,
      cpdRecordId: cpdRec.id,
      accountName: cpdRec.fields?.['Account Name'] || `Palm IG ${slot}`,
      telegramTopicId: topicId,
      requestComplete: !!slotUpdates.Status && slotUpdates.Status === 'Complete',
    })
  } catch (err) {
    console.error('[complete-account] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
