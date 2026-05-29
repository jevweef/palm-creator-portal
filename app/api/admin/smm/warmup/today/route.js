export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdminOrSocialMedia, fetchAirtableRecords } from '@/lib/adminAuth'
import { computeCurrentDay } from '@/lib/warmupPlaybook'

const AI_ACCOUNT_PROFILE_TABLE = 'AI Account Profile'
const WARMUP_TASKS_TABLE = 'Warmup Tasks'

// GET — Today's view across all active warmup accounts.
//
// Returns one card per account in Warming Up status, with:
//   - profile basics (name, handle, current day)
//   - tasks that are DUE (Day <= currentDay) AND not yet Done/Skipped
//   - any blocked tasks (prerequisite not yet Done)
//   - any tasks awaiting owner approval
//
// Setup-state accounts get a card too (their Day-0 tasks are immediately due).
export async function GET() {
  try { await requireAdminOrSocialMedia() } catch (e) { return e }

  try {
    const accountRecords = await fetchAirtableRecords(AI_ACCOUNT_PROFILE_TABLE, {
      filterByFormula: "OR({Warmup Status}='Setup',{Warmup Status}='Warming Up')",
      fields: [
        'Persona Name', 'Persona Handle', 'Real Creator',
        'Warmup Status', 'Warmup Start Date', 'Days Paused',
      ],
    })

    if (!accountRecords.length) {
      return NextResponse.json({ accounts: [], asOf: new Date().toISOString() })
    }

    // Fetch all tasks belonging to these accounts.
    const accountIds = accountRecords.map(r => r.id)
    const taskRecords = await fetchAirtableRecords(WARMUP_TASKS_TABLE, {
      filterByFormula: "OR(" + accountIds.map(id => `FIND('${id}', ARRAYJOIN({Account}))`).join(',') + ")",
      fields: [
        'Task Title', 'Day', 'Phase', 'Task Key', 'Description',
        'Required', 'Status', 'Requires Owner Approval', 'Owner Approved',
        'Prerequisite Task Key', 'Account',
      ],
    })

    // Group tasks by account.
    const tasksByAccount = {}
    for (const t of taskRecords) {
      const aid = (t.fields['Account'] || [])[0]
      if (!aid) continue
      ;(tasksByAccount[aid] ||= []).push(t)
    }

    const accounts = accountRecords.map(a => {
      const f = a.fields
      const currentDay = computeCurrentDay({
        warmupStartDate: f['Warmup Start Date'],
        daysPaused: f['Days Paused'],
      })

      const myTasks = tasksByAccount[a.id] || []
      const taskKeyToStatus = Object.fromEntries(
        myTasks.map(t => [t.fields['Task Key'], t.fields['Status']])
      )

      const todayCutoff = currentDay ?? 0
      const due = myTasks
        .filter(t => (t.fields['Day'] ?? 0) <= todayCutoff)
        .filter(t => !['Done', 'Skipped'].includes(t.fields['Status']))
        .map(t => {
          const prereqKey = t.fields['Prerequisite Task Key'] || ''
          const prereqStatus = prereqKey ? taskKeyToStatus[prereqKey] : null
          const blockedByPrereq = prereqKey && prereqStatus !== 'Done'
          const blockedByApproval = t.fields['Requires Owner Approval'] && !t.fields['Owner Approved']
          return {
            id: t.id,
            title: t.fields['Task Title']       || '',
            day:   t.fields['Day']              ?? 0,
            phase: t.fields['Phase']            || '',
            key:   t.fields['Task Key']         || '',
            status: t.fields['Status']          || 'Pending',
            required: !!t.fields['Required'],
            requiresOwnerApproval: !!t.fields['Requires Owner Approval'],
            ownerApproved: !!t.fields['Owner Approved'],
            prerequisiteTaskKey: prereqKey,
            blockedByPrereq,
            blockedByApproval,
            actionable: !blockedByPrereq && !blockedByApproval,
          }
        })
        .sort((x, y) => x.day - y.day || x.key.localeCompare(y.key))

      return {
        id: a.id,
        personaName:   f['Persona Name']   || '',
        personaHandle: f['Persona Handle'] || '',
        realCreatorIds: f['Real Creator']  || [],
        warmupStatus:  f['Warmup Status']  || 'Setup',
        currentDay,
        dueTasks: due,
        actionableCount: due.filter(d => d.actionable).length,
        blockedCount: due.filter(d => !d.actionable).length,
      }
    })

    return NextResponse.json({ accounts, asOf: new Date().toISOString() })
  } catch (err) {
    console.error('[warmup/today] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
