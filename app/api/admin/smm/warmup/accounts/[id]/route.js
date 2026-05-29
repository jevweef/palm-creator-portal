export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import {
  requireAdminOrSocialMedia,
  requireAdmin,
  fetchAirtableRecords,
  patchAirtableRecord,
} from '@/lib/adminAuth'
import { computeCurrentDay } from '@/lib/warmupPlaybook'
import { quoteAirtableString } from '@/lib/airtableFormula'

const AI_ACCOUNT_PROFILE_TABLE = 'AI Account Profile'
const WARMUP_TASKS_TABLE = 'Warmup Tasks'

// GET — per-account view. Returns the profile + all tasks (sorted by Day asc).
export async function GET(_request, { params }) {
  try { await requireAdminOrSocialMedia() } catch (e) { return e }

  try {
    const { id } = params
    if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
      return NextResponse.json({ error: 'Invalid account id' }, { status: 400 })
    }

    const [profileRecords, taskRecords] = await Promise.all([
      fetchAirtableRecords(AI_ACCOUNT_PROFILE_TABLE, {
        filterByFormula: `RECORD_ID() = ${quoteAirtableString(id)}`,
        fields: [
          'Persona Name', 'Persona Handle', 'Real Creator',
          'Warmup Status', 'Warmup Start Date', 'Days Paused',
          'Beacons URL', 'FB Profile Slot', 'Pixel Device',
          'IG Vault Item ID', 'FB Vault Item ID', 'Gmail Vault Item ID',
          'Recovery Codes Vault Item ID',
          'Persona Notes', 'Linked Publer Accounts',
        ],
      }),
      fetchAirtableRecords(WARMUP_TASKS_TABLE, {
        filterByFormula: `FIND(${quoteAirtableString(id)}, ARRAYJOIN({Account}))`,
        fields: [
          'Task Title', 'Day', 'Phase', 'Task Key', 'Description',
          'Required', 'Status', 'Requires Owner Approval', 'Owner Approved',
          'Owner Approved At', 'Prerequisite Task Key',
          'Completed By', 'Completed At', 'Notes', 'Template Version',
        ],
      }),
    ])

    if (!profileRecords.length) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    const f = profileRecords[0].fields
    const profile = {
      id: profileRecords[0].id,
      personaName:    f['Persona Name']    || '',
      personaHandle:  f['Persona Handle']  || '',
      realCreatorIds: f['Real Creator']    || [],
      warmupStatus:   f['Warmup Status']   || 'Setup',
      warmupStartDate: f['Warmup Start Date'] || null,
      daysPaused:     f['Days Paused']     || 0,
      beaconsUrl:     f['Beacons URL']     || '',
      fbProfileSlot:  f['FB Profile Slot'] || '',
      pixelDevice:    f['Pixel Device']    || '',
      personaNotes:   f['Persona Notes']   || '',
      vaultRefs: {
        ig:       f['IG Vault Item ID']    || '',
        fb:       f['FB Vault Item ID']    || '',
        gmail:    f['Gmail Vault Item ID'] || '',
        recovery: f['Recovery Codes Vault Item ID'] || '',
      },
      publerAccountIds: f['Linked Publer Accounts'] || [],
    }

    const currentDay = computeCurrentDay({
      warmupStartDate: profile.warmupStartDate,
      daysPaused: profile.daysPaused,
    })

    const tasks = taskRecords
      .map(r => ({
        id: r.id,
        title:    r.fields['Task Title']         || '',
        day:      r.fields['Day']                ?? 0,
        phase:    r.fields['Phase']              || '',
        key:      r.fields['Task Key']           || '',
        description: r.fields['Description']     || '',
        required: !!r.fields['Required'],
        status:   r.fields['Status']             || 'Pending',
        requiresOwnerApproval: !!r.fields['Requires Owner Approval'],
        ownerApproved: !!r.fields['Owner Approved'],
        ownerApprovedAt: r.fields['Owner Approved At'] || null,
        prerequisiteTaskKey: r.fields['Prerequisite Task Key'] || '',
        completedBy: r.fields['Completed By']    || '',
        completedAt: r.fields['Completed At']    || null,
        notes:    r.fields['Notes']              || '',
        templateVersion: r.fields['Template Version'] ?? null,
      }))
      .sort((a, b) => (a.day - b.day) || a.key.localeCompare(b.key))

    return NextResponse.json({ profile, currentDay, tasks })
  } catch (err) {
    console.error('[warmup/accounts/[id]] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH — update profile fields (Warmup Status, vault refs, Beacons URL, notes,
// Days Paused, pixel device, FB profile slot). Admin-only.
//
// Special: when Warmup Status transitions Setup → Warming Up, sets
// Warmup Start Date to today (if not already set). This is the "Mark Account
// Created" affordance.
export async function PATCH(request, { params }) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { id } = params
    if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
      return NextResponse.json({ error: 'Invalid account id' }, { status: 400 })
    }

    const body = await request.json()
    const fields = {}

    // Mark Account Created — transition Setup → Warming Up + stamp today.
    if (body.markAccountCreated) {
      fields['Warmup Status'] = 'Warming Up'
      fields['Warmup Start Date'] = new Date().toISOString().slice(0, 10)
    }

    const FIELD_MAP = {
      warmupStatus:    'Warmup Status',
      warmupStartDate: 'Warmup Start Date',
      daysPaused:      'Days Paused',
      beaconsUrl:      'Beacons URL',
      fbProfileSlot:   'FB Profile Slot',
      pixelDevice:     'Pixel Device',
      personaName:     'Persona Name',
      personaHandle:   'Persona Handle',
      personaNotes:    'Persona Notes',
      igVaultItemId:       'IG Vault Item ID',
      fbVaultItemId:       'FB Vault Item ID',
      gmailVaultItemId:    'Gmail Vault Item ID',
      recoveryVaultItemId: 'Recovery Codes Vault Item ID',
    }
    for (const [k, atName] of Object.entries(FIELD_MAP)) {
      if (Object.prototype.hasOwnProperty.call(body, k)) {
        fields[atName] = body[k]
      }
    }

    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const patched = await patchAirtableRecord(AI_ACCOUNT_PROFILE_TABLE, id, fields, { typecast: true })
    return NextResponse.json({ id: patched.id, fields: patched.fields })
  } catch (err) {
    console.error('[warmup/accounts/[id]] PATCH error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
