/**
 * Outbound creator-facing messages on key OFTV state transitions.
 *
 * Routes through the user's watched group chat for that creator (the
 * one Josh is already in with the creator + team). Lookup chain:
 *
 *   Palm Creators (Ops) record id
 *     → HQ Record ID linked field
 *     → Telegram Chats table, filter Creator HQ ID = this HQ id
 *       AND Source = 'imessage'
 *       AND Status = 'Watching'
 *     → Chat ID (group chat handle)
 *
 * Send goes through the local iMessage daemon (sendDaemonMessage), so
 * the message appears as if Josh personally sent it to the group chat.
 *
 * Style rules (Josh's voice, not AI tone):
 *   - "hey {name}!" not "hey {name} —"  (no em-dashes, ever)
 *   - Lowercase the next word after the exclamation
 *   - One-line message, then the link on its own line
 *   - Always link to the portal, never directly to the video — push them
 *     to engage on the website
 *
 * Resolution chain for the creator's display name:
 *   1. Communication Name — what Josh actually calls them
 *   2. AKA — fallback
 *   3. "there" — last resort
 *
 * Soft-fail: if the creator has no watched iMessage group chat, the
 * helper returns { skipped: true, reason } and the workflow continues.
 * Notification is a nudge, not load-bearing.
 */

import { sendDaemonMessage, isDaemonConfigured } from '@/lib/inboxDaemon'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const CREATORS_TABLE = 'tbls2so6pHGbU4Uhh'
const TELEGRAM_CHATS_TABLE = 'Telegram Chats'
const PORTAL_BASE = 'https://app.palm-mgmt.com'

async function airtable(path) {
  const res = await fetch(`https://api.airtable.com/v0/${path}`, {
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
    cache: 'no-store',
  })
  if (!res.ok) return null
  return res.json()
}

/**
 * Pull communication name + HQ id from the creator record. Returns null
 * fields rather than throwing — keep notification failures soft.
 */
export async function fetchCreatorContact(creatorOpsId) {
  if (!creatorOpsId) return { name: null, hqId: null, aka: null }
  const data = await airtable(`${OPS_BASE}/${CREATORS_TABLE}/${creatorOpsId}`)
  if (!data) return { name: null, hqId: null, aka: null }
  const f = data.fields || {}
  return {
    name: (f['Communication Name'] || '').trim() || null,
    aka: (f['AKA'] || f['Creator'] || '').trim() || null,
    // HQ Record ID is a singleLineText (string) on Palm Creators (Ops),
    // populated by the onboarding flow / sync.
    hqId: (f['HQ Record ID'] || '').trim() || null,
  }
}

/**
 * Find the watched iMessage group chat for a creator. Returns the daemon
 * Chat ID if one exists in Watching status, otherwise null.
 */
export async function fetchCreatorWatchedChatId(hqId) {
  if (!hqId) return null
  // Filter via formula: Creator HQ ID contains this id AND Source = imessage
  // AND Status = Watching. Creator HQ ID is a multilineText storing the
  // raw HQ record id from the inbox heartbeat sync.
  const formula = encodeURIComponent(
    `AND(FIND('${hqId}', {Creator HQ ID}), {Source}='imessage', {Status}='Watching')`
  )
  const data = await airtable(
    `${OPS_BASE}/${TELEGRAM_CHATS_TABLE}?filterByFormula=${formula}&maxRecords=1`
  )
  const rec = data?.records?.[0]
  if (!rec) return null
  return rec.fields?.['Chat ID'] || null
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
 *   { sent: true, chatId, name }              — sent successfully
 *   { skipped: true, reason }                 — daemon off / no watched chat / etc.
 *   { error: '...', chatId }                  — daemon attempted, failed
 *
 * Caller should fire-and-forget. Workflow state transition is already
 * complete by the time we call this.
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
  if (!contact.hqId) {
    return { skipped: true, reason: 'no-hq-id', creator: contact.name || contact.aka }
  }

  const chatId = await fetchCreatorWatchedChatId(contact.hqId)
  if (!chatId) {
    return { skipped: true, reason: 'no-watched-imessage-chat', creator: contact.name || contact.aka }
  }

  const text = buildCreatorMessage({ event, creatorOpsId, projectId, projectName, contact, isFirstDraft })
  if (!text) {
    return { skipped: true, reason: `unsupported-event-${event}` }
  }

  const result = await sendDaemonMessage(chatId, text)
  if (result?.error) {
    console.warn('[oftv/creator-messaging] daemon send failed:', result.error)
    return { error: result.error, chatId }
  }
  return { sent: true, chatId, messageLength: text.length, name: contact.name || contact.aka }
}
