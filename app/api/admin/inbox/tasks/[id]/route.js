// Update a single task — primarily Status (Done / Snoozed / Dismissed)
// and Notes. Owner can also be reassigned if the AI got it wrong.

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireInboxOwner, patchAirtableRecord } from '@/lib/adminAuth'

const TASKS_TABLE = 'Inbox Tasks'

const VALID_STATUSES = new Set(['Open', 'Done', 'Snoozed', 'Dismissed'])
const VALID_OWNERS = new Set(['Evan', 'Josh', 'Other'])

export async function PATCH(request, { params }) {
  const auth = await requireInboxOwner()
  if (auth instanceof NextResponse) return auth

  const { id } = params
  if (!id || !id.startsWith('rec')) {
    return NextResponse.json({ error: 'invalid record id' }, { status: 400 })
  }

  let body
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const updates = {}
  if (body.status !== undefined) {
    if (!VALID_STATUSES.has(body.status)) {
      return NextResponse.json({ error: `bad status: ${body.status}` }, { status: 400 })
    }
    updates.Status = body.status
  }
  if (body.owner !== undefined) {
    if (!VALID_OWNERS.has(body.owner)) {
      return NextResponse.json({ error: `bad owner: ${body.owner}` }, { status: 400 })
    }
    updates.Owner = body.owner
  }
  if (body.notes !== undefined) updates.Notes = String(body.notes).slice(0, 5000)
  if (body.task !== undefined) updates.Task = String(body.task).slice(0, 200)

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  try {
    const updated = await patchAirtableRecord(TASKS_TABLE, id, updates)
    return NextResponse.json({ ok: true, record: updated })
  } catch (err) {
    console.error('[inbox/tasks/:id] patch error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
