export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import {
  requireAdmin,
  fetchAirtableRecords,
  patchAirtableRecord,
} from '@/lib/adminAuth'
import { createSmmTopicForHandle, isSmmGroupConfigured } from '@/lib/telegramTopics'

const CPD_TABLE = 'Creator Platform Directory'
const PALM_CREATORS_TABLE = 'Palm Creators'

// One-shot handle assignments for slots that were empty in CPD as of the
// initial backfill. Matches user's listed order. CPD record ID → handle.
// Idempotent — if Override is already set, the assignment is skipped.
const HANDLE_ASSIGNMENTS = {
  // Caitie Rosie
  'recWjLIc6Sjk2h3xZ': 'caitierosie.xo',  // Palm IG 1
  'reci9OmxNLFQO3beH': 'urcutecaitie',    // Palm IG 2
  'rec4FgdAvp42DO4mS': 'worldofcaitie',   // Palm IG 3
  // Sunny
  'recd5IqefttoNbBM9': 'sunnnymoons',      // Palm IG 1
  'recYBuSNESaXIG1PM': 'sunnyxmooons',    // Palm IG 2
  'receeklLsGsksSro2': 'itsalwayssunnnyyy', // Palm IG 3
}

// POST /api/admin/sm-requests/backfill-topics
// One-shot backfill for currently managed creators:
//   1. Writes Handle Override + URL + Setup Status=Live for all IG accounts
//      where the creator has Social Media Editing toggled on AND we have a
//      handle (either pre-filled in CPD or provided in HANDLE_ASSIGNMENTS).
//   2. Creates a Telegram forum topic in the SMM master group for any such
//      account that doesn't yet have one, and writes Telegram Topic ID back.
// Idempotent — re-running skips rows that are already complete.
export async function POST() {
  try { await requireAdmin() } catch (e) { return e }

  if (!isSmmGroupConfigured()) {
    return NextResponse.json({ error: 'TELEGRAM_SMM_GROUP_CHAT_ID not set' }, { status: 500 })
  }

  try {
    // Find creators with Social Media Editing on
    const managedCreators = await fetchAirtableRecords(PALM_CREATORS_TABLE, {
      filterByFormula: `{Social Media Editing}=1`,
      fields: ['Creator', 'AKA'],
    })
    const akaById = Object.fromEntries(
      managedCreators.map(r => [r.id, r.fields?.AKA || r.fields?.Creator || ''])
    )
    const managedIds = new Set(managedCreators.map(r => r.id))

    // Pull all managed IG CPD rows
    const allIg = await fetchAirtableRecords(CPD_TABLE, {
      filterByFormula: `AND({Platform}='Instagram',{Managed by Palm}=1,{Status}!='Does Not Exist')`,
      fields: ['Account Name', 'Creator', 'Handle/ Username', 'Handle Override', 'URL', 'Setup Status', 'Telegram Topic ID', 'Status'],
    })
    const rows = allIg.filter(r => (r.fields?.Creator || []).some(id => managedIds.has(id)))

    const results = { processed: [], skipped: [], failed: [] }

    for (const row of rows) {
      const f = row.fields || {}
      const accountName = f['Account Name'] || row.id
      const creatorId = (f.Creator || [])[0]
      const aka = akaById[creatorId] || ''

      // Resolve effective handle: assignment override > existing override > username
      const assigned = HANDLE_ASSIGNMENTS[row.id] || ''
      const existingOverride = (f['Handle Override'] || '').trim().replace(/^@/, '')
      const existingUsername = (f['Handle/ Username'] || '').trim().replace(/^@/, '').replace(/^#ERROR!/, '')
      const handle = assigned || existingOverride || existingUsername
      if (!handle) {
        results.skipped.push({ accountName, reason: 'no handle available' })
        continue
      }

      const updates = {}
      if (existingOverride !== handle) updates['Handle Override'] = handle
      const expectedUrl = `https://instagram.com/${handle}`
      if ((f.URL || '').trim() !== expectedUrl) updates.URL = expectedUrl
      if (f['Setup Status'] !== 'Live') updates['Setup Status'] = 'Live'
      if (f.Status !== 'Active') updates.Status = 'Active'

      try {
        if (Object.keys(updates).length) {
          await patchAirtableRecord(CPD_TABLE, row.id, updates)
        }

        // Create topic if missing
        if (!f['Telegram Topic ID']) {
          const topicId = await createSmmTopicForHandle(handle, { creatorAka: aka })
          if (topicId) {
            await patchAirtableRecord(CPD_TABLE, row.id, { 'Telegram Topic ID': topicId })
          }
          results.processed.push({ accountName, handle, topicId, fieldsUpdated: Object.keys(updates) })
        } else {
          results.processed.push({ accountName, handle, topicId: f['Telegram Topic ID'], fieldsUpdated: Object.keys(updates), topicAlreadyExisted: true })
        }
      } catch (err) {
        results.failed.push({ accountName, error: err.message })
      }
    }

    return NextResponse.json({
      ok: true,
      summary: {
        total: rows.length,
        processed: results.processed.length,
        skipped: results.skipped.length,
        failed: results.failed.length,
      },
      ...results,
    })
  } catch (err) {
    console.error('[backfill-topics] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
