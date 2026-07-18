/**
 * Telegram forum topic helpers for the SMM master group.
 *
 * The master group lives in TELEGRAM_SMM_GROUP_CHAT_ID. Each managed IG
 * account (Creator Platform Directory row with Managed by Palm = true) gets
 * its own forum topic inside this group. Topic name = the account's handle.
 *
 * Bot must be a member of the group with "Manage Topics" permission.
 */

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const SMM_GROUP_CHAT_ID = process.env.TELEGRAM_SMM_GROUP_CHAT_ID

async function tg(method, body) {
  if (!TELEGRAM_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not set')
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok || !data.ok) {
    throw new Error(`Telegram ${method} failed: ${data.description || res.status}`)
  }
  return data.result
}

/**
 * Create a forum topic in the SMM group, named after the IG handle.
 * Returns the message_thread_id (number). Returns null if the group isn't
 * configured — caller should treat that as "skip".
 */
export async function createSmmTopicForHandle(handle, { creatorAka } = {}) {
  if (!SMM_GROUP_CHAT_ID) {
    console.warn('[telegram-topics] TELEGRAM_SMM_GROUP_CHAT_ID not set; skipping topic creation')
    return null
  }
  const cleanHandle = (handle || '').replace(/^@/, '').trim()
  if (!cleanHandle) throw new Error('handle is required')

  // Topic name: include AKA so the SMM can disambiguate (e.g. multiple
  // creators may have similarly-named accounts). 64-char Telegram limit.
  const name = creatorAka
    ? `@${cleanHandle} (${creatorAka})`.slice(0, 64)
    : `@${cleanHandle}`.slice(0, 64)

  const result = await tg('createForumTopic', {
    chat_id: SMM_GROUP_CHAT_ID,
    name,
  })
  return result.message_thread_id
}

export function isSmmGroupConfigured() {
  return !!SMM_GROUP_CHAT_ID && !!TELEGRAM_TOKEN
}

/**
 * Create a forum topic in the SMM master group with an arbitrary name (used
 * for the per-creator IG / FB / AI delivery channels — the topics the
 * Telegram IG/FB/AI Topic ID fields on Palm Creators point at). Returns the
 * message_thread_id, or null when the group isn't configured.
 */
export async function createSmmTopic(name) {
  if (!SMM_GROUP_CHAT_ID) {
    console.warn('[telegram-topics] TELEGRAM_SMM_GROUP_CHAT_ID not set; skipping topic creation')
    return null
  }
  const clean = String(name || '').trim()
  if (!clean) throw new Error('topic name is required')
  const result = await tg('createForumTopic', {
    chat_id: SMM_GROUP_CHAT_ID,
    name: clean.slice(0, 64),
  })
  return result.message_thread_id
}

/**
 * Delete a forum topic in the SMM master group. Used by offboarding to
 * clean up per-account topics when a creator is offboarded. Returns null
 * (no-op) if the group isn't configured. Returns { skipped } if Telegram
 * reports the topic doesn't exist anymore so callers can carry on.
 */
export async function deleteSmmTopic(messageThreadId) {
  if (!SMM_GROUP_CHAT_ID) {
    console.warn('[telegram-topics] TELEGRAM_SMM_GROUP_CHAT_ID not set; skipping topic delete')
    return null
  }
  if (!messageThreadId) return null
  try {
    await tg('deleteForumTopic', {
      chat_id: SMM_GROUP_CHAT_ID,
      message_thread_id: Number(messageThreadId),
    })
    return { ok: true }
  } catch (err) {
    const msg = String(err?.message || err)
    // Topic already deleted / never existed — fine, swallow it.
    if (/TOPIC_NOT_MODIFIED|TOPIC_DELETED|topic .* not found|message thread not found/i.test(msg)) {
      return { skipped: true, reason: msg }
    }
    throw err
  }
}

export const TELEGRAM_SMM_GROUP_CHAT_ID = SMM_GROUP_CHAT_ID
