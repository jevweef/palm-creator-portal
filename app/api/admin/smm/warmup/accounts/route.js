export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import {
  requireAdminOrSocialMedia,
  requireAdmin,
  fetchAirtableRecords,
  createAirtableRecord,
  batchCreateRecords,
} from '@/lib/adminAuth'
import { buildTaskInstantiationPayload } from '@/lib/warmupPlaybook'

const AI_ACCOUNT_PROFILE_TABLE = 'AI Account Profile'
const WARMUP_TASKS_TABLE = 'Warmup Tasks'

// GET — list all AI Account Profiles. Read access for admin + social_media
// (warmup operator role).
export async function GET() {
  try { await requireAdminOrSocialMedia() } catch (e) { return e }

  try {
    const records = await fetchAirtableRecords(AI_ACCOUNT_PROFILE_TABLE, {
      fields: [
        'Persona Name', 'Persona Handle', 'Real Creator',
        'Warmup Status', 'Warmup Start Date', 'Days Paused',
        'Beacons URL', 'FB Profile Slot', 'Pixel Device',
        'Persona Notes', 'Linked Publer Accounts',
      ],
    })

    const accounts = records.map(r => ({
      id: r.id,
      personaName:    r.fields['Persona Name']    || '',
      personaHandle:  r.fields['Persona Handle']  || '',
      realCreatorIds: r.fields['Real Creator']    || [],
      warmupStatus:   r.fields['Warmup Status']   || 'Setup',
      warmupStartDate: r.fields['Warmup Start Date'] || null,
      daysPaused:     r.fields['Days Paused']     || 0,
      beaconsUrl:     r.fields['Beacons URL']     || '',
      fbProfileSlot:  r.fields['FB Profile Slot'] || '',
      pixelDevice:    r.fields['Pixel Device']    || '',
      personaNotes:   r.fields['Persona Notes']   || '',
      publerAccountIds: r.fields['Linked Publer Accounts'] || [],
    }))

    return NextResponse.json({ accounts })
  } catch (err) {
    console.error('[warmup/accounts] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST — create a new AI Account Profile + instantiate all 27 playbook tasks.
// Admin-only (account creation is privileged). Body shape:
//   { personaName, personaHandle, realCreatorId?, pixelDevice?, fbProfileSlot? }
// Returns: { id, taskCount }
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const body = await request.json()
    const personaName = (body.personaName || '').trim()
    const personaHandle = (body.personaHandle || '').trim()
    if (!personaName) {
      return NextResponse.json({ error: 'personaName is required' }, { status: 400 })
    }

    // Create the AI Account Profile in Setup state — Warmup Start Date is set
    // later when the operator clicks "Mark Account Created" on Day 1.
    const profileFields = {
      'Persona Name': personaName,
      'Persona Handle': personaHandle || '',
      'Warmup Status': 'Setup',
      'Days Paused': 0,
    }
    if (body.realCreatorId) profileFields['Real Creator'] = [body.realCreatorId]
    if (body.pixelDevice) profileFields['Pixel Device'] = body.pixelDevice
    if (body.fbProfileSlot) profileFields['FB Profile Slot'] = body.fbProfileSlot
    if (body.beaconsUrl) profileFields['Beacons URL'] = body.beaconsUrl
    if (body.personaNotes) profileFields['Persona Notes'] = body.personaNotes

    const created = await createAirtableRecord(AI_ACCOUNT_PROFILE_TABLE, profileFields, { typecast: true })

    // Instantiate all playbook tasks against the new profile.
    const taskPayloads = buildTaskInstantiationPayload(created.id)
    // batchCreateRecords chunks to Airtable's 10-records-per-request limit.
    await batchCreateRecords(WARMUP_TASKS_TABLE, taskPayloads, { typecast: true })

    return NextResponse.json({
      id: created.id,
      taskCount: taskPayloads.length,
    })
  } catch (err) {
    console.error('[warmup/accounts] POST error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
