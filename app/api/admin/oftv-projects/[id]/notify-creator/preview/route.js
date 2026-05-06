import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import {
  fetchCreatorContact,
  resolveCreatorChat,
  buildCreatorMessage,
} from '@/lib/oftvCreatorMessaging'
import { STATUSES } from '@/lib/oftvWorkflow'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const PROJECTS_TABLE = 'tbl7DTdRooCsAns7j'

// Dry-run for the manual notify-creator action. Returns:
//   - chat: which chat the message would land in (title, source, status)
//   - text: exact message body that would be sent
//   - inferredEvent: which template was picked
//   - issues: blocking reasons if can't send (no master chat, daemon off,
//             status not in delivery state, etc.)
//
// Powers the confirm modal so admin reviews before clicking Send for real.
export async function GET(_request, { params }) {
  try { await requireAdmin() } catch (e) { return e }

  const { id } = params
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const recRes = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${PROJECTS_TABLE}/${id}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
  )
  if (!recRes.ok) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  const record = await recRes.json()
  const f = record.fields || {}
  const status = f['Status'] || ''
  const revisionCount = f['Revision Count'] || 0
  const creatorOpsId = (f['Creator'] || [])[0]
  const projectName = f['Project Name']

  // Mirror the same event inference the real send uses.
  let inferredEvent = null
  if (status === STATUSES.SENT_TO_CREATOR) {
    inferredEvent = revisionCount > 0 ? 'revised_cut_to_creator' : 'admin_approved'
  } else if (status === STATUSES.APPROVED) {
    inferredEvent = 'admin_approved'
  }

  const issues = []
  if (!inferredEvent) {
    issues.push(`Status "${status}" is not a delivery state. Transition the project to Sent to Creator first.`)
  }
  if (!creatorOpsId) issues.push('Project has no linked creator')

  const contact = creatorOpsId ? await fetchCreatorContact(creatorOpsId) : null
  if (contact && !contact.hqId && !contact.overrideChatRecId) {
    issues.push('Creator has no HQ Record ID — run inbox heartbeat sync')
  }

  const chat = contact ? await resolveCreatorChat(contact) : null
  if (contact && !chat?.chatId) {
    issues.push('No master chat assigned for this creator. Set one in Creators → Communication.')
  }

  // Build the actual text the creator would receive (with the real
  // project link, not a placeholder).
  let text = null
  if (inferredEvent && contact && projectName) {
    text = buildCreatorMessage({
      event: inferredEvent,
      creatorOpsId,
      projectId: id,
      projectName,
      contact,
      isFirstDraft: revisionCount === 0,
    })
  }

  return NextResponse.json({
    ok: issues.length === 0,
    canSend: issues.length === 0 && !!text,
    inferredEvent,
    chat: chat ? {
      title: chat.title,
      source: chat.source,
      status: chat.status,
      isOverride: chat.isOverride,
    } : null,
    creator: contact ? {
      name: contact.name,
      aka: contact.aka,
    } : null,
    text,
    issues,
  })
}
