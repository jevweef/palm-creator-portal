import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { notifyCreatorByMessage } from '@/lib/oftvCreatorMessaging'
import { STATUSES } from '@/lib/oftvWorkflow'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const PROJECTS_TABLE = 'tbl7DTdRooCsAns7j'

// Manual fire of the creator iMessage. Same helper that auto-runs on
// state transitions, but you can trigger it any time (resending, project
// you forgot to notify on, etc.). Picks the right event template based
// on current status — admin doesn't have to know which one to send.
//
// Body (optional): { event: 'admin_approved' | 'revised_cut_to_creator' }
// If omitted, infers from status:
//   - Sent to Creator + Revision Count = 0 → admin_approved (first cut)
//   - Sent to Creator + Revision Count > 0 → revised_cut_to_creator
//   - Anything else → 400 (use auto-trigger instead)
export async function POST(request, { params }) {
  try { await requireAdmin() } catch (e) { return e }

  const { id } = params
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  let body = {}
  try { body = await request.json() } catch {}

  const recRes = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${PROJECTS_TABLE}/${id}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
  )
  if (!recRes.ok) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  const record = await recRes.json()
  const f = record.fields || {}
  const status = f['Status'] || ''
  const revisionCount = f['Revision Count'] || 0

  // Infer event if caller didn't specify.
  let event = body.event
  if (!event) {
    if (status === STATUSES.SENT_TO_CREATOR) {
      event = revisionCount > 0 ? 'revised_cut_to_creator' : 'admin_approved'
    } else if (status === STATUSES.APPROVED) {
      // Already approved — let admin still send a "thanks for approving" or
      // a re-poke message if they want. Default to admin_approved-style copy.
      event = 'admin_approved'
    } else {
      return NextResponse.json({
        error: `Status "${status}" is not a delivery state. Notify-creator only fires for projects sent to / approved by creator. Use auto-trigger by transitioning the project state instead.`,
      }, { status: 400 })
    }
  }

  const result = await notifyCreatorByMessage({
    event,
    creatorOpsId: (f['Creator'] || [])[0],
    projectId: id,
    projectName: f['Project Name'],
    isFirstDraft: revisionCount === 0,
  })

  return NextResponse.json({
    ok: !result.error,
    inferredEvent: event,
    result,
  })
}
