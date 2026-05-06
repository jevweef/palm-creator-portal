import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import {
  fetchCreatorContact,
  resolveCreatorChat,
  buildCreatorMessage,
} from '@/lib/oftvCreatorMessaging'
import { isDaemonConfigured, daemonHealth } from '@/lib/inboxDaemon'
import { STATUSES } from '@/lib/oftvWorkflow'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const PROJECTS_TABLE = 'tbl7DTdRooCsAns7j'

// Diagnostic: run the full notify-creator pipeline, but return EVERY
// intermediate signal instead of a single sent/skipped boolean. Used
// when "I clicked Notify and nothing landed" needs root-causing.
//
// Returns:
//   - daemon: { configured, reachable, health }
//   - project: { id, name, status, revisionCount }
//   - contact: creator AKA + comm name + hq id + override
//   - resolvedChat: which chat the helper picked
//   - inferredEvent + messageText: what would actually go out
//   - daemonAttempt: result of the actual POST to the daemon /send
//
// If it returns sent:true, the daemon accepted the message. If your
// iMessage doesn't show it, the issue is downstream (group chat ID
// format the daemon can't resolve, AppleScript permissions, etc.).
export async function GET(_request, { params }) {
  try { await requireAdmin() } catch (e) { return e }

  const { id } = params
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  // Daemon health first — answers "is the Mac reachable at all"
  const daemonConfigured = isDaemonConfigured()
  const health = daemonConfigured ? await daemonHealth() : { configured: false }

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

  // Walk the same path notifyCreatorByMessage walks
  const contact = creatorOpsId ? await fetchCreatorContact(creatorOpsId) : null
  const chat = contact ? await resolveCreatorChat(contact) : null

  let inferredEvent = null
  if (status === STATUSES.SENT_TO_CREATOR) {
    inferredEvent = revisionCount > 0 ? 'revised_cut_to_creator' : 'admin_approved'
  } else if (status === STATUSES.APPROVED) {
    inferredEvent = 'admin_approved'
  }

  const text = (inferredEvent && contact && projectName)
    ? buildCreatorMessage({
        event: inferredEvent,
        creatorOpsId,
        projectId: id,
        projectName,
        contact,
        isFirstDraft: revisionCount === 0,
      })
    : null

  // Actually attempt the daemon send so we see the raw response. Doesn't
  // re-fire if daemon isn't reachable — same gate as the production helper.
  let daemonAttempt = null
  if (daemonConfigured && health.reachable && chat?.chatId && text) {
    try {
      const base = process.env.DAEMON_URL.replace(/\/$/, '')
      const res = await fetch(`${base}/send`, {
        method: 'POST',
        headers: {
          'X-Daemon-Secret': process.env.DAEMON_SECRET || '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ chatId: chat.chatId, text }),
      })
      const body = await res.text()
      let parsed
      try { parsed = JSON.parse(body) } catch { parsed = body }
      daemonAttempt = { httpStatus: res.status, response: parsed }
    } catch (err) {
      daemonAttempt = { error: err.message }
    }
  }

  return NextResponse.json({
    ok: true,
    daemon: {
      configured: daemonConfigured,
      reachable: !!health.reachable,
      health,
    },
    project: {
      id,
      name: projectName,
      status,
      revisionCount,
    },
    contact: contact ? {
      aka: contact.aka,
      communicationName: contact.name,
      hqId: contact.hqId,
      hasOverride: !!contact.overrideChatRecId,
    } : null,
    resolvedChat: chat ? {
      title: chat.title,
      chatId: chat.chatId,
      source: chat.source,
      status: chat.status,
      isOverride: chat.isOverride,
    } : null,
    inferredEvent,
    messageText: text,
    daemonAttempt,
  })
}
