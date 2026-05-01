import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { lookupCreatorAka } from '@/lib/oftvTelegram'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const PROJECTS_TABLE = 'tbl7DTdRooCsAns7j'
const PORTAL_BASE = 'https://app.palm-mgmt.com'

// One-shot endpoint to manually re-fire an OFTV Telegram notification.
// Useful for backfilling messages that didn't land because
// EDITOR_LONGFORM_THREAD_ID wasn't set yet.
//
// POST /api/admin/oftv-projects/[id]/resend-notification?threadId=N&event=creator_revision_requested
//
// Pulls current project state from Airtable so the message reflects
// the latest feedback / revision count without needing to pass anything
// in the body. Sends to whatever threadId you specify (no env-var
// dependency).
export async function POST(request, { params }) {
  try { await requireAdmin() } catch (e) { return e }

  const { id } = params
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const { searchParams } = new URL(request.url)
  const threadIdRaw = searchParams.get('threadId')
  const event = searchParams.get('event') || 'creator_revision_requested'
  const chatIdRaw = searchParams.get('chatId') || process.env.EDITOR_CHAT_ID || '-1003779148361'

  const threadId = parseInt(threadIdRaw)
  if (!threadIdRaw || Number.isNaN(threadId)) {
    return NextResponse.json({ error: 'threadId query param required' }, { status: 400 })
  }
  const chatId = parseInt(chatIdRaw)

  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 })
  }

  // Fetch current state so the message reflects what's actually in
  // Airtable right now (latest feedback, revision count, etc.).
  const recRes = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${PROJECTS_TABLE}/${id}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
  )
  if (!recRes.ok) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  const record = await recRes.json()
  const f = record.fields || {}

  const creatorOpsId = (f['Creator'] || [])[0]
  const aka = await lookupCreatorAka(creatorOpsId) || 'Unknown creator'
  const projectName = f['Project Name'] || 'Untitled project'
  const assignedEditor = f['Assigned Editor'] || ''
  const revisionCount = f['Revision Count'] || 0
  const creatorFeedback = f['Creator Feedback'] || ''
  const adminRevisionNotes = f['Admin Revision Notes'] || ''
  const fileCount = f['File Count'] || 0

  const projectQuery = `&project=${id}`
  const editorLink = `${PORTAL_BASE}/editor?tab=oftv${projectQuery}`
  const adminLink = `${PORTAL_BASE}/admin/editor?tab=oftv${projectQuery}`
  const revLabel = revisionCount > 0 ? ` (revision ${revisionCount})` : ''

  // Re-build the same templates as lib/oftvTelegram.js. Kept inline here
  // to avoid coupling — this endpoint is a manual escape hatch, not part
  // of the regular state-machine flow.
  let text
  switch (event) {
    case 'creator_revision_requested':
      text = [
        `✏️ Long-Form: Creator Requested Changes${revLabel}`,
        ``,
        `Creator: ${aka}`,
        `Project: ${projectName}`,
        assignedEditor ? `Editor: ${assignedEditor}` : null,
        ``,
        `Feedback from ${aka}:`,
        creatorFeedback || '(no notes provided)',
        ``,
        editorLink,
      ].filter(Boolean).join('\n')
      break
    case 'admin_revision_requested':
      text = [
        `🔄 Long-Form: Admin Revision Requested${revLabel}`,
        ``,
        `Creator: ${aka}`,
        `Project: ${projectName}`,
        assignedEditor ? `Editor: ${assignedEditor}` : null,
        ``,
        adminRevisionNotes ? `Notes:\n${adminRevisionNotes}` : `(No specific notes — see admin in chat.)`,
        ``,
        editorLink,
      ].filter(Boolean).join('\n')
      break
    case 'final_submitted':
      text = [
        `🎬 Long-Form: New Edit Submitted${revLabel}`,
        ``,
        `Creator: ${aka}`,
        `Project: ${projectName}`,
        assignedEditor ? `Editor: ${assignedEditor}` : null,
        ``,
        `Awaiting admin review.`,
        adminLink,
      ].filter(Boolean).join('\n')
      break
    case 'files_uploaded':
      text = [
        `📁 Long-Form: Files Uploaded`,
        ``,
        `Creator: ${aka}`,
        `Project: ${projectName}`,
        fileCount ? `Files: ${fileCount}` : null,
        ``,
        `Ready for editing.`,
        editorLink,
      ].filter(Boolean).join('\n')
      break
    case 'revised_cut_to_creator':
      text = [
        `🔁 Long-Form: Revised Cut Sent to Creator${revLabel}`,
        ``,
        `Creator: ${aka}`,
        `Project: ${projectName}`,
        assignedEditor ? `Editor: ${assignedEditor}` : null,
        ``,
        `Editor addressed ${aka}'s feedback. Sent directly back to her — no admin gate.`,
      ].filter(Boolean).join('\n')
      break
    default:
      return NextResponse.json({ error: `Unsupported event: ${event}` }, { status: 400 })
  }

  const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_thread_id: threadId,
      text,
      disable_web_page_preview: false,
    }),
  })
  const tgData = await tgRes.json()
  if (!tgData.ok) {
    return NextResponse.json({
      ok: false,
      error: 'Telegram sendMessage failed',
      detail: tgData.description,
      attempted: { chat_id: chatId, message_thread_id: threadId, textPreview: text.slice(0, 200) },
    }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    sentTo: { chat_id: chatId, message_thread_id: threadId },
    event,
    messageId: tgData.result?.message_id,
  })
}

export async function GET(request, ctx) { return POST(request, ctx) }
