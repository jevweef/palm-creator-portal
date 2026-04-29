// Update a single chat's Status (Watch / Ignore / Ignore Forever / Pending Review).
// Used by the [Watch] [Ignore] [Ignore Forever] buttons on /admin/inbox.

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin, patchAirtableRecord } from '@/lib/adminAuth'

const CHATS_TABLE = 'Telegram Chats'

const VALID_STATUSES = new Set([
  'Pending Review',
  'Watching',
  'Ignored',
  'Ignored Forever',
])

export async function PATCH(request, { params }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const { id } = params
  if (!id || !id.startsWith('rec')) {
    return NextResponse.json({ error: 'invalid record id' }, { status: 400 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const updates = {}
  if (body.status !== undefined) {
    if (!VALID_STATUSES.has(body.status)) {
      return NextResponse.json(
        { error: `status must be one of: ${[...VALID_STATUSES].join(', ')}` },
        { status: 400 }
      )
    }
    updates.Status = body.status
  }
  if (body.notes !== undefined) {
    updates.Notes = String(body.notes).slice(0, 5000)
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'no updatable fields provided' }, { status: 400 })
  }

  try {
    const updated = await patchAirtableRecord(CHATS_TABLE, id, updates)
    return NextResponse.json({ ok: true, record: updated })
  } catch (err) {
    console.error('[inbox/chats/:id] patch error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
