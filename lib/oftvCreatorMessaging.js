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
 * Pull communication name, HQ id, and explicit notification chat override
 * from the creator record. Returns null fields rather than throwing —
 * keep notification failures soft.
 */
export async function fetchCreatorContact(creatorOpsId) {
  if (!creatorOpsId) return { name: null, hqId: null, aka: null, overrideChatRecId: null }
  const data = await airtable(`${OPS_BASE}/${CREATORS_TABLE}/${creatorOpsId}`)
  if (!data) return { name: null, hqId: null, aka: null, overrideChatRecId: null }
  const f = data.fields || {}
  return {
    name: (f['Communication Name'] || '').trim() || null,
    aka: (f['AKA'] || f['Creator'] || '').trim() || null,
    hqId: (f['HQ Record ID'] || '').trim() || null,
    overrideChatRecId: (f['OFTV Notification Chat'] || [])[0] || null,
  }
}

/**
 * Resolve which chat to send a creator's OFTV notification to.
 *
 * Priority:
 *   1. Explicit override on Palm Creators (OFTV Notification Chat) — when
 *      set, always use that chat regardless of source/status.
 *   2. Auto-pick: first watched iMessage chat with the creator's HQ ID.
 *
 * Returns the resolved chat as { chatRecId, chatId, source, title, status }
 * or null if nothing matches. Title is included so callers can preview
 * which chat they're about to hit.
 */
export async function resolveCreatorChat({ hqId, overrideChatRecId }) {
  // Override path: fetch by record id directly.
  if (overrideChatRecId) {
    const data = await airtable(`${OPS_BASE}/${TELEGRAM_CHATS_TABLE}/${overrideChatRecId}`)
    if (!data) return null
    const f = data.fields || {}
    return {
      chatRecId: data.id,
      chatId: f['Chat ID'] || null,
      source: f['Source'] || null,
      title: f['Title'] || '',
      status: f['Status'] || null,
      isOverride: true,
    }
  }
  if (!hqId) return null
  // Auto-pick: scoped to iMessage + Watching, scoped by HQ id.
  // Creator HQ ID is multilineText storing raw HQ record id(s) from the
  // inbox heartbeat sync — FIND because multiple ids may concat.
  const formula = encodeURIComponent(
    `AND(FIND('${hqId}', {Creator HQ ID}), {Source}='imessage', {Status}='Watching')`
  )
  const data = await airtable(
    `${OPS_BASE}/${TELEGRAM_CHATS_TABLE}?filterByFormula=${formula}&maxRecords=1`
  )
  const rec = data?.records?.[0]
  if (!rec) return null
  const f = rec.fields || {}
  return {
    chatRecId: rec.id,
    chatId: f['Chat ID'] || null,
    source: f['Source'] || null,
    title: f['Title'] || '',
    status: f['Status'] || null,
    isOverride: false,
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
  if (!contact.hqId && !contact.overrideChatRecId) {
    return { skipped: true, reason: 'no-hq-id-and-no-override', creator: contact.name || contact.aka }
  }

  const chat = await resolveCreatorChat(contact)
  if (!chat || !chat.chatId) {
    return { skipped: true, reason: 'no-watched-chat', creator: contact.name || contact.aka }
  }

  const text = buildCreatorMessage({ event, creatorOpsId, projectId, projectName, contact, isFirstDraft })
  if (!text) {
    return { skipped: true, reason: `unsupported-event-${event}` }
  }

  const result = await sendDaemonMessage(chat.chatId, text)
  if (result?.error) {
    console.warn('[oftv/creator-messaging] daemon send failed:', result.error)
    return { error: result.error, chatId: chat.chatId, chatTitle: chat.title }
  }
  return {
    sent: true,
    chatId: chat.chatId,
    chatTitle: chat.title,
    isOverride: chat.isOverride,
    messageLength: text.length,
    name: contact.name || contact.aka,
  }
}
