export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { NextResponse } from 'next/server'
import {
  requireAdminOrSocialMedia,
  fetchAirtableRecords,
  patchAirtableRecord,
  createAirtableRecord,
} from '@/lib/adminAuth'
import { createSmmTopicForHandle, isSmmGroupConfigured } from '@/lib/telegramTopics'

const SM_SETUP_REQUESTS_TABLE = 'SM Setup Requests'
const CPD_TABLE = 'Creator Platform Directory'

// POST /api/admin/sm-requests/:id/complete-account
// Body: { slot: 1|2|3, handle: string }
//
// Creates a real Instagram CPD row for the creator and marks the slot Done.
// If all 3 slots are done, flips the request Status=Complete + sets Completed At.
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
    const aka = f.AKA || ''

    // Create the CPD row
    const accountName = `${aka || 'Creator'} - Palm IG ${slot}`
    const cpdFields = {
      'Account Name': accountName,
      'Platform': 'Instagram',
      'Managed by Palm': true,
      'Account Type': 'Growth',
      'Handle Override': cleanHandle,
      'URL': `https://instagram.com/${cleanHandle}`,
      'Status': 'Active',
      'Setup Status': 'Live',
    }
    if (creatorLinks.length) cpdFields.Creator = creatorLinks

    const cpdRec = await createAirtableRecord(CPD_TABLE, cpdFields)

    // Create the matching forum topic in the SMM master Telegram group.
    // Best-effort — if Telegram fails, the CPD row + slot completion still go
    // through; admin can re-trigger topic creation later if needed.
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
      accountName,
      telegramTopicId: topicId,
      requestComplete: !!slotUpdates.Status && slotUpdates.Status === 'Complete',
    })
  } catch (err) {
    console.error('[complete-account] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
