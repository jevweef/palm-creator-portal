export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import {
  requireAdmin,
  fetchAirtableRecords,
  patchAirtableRecord,
  createAirtableRecord,
} from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'
import { listAccounts } from '@/lib/publer'

// POST /api/admin/publer/sync-accounts
//
// Diff-update the `Publer Accounts` Airtable table from Publer's live /accounts
// endpoint. Insert new rows, update existing ones (name/picture/Last Synced).
// NEVER delete — preserve history so an account that gets disconnected in
// Publer doesn't lose its Creator/Account Type/consent linkage. If the
// operator wants to retire an account they set Status='Disabled' manually.
//
// First-time call uses typecast:true so Airtable auto-creates the table's
// singleSelect options (Channel, Account Type, Status). The Publer Accounts
// table itself MUST exist before calling — the Airtable REST API doesn't
// expose CREATE TABLE. Phase 0 of the rollout includes the table-create step.
//
// Field mapping (Publer → Airtable):
//   provider 'instagram' / 'facebook'  →  Channel 'IG' / 'FB'
//   id (Publer's UUID)                 →  Publer Account ID
//   name                               →  Account Name
//   picture                            →  Publer Picture (URL)
//   type ('professional' etc)          →  (info only, surfaced in raw cache)
//
// Note: Creator + Account Type + AI Consent on File are NEVER touched by sync —
// those are operator-set via the mapping UI. Sync only refreshes the
// Publer-side metadata.
export async function POST() {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const publerRes = await listAccounts()
    // Publer's response shape: top-level array OR { data: [...] } — defensive.
    const publerAccounts = Array.isArray(publerRes)
      ? publerRes
      : (Array.isArray(publerRes?.data) ? publerRes.data : (Array.isArray(publerRes?.accounts) ? publerRes.accounts : []))

    if (!publerAccounts.length) {
      return NextResponse.json({
        ok: true,
        synced: 0,
        message: 'Publer returned zero accounts — check that the workspace has any connected accounts and the API key has access',
        raw: publerRes,
      })
    }

    // Pull existing Publer Accounts rows so we know which to UPDATE vs CREATE.
    // Filter by Publer Account ID; new accounts get inserted.
    const existing = await fetchAirtableRecords('Publer Accounts', {
      fields: ['Publer Account ID', 'Account Name', 'Channel', 'Status', 'Publer Picture', 'Publer Provider'],
    }).catch(err => {
      // If the table doesn't exist yet, surface a clear error instead of a
      // mysterious 404 — Phase 0 requires creating this table manually.
      if (err.message?.includes('NOT_FOUND') || err.message?.includes('404')) {
        const e = new Error('Airtable table "Publer Accounts" not found. Create it per scoping doc §3.1.2 before syncing.')
        e.status = 412
        throw e
      }
      throw err
    })
    const byPublerId = new Map()
    for (const r of existing) {
      const pid = r.fields?.['Publer Account ID']
      if (pid) byPublerId.set(pid, r)
    }

    const now = new Date().toISOString()
    const created = []
    const updated = []
    const skipped = []

    for (const pa of publerAccounts) {
      const pid = pa.id || pa._id || pa.account_id
      if (!pid) { skipped.push({ reason: 'no id in publer record', record: pa }); continue }

      const provider = (pa.provider || pa.network || '').toLowerCase()
      const channel = provider.startsWith('instagram') ? 'IG'
        : provider.startsWith('facebook') ? 'FB'
        : null

      const fields = {
        'Publer Account ID': pid,
        'Account Name': pa.name || pa.username || pa.handle || '(unnamed)',
        'Publer Provider': provider || '',
        'Publer Picture': pa.picture || pa.avatar || '',
        'Last Synced': now,
        // Default new rows to Active. Sync NEVER overwrites Status on existing
        // rows — admin's 'Disabled' / 'Reauth Required' choices must stick.
      }
      if (channel) fields['Channel'] = channel

      const existingRec = byPublerId.get(pid)
      if (existingRec) {
        // Update — but don't clobber Status, Account Type, Creator, or AI
        // Consent on File. Sync just refreshes the Publer-side metadata.
        const updateFields = {
          'Account Name': fields['Account Name'],
          'Publer Provider': fields['Publer Provider'],
          'Publer Picture': fields['Publer Picture'],
          'Last Synced': now,
        }
        if (channel && existingRec.fields?.Channel !== channel) {
          updateFields['Channel'] = channel
        }
        try {
          await patchAirtableRecord('Publer Accounts', existingRec.id, updateFields, { typecast: true })
          updated.push({ id: existingRec.id, publerId: pid, name: fields['Account Name'] })
        } catch (e) {
          skipped.push({ publerId: pid, reason: `patch failed: ${e.message}` })
        }
      } else {
        // Insert — default Status=Active. typecast:true so singleSelects auto-create.
        try {
          const inserted = await createAirtableRecord('Publer Accounts', {
            ...fields,
            'Status': 'Active',
            'Connected At': now,
          }, { typecast: true })
          created.push({ id: inserted.id, publerId: pid, name: fields['Account Name'] })
        } catch (e) {
          skipped.push({ publerId: pid, reason: `create failed: ${e.message}` })
        }
      }
    }

    return NextResponse.json({
      ok: true,
      synced: created.length + updated.length,
      created,
      updated,
      skipped,
      publerCount: publerAccounts.length,
    })
  } catch (err) {
    console.error('[admin/publer/sync-accounts] error:', err)
    return NextResponse.json(
      { error: err.message, publerStatus: err.status || null },
      { status: err.status && err.status < 500 ? err.status : 500 }
    )
  }
}
