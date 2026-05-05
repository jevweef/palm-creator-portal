// Update a single task — Status (Done / Snoozed / Dismissed), Notes,
// snooze defer, and feedback (when dismissing with a reason — feeds the
// extract-tasks training loop).

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireInboxOwner, patchAirtableRecord } from '@/lib/adminAuth'

const TASKS_TABLE = 'Inbox Tasks'

const VALID_STATUSES = new Set(['Open', 'Done', 'Snoozed', 'Dismissed'])
const VALID_OWNERS = new Set(['Evan', 'Josh', 'Other'])
const VALID_FEEDBACK = new Set([
  'Not a real task',
  'Wrong person',
  'Wrong urgency',
  'Already done',
  'Personal not business',
  'Misread conversation',
  'Other',
])

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

  // Snooze: client sends snoozeHours (1, 24, 72, 168 etc) — convert to
  // Defer Until ISO. Also flips status to Snoozed if not already specified.
  if (body.snoozeHours !== undefined) {
    const hours = Number(body.snoozeHours)
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 30) {
      return NextResponse.json({ error: 'bad snoozeHours' }, { status: 400 })
    }
    updates['Defer Until'] = new Date(Date.now() + hours * 3600 * 1000).toISOString()
    if (!updates.Status) updates.Status = 'Snoozed'
  }

  // Feedback (typically sent alongside status='Dismissed'). Both fields
  // are optional individually but at least one type/reason is expected
  // when training the loop.
  if (body.feedbackType !== undefined) {
    if (body.feedbackType && !VALID_FEEDBACK.has(body.feedbackType)) {
      return NextResponse.json({ error: `bad feedbackType: ${body.feedbackType}` }, { status: 400 })
    }
    updates['Feedback Type'] = body.feedbackType || null
  }
  if (body.feedbackReason !== undefined) {
    updates['Feedback Reason'] = String(body.feedbackReason || '').slice(0, 1000)
  }

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
