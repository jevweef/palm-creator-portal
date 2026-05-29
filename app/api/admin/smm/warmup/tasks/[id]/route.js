export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import {
  requireAdminOrSocialMedia,
  requireAdmin,
  fetchAirtableRecords,
  patchAirtableRecord,
} from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'

const WARMUP_TASKS_TABLE = 'Warmup Tasks'

// PATCH — task state transition. Body accepts:
//   { status: 'Done'|'Skipped'|'Blocked'|'Awaiting Approval'|'Pending',
//     notes?: string,
//     ownerApproved?: true }   // admin-only; sets Owner Approved + timestamp
//
// Guards:
//  - "Done" rejected if Requires Owner Approval AND NOT Owner Approved.
//  - "Done" rejected if Prerequisite Task Key is set AND that task is not Done.
//  - "ownerApproved=true" requires admin role (not social_media).
export async function PATCH(request, { params }) {
  try { await requireAdminOrSocialMedia() } catch (e) { return e }

  try {
    const { id } = params
    if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
      return NextResponse.json({ error: 'Invalid task id' }, { status: 400 })
    }
    const body = await request.json()

    const fetched = await fetchAirtableRecords(WARMUP_TASKS_TABLE, {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(id)}`,
      fields: [
        'Task Title', 'Status', 'Requires Owner Approval', 'Owner Approved',
        'Prerequisite Task Key', 'Account',
      ],
    })
    if (!fetched.length) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    const task = fetched[0]
    const tFields = task.fields

    const update = {}

    // Owner approval — admin role only.
    if (body.ownerApproved === true) {
      try { await requireAdmin() } catch (e) { return e }
      update['Owner Approved'] = true
      update['Owner Approved At'] = new Date().toISOString()
    }

    // Notes.
    if (typeof body.notes === 'string') update['Notes'] = body.notes

    // Status transition.
    if (body.status) {
      const wantStatus = body.status
      const validStatuses = ['Pending', 'Done', 'Skipped', 'Blocked', 'Awaiting Approval']
      if (!validStatuses.includes(wantStatus)) {
        return NextResponse.json({ error: 'Invalid status', validStatuses }, { status: 400 })
      }

      if (wantStatus === 'Done') {
        // Owner-approval gate — Day-45 OF CTA and any other gated task.
        const approvedAfterPatch = body.ownerApproved === true || !!tFields['Owner Approved']
        if (tFields['Requires Owner Approval'] && !approvedAfterPatch) {
          return NextResponse.json({
            error: 'OWNER_APPROVAL_REQUIRED',
            message: 'This task requires owner approval before it can be marked Done.',
          }, { status: 409 })
        }
        // Prerequisite chain.
        const prereqKey = tFields['Prerequisite Task Key']
        if (prereqKey) {
          const accountId = (tFields['Account'] || [])[0]
          if (accountId) {
            const prereqRows = await fetchAirtableRecords(WARMUP_TASKS_TABLE, {
              filterByFormula: `AND({Task Key} = ${quoteAirtableString(prereqKey)}, FIND(${quoteAirtableString(accountId)}, ARRAYJOIN({Account})))`,
              fields: ['Status', 'Task Title'],
            })
            const prereq = prereqRows[0]
            if (!prereq || prereq.fields['Status'] !== 'Done') {
              return NextResponse.json({
                error: 'PREREQUISITE_NOT_DONE',
                message: `Cannot complete: prerequisite "${prereq?.fields['Task Title'] || prereqKey}" is not Done yet.`,
                prerequisiteTaskKey: prereqKey,
                prerequisiteStatus: prereq?.fields['Status'] || 'missing',
              }, { status: 409 })
            }
          }
        }
        update['Status'] = 'Done'
        update['Completed At'] = new Date().toISOString()
        try {
          const { userId } = auth()
          if (userId) {
            const user = await currentUser()
            const displayName = user?.firstName || user?.username || user?.primaryEmailAddress?.emailAddress || userId
            update['Completed By'] = displayName
          }
        } catch (e) {
          // Best-effort attribution; do not block the status change.
        }
      } else {
        update['Status'] = wantStatus
        if (wantStatus === 'Skipped') {
          update['Completed At'] = new Date().toISOString()
          try {
            const { userId } = auth()
            if (userId) {
              const user = await currentUser()
              const displayName = user?.firstName || user?.username || user?.primaryEmailAddress?.emailAddress || userId
              update['Completed By'] = displayName
            }
          } catch {}
        }
      }
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const patched = await patchAirtableRecord(WARMUP_TASKS_TABLE, id, update, { typecast: true })
    return NextResponse.json({ id: patched.id, fields: patched.fields })
  } catch (err) {
    console.error('[warmup/tasks/[id]] PATCH error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
