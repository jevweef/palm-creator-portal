/**
 * Outbound iMessage to creators on key OFTV state transitions. Goes
 * through the user's Mac iMessage daemon (sendDaemonMessage) so the
 * message lands as if Josh personally sent it from his number.
 *
 * Style rules (Josh's voice, not AI tone):
 *   - "Hey {Name}!" not "Hey {Name} —"  (no em-dashes, ever)
 *   - Lowercase the next word after the exclamation ("hey gracie! your...")
 *   - One-line message, then the link on its own line
 *   - Always link to the portal, never directly to the video — push them
 *     to the website so they engage with the workflow there
 *
 * Resolution chain for the creator's display name:
 *   1. Communication Name (Palm Creators, Ops base) — what Josh actually
 *      calls them. "Tabby" not "Tabetha Hawkins", "Zoe" not "Zoe Ocean Rey".
 *   2. AKA — fallback if Communication Name is empty
 *   3. "there" — last-resort fallback so the message still reads naturally
 *
 * If iMessage Handle is empty on the creator record, this helper silently
 * no-ops and returns { skipped: true, reason }. Workflow continues either
 * way — text is a nice-to-have, not load-bearing.
 */

import { sendDaemonMessage, isDaemonConfigured } from '@/lib/inboxDaemon'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const CREATORS_TABLE = 'tbls2so6pHGbU4Uhh'
const PORTAL_BASE = 'https://app.palm-mgmt.com'

/**
 * Pull communication name + iMessage handle from the creator record in
 * one round-trip so callers don't have to fetch separately. Returns null
 * fields rather than throwing — keep notification failures soft.
 */
export async function fetchCreatorContact(creatorOpsId) {
  if (!creatorOpsId) return { name: null, handle: null, aka: null }
  try {
    const res = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/${CREATORS_TABLE}/${creatorOpsId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
    )
    if (!res.ok) return { name: null, handle: null, aka: null }
    const data = await res.json()
    const f = data.fields || {}
    return {
      name: (f['Communication Name'] || '').trim() || null,
      handle: (f['iMessage Handle'] || '').trim() || null,
      aka: (f['AKA'] || f['Creator'] || '').trim() || null,
    }
  } catch {
    return { name: null, handle: null, aka: null }
  }
}

function displayName(contact) {
  return contact?.name || contact?.aka || 'there'
}

function projectLink(creatorOpsId, projectId) {
  return `${PORTAL_BASE}/creator/${creatorOpsId}/long-form?project=${projectId}`
}

/**
 * Build the message text for a given event. Exposed separately so the
 * admin UI can preview it before send if we add that later.
 */
export function buildCreatorMessage({ event, creatorOpsId, projectId, projectName, contact, isFirstDraft }) {
  const name = displayName(contact)
  const link = projectLink(creatorOpsId, projectId)
  const project = projectName || 'your project'

  // First-draft language vs revision language. The first time admin
  // approves a cut for the creator, it's "your first cut". After that,
  // it's a "new version" / "another version" so we don't keep saying
  // "first" cut on round 3.
  if (event === 'admin_approved' || event === 'sent_to_creator') {
    return isFirstDraft
      ? `hey ${name}! your first cut of ${project} is ready to review whenever you have a minute.\n${link}`
      : `hey ${name}! the new cut of ${project} is ready to review whenever you have a minute.\n${link}`
  }

  if (event === 'revised_cut_to_creator') {
    return `hey ${name}! the editor pushed a new version of ${project} based on your notes. take a look when you can.\n${link}`
  }

  return null
}

/**
 * Send a creator-facing message about an OFTV event. Returns a result
 * object describing what happened — never throws.
 *
 *   { sent: true, handle, messageLength }      — sent successfully
 *   { skipped: true, reason }                  — handle missing, daemon off, etc.
 *   { error: '...', handle }                   — daemon attempted, failed
 *
 * Caller should fire-and-forget. Logging on failure is enough; the workflow
 * state transition is already complete by the time we call this.
 */
export async function notifyCreatorByMessage(args) {
  const { event, creatorOpsId, projectId, projectName, isFirstDraft } = args

  if (!isDaemonConfigured()) {
    return { skipped: true, reason: 'daemon-not-configured' }
  }
  if (!creatorOpsId || !projectId) {
    return { skipped: true, reason: 'missing-ids' }
  }

  const contact = await fetchCreatorContact(creatorOpsId)
  if (!contact.handle) {
    return { skipped: true, reason: 'no-imessage-handle', creator: contact.name || contact.aka }
  }

  const text = buildCreatorMessage({ event, creatorOpsId, projectId, projectName, contact, isFirstDraft })
  if (!text) {
    return { skipped: true, reason: `unsupported-event-${event}` }
  }

  const result = await sendDaemonMessage(contact.handle, text)
  if (result?.error) {
    console.warn('[oftv/creator-messaging] daemon send failed:', result.error)
    return { error: result.error, handle: contact.handle }
  }
  return { sent: true, handle: contact.handle, messageLength: text.length, name: contact.name || contact.aka }
}
