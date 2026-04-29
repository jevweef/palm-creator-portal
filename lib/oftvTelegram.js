/**
 * Telegram notifications for the OFTV / Long-Form workflow.
 *
 * Sends to the Palm editing team's Telegram group (same chat ID as the
 * social-media revision flow) but on a SEPARATE forum topic dedicated to
 * long-form work — set `EDITOR_LONGFORM_THREAD_ID` in env to that topic's
 * thread id, otherwise this helper silently no-ops (won't crash the
 * workflow if Telegram isn't configured).
 *
 * Every message includes creator AKA + project name in the header so the
 * editor knows immediately who/what each ping is about without clicking
 * through to the portal.
 *
 * Single entry point: notifyOftv({ event, ... }). Event types map 1:1 to
 * state transitions. The shape was kept dumb on purpose — easier to grep
 * for "where did this notification come from" than chase abstractions.
 */

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN
// Same group as social media revisions, different topic. Defaults to the
// production Palm editing team group; thread_id must be configured.
const EDITOR_CHAT_ID = parseInt(process.env.EDITOR_CHAT_ID || '-1003779148361')
const LONGFORM_THREAD_ID = process.env.EDITOR_LONGFORM_THREAD_ID
  ? parseInt(process.env.EDITOR_LONGFORM_THREAD_ID)
  : null

const PORTAL_BASE = 'https://app.palm-mgmt.com'

function isConfigured() {
  return !!TELEGRAM_TOKEN && !!LONGFORM_THREAD_ID
}

async function sendMessage(text) {
  if (!isConfigured()) {
    console.warn('[oftv-telegram] Skipping — TELEGRAM_BOT_TOKEN or EDITOR_LONGFORM_THREAD_ID not set')
    return
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: EDITOR_CHAT_ID,
        message_thread_id: LONGFORM_THREAD_ID,
        text,
        // No HTML/Markdown — user feedback can contain arbitrary text and
        // we don't want a stray underscore to break the whole message.
        disable_web_page_preview: false,
      }),
    })
    const data = await res.json()
    if (!data.ok) {
      console.warn('[oftv-telegram] sendMessage failed:', data.description)
    }
  } catch (err) {
    console.warn('[oftv-telegram] error:', err.message)
  }
}

/**
 * Notify the long-form editing team about an OFTV workflow event.
 *
 * @param {Object} args
 * @param {string} args.event              — one of: files_uploaded, final_submitted,
 *                                           admin_approved, admin_revision_requested,
 *                                           creator_approved, creator_revision_requested
 * @param {string} args.creator            — creator AKA / display name
 * @param {string} args.projectName        — OFTV project title
 * @param {string} [args.projectId]        — Airtable record id (used for deep-link)
 * @param {string} [args.notes]            — admin or creator notes (when relevant)
 * @param {number} [args.fileCount]        — how many files (for files_uploaded)
 * @param {number} [args.revisionCount]    — current revision iteration
 * @param {string} [args.assignedEditor]   — editor name if known
 */
export async function notifyOftv(args) {
  const text = formatMessage(args)
  if (!text) return
  await sendMessage(text)
}

function formatMessage({ event, creator, projectName, projectId, notes, fileCount, revisionCount, assignedEditor }) {
  const safeCreator = creator || 'Unknown creator'
  const safeProject = projectName || 'Untitled project'
  // Deep-link directly into the project so the editor / admin doesn't have
  // to scroll the queue to find it. The editor page is the right surface
  // for editor-actionable events; admin equivalent for review.
  const projectQuery = projectId ? `&project=${projectId}` : ''
  const editorLink = `${PORTAL_BASE}/editor?tab=oftv${projectQuery}`
  const adminLink = `${PORTAL_BASE}/admin/editor?tab=oftv${projectQuery}`
  const revLabel = revisionCount > 0 ? ` (revision ${revisionCount})` : ''

  switch (event) {
    // Admin-only awareness ping. Editor doesn't need to act — this just
    // tells Josh "she's pulled the source files, edit is in progress".
    case 'editor_started':
      return [
        `🎬 Long-Form: Editor Started`,
        ``,
        `Creator: ${safeCreator}`,
        `Project: ${safeProject}`,
        assignedEditor ? `Editor: ${assignedEditor}` : null,
        ``,
        `Source files have been downloaded. Status → In Editing.`,
        adminLink,
      ].filter(Boolean).join('\n')

    case 'files_uploaded':
      return [
        `📁 Long-Form: Files Uploaded`,
        ``,
        `Creator: ${safeCreator}`,
        `Project: ${safeProject}`,
        fileCount ? `Files: ${fileCount}` : null,
        ``,
        `Ready for editing.`,
        editorLink,
      ].filter(Boolean).join('\n')

    case 'final_submitted':
      return [
        `🎬 Long-Form: New Edit Submitted${revLabel}`,
        ``,
        `Creator: ${safeCreator}`,
        `Project: ${safeProject}`,
        assignedEditor ? `Editor: ${assignedEditor}` : null,
        ``,
        `Awaiting admin review.`,
        adminLink,
      ].filter(Boolean).join('\n')

    case 'admin_approved':
      return [
        `✅ Long-Form: Admin Approved → Sent to Creator`,
        ``,
        `Creator: ${safeCreator}`,
        `Project: ${safeProject}`,
        ``,
        `Waiting on ${safeCreator} to approve or request changes.`,
      ].join('\n')

    case 'admin_revision_requested':
      return [
        `🔄 Long-Form: Admin Revision Requested${revLabel}`,
        ``,
        `Creator: ${safeCreator}`,
        `Project: ${safeProject}`,
        assignedEditor ? `Editor: ${assignedEditor}` : null,
        ``,
        notes ? `Notes:\n${notes}` : `(No specific notes — see admin in chat.)`,
        ``,
        editorLink,
      ].filter(Boolean).join('\n')

    case 'creator_approved':
      return [
        `🎉 Long-Form: Creator Approved — Project Complete`,
        ``,
        `Creator: ${safeCreator}`,
        `Project: ${safeProject}`,
        revisionCount > 0 ? `Total revisions: ${revisionCount}` : null,
      ].filter(Boolean).join('\n')

    case 'creator_revision_requested':
      return [
        `✏️ Long-Form: Creator Requested Changes${revLabel}`,
        ``,
        `Creator: ${safeCreator}`,
        `Project: ${safeProject}`,
        assignedEditor ? `Editor: ${assignedEditor}` : null,
        ``,
        `Feedback from ${safeCreator}:`,
        notes || '(no notes provided)',
        ``,
        editorLink,
      ].filter(Boolean).join('\n')

    default:
      console.warn('[oftv-telegram] unknown event:', event)
      return null
  }
}

/**
 * Look up the creator AKA from a Palm Creators record id. Used by all the
 * notification call sites so we can include "Creator: Tabby" in the
 * message body without each call site fetching it itself.
 *
 * Returns null on failure — the notification helpers handle that gracefully
 * by falling back to "Unknown creator".
 */
export async function lookupCreatorAka(creatorOpsId) {
  if (!creatorOpsId) return null
  const AIRTABLE_PAT = process.env.AIRTABLE_PAT
  const OPS_BASE = 'applLIT2t83plMqNx'
  const CREATORS_TABLE = 'tbls2so6pHGbU4Uhh'
  try {
    const res = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/${CREATORS_TABLE}/${creatorOpsId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
    )
    if (!res.ok) return null
    const data = await res.json()
    return data.fields?.['AKA'] || data.fields?.['Creator'] || null
  } catch {
    return null
  }
}
