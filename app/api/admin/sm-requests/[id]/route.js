export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdminOrSocialMedia, patchAirtableRecord } from '@/lib/adminAuth'

const SM_SETUP_REQUESTS_TABLE = 'SM Setup Requests'

// PATCH /api/admin/sm-requests/:id
// Updates slot candidates, handles (without marking done), notes, or status.
// Writable fields: slotNCandidates (string), slotNHandle (string), notes, status.
export async function PATCH(request, { params }) {
  try { await requireAdminOrSocialMedia() } catch (e) { return e }

  try {
    const body = await request.json()
    const fields = {}

    for (const n of [1, 2, 3]) {
      if (typeof body[`slot${n}Candidates`] === 'string') fields[`Slot ${n} Username Candidates`] = body[`slot${n}Candidates`]
      if (typeof body[`slot${n}Handle`] === 'string') fields[`Slot ${n} Handle`] = body[`slot${n}Handle`]
    }
    if (typeof body.notes === 'string') fields.Notes = body.notes
    if (typeof body.status === 'string') fields.Status = body.status

    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: 'No writable fields in body' }, { status: 400 })
    }

    const updated = await patchAirtableRecord(SM_SETUP_REQUESTS_TABLE, params.id, fields)
    return NextResponse.json({ ok: true, id: updated.id })
  } catch (err) {
    console.error('[sm-requests PATCH] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
