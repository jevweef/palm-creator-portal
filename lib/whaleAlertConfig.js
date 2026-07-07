// Whale Alert Telegram Configuration
// Maps creator AKA → Telegram group + topic thread for whale hunting alerts
//
// To add B team: add a new group entry and map creators to it.
// Topic IDs from Telegram URLs: t.me/c/{groupId}/{topicId}
// Chat ID = -100{groupId}

const WHALE_GROUPS = {
  // A Team — Whale Hunting group
  A: {
    chatId: '-1003645916611',
    creators: {
      'Laurel': 2,
      'Taby': 7,
      'MG': 8,
      'Raya': 74, // moved B → A team, topic created 2026-07-07
      // 'Sunny': 6 — offboarded 2026, removed 2026-07-07
    },
  },
  // B Team — Whale Hunting B group (Juan), wired 2026-07-07
  B: {
    chatId: '-1003962663478',
    creators: {
      'Caitie Rosie': 2,
      'Amelia': 7,
      'Ocean Ray': 8,
    },
  },
}

// Resolve creator name or AKA → { chatId, threadId } or null
// Accepts full name ("Laurel Driskill") or AKA ("Laurel") — checks exact match first, then first name
export function getWhaleTopicForCreator(creatorName) {
  if (!creatorName) return null
  for (const group of Object.values(WHALE_GROUPS)) {
    // Exact match on AKA
    const threadId = group.creators[creatorName]
    if (threadId != null) {
      return { chatId: group.chatId, threadId }
    }
    // Try matching first word of input against configured AKAs
    const firstName = creatorName.split(' ')[0]
    const firstNameThread = group.creators[firstName]
    if (firstNameThread != null) {
      return { chatId: group.chatId, threadId: firstNameThread }
    }
  }
  return null
}

// Get all configured creator names
export function getConfiguredCreators() {
  const creators = []
  for (const [team, group] of Object.entries(WHALE_GROUPS)) {
    for (const name of Object.keys(group.creators)) {
      creators.push({ name, team, chatId: group.chatId, threadId: group.creators[name] })
    }
  }
  return creators
}


// ── Lazy provisioning (2026-07-07) ───────────────────────────────────────────
// The hardcoded map above covers the original creators. Everyone else resolves
// through Airtable: HQ Creators 'Chat Team' decides WHICH group, and
// 'Whale Topic ID' (fld96kDeGVSIfV1vC) stores her topic — created on first
// send by the bot (needs Manage Topics admin in both groups, granted
// 2026-07-07). Offboarding deletes the topic via deleteWhaleTopic.

export const TEAM_GROUPS = { A: '-1003645916611', B: '-1003962663478' }
const HQ_BASE = 'appL7c4Wtotpz07KS'
const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'
const F_CHAT_TEAM = 'fld4wToCuDZmVmFHb'
const F_WHALE_TOPIC = 'fld96kDeGVSIfV1vC'

async function hqRecordForCreator(creatorRecordId, directHqId = null) {
  const at = { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` }
  let hqId = directHqId
  if (!hqId) {
    // OPS record carries the HQ link
    const ops = await fetch(`https://api.airtable.com/v0/applLIT2t83plMqNx/${encodeURIComponent('Palm Creators')}/${creatorRecordId}`, { headers: at })
    if (!ops.ok) return null
    hqId = (await ops.json())?.fields?.['HQ Record ID']
  }
  if (!hqId) return null
  const hq = await fetch(`https://api.airtable.com/v0/${HQ_BASE}/${HQ_CREATORS}/${hqId}?returnFieldsByFieldId=true`, { headers: at })
  if (!hq.ok) return null
  const rec = await hq.json()
  const teamRaw = rec.fields?.[F_CHAT_TEAM]
  const team = (typeof teamRaw === 'string' ? teamRaw : teamRaw?.name || '').replace(/\s*Team$/i, '').trim().toUpperCase()
  return { hqId, team, topicId: rec.fields?.[F_WHALE_TOPIC] || null, name: rec.fields?.fldi2BNvf928yVuZx || '' }
}

/** Resolve (and if needed CREATE) the creator's whale topic. Returns
 *  { chatId, threadId } or null when unresolvable. */
export async function resolveWhaleTopic({ creatorAka, creatorName, creatorRecordId }) {
  const hard = getWhaleTopicForCreator(creatorAka) || getWhaleTopicForCreator(creatorName)
  if (hard) return hard
  if (!creatorRecordId) return null
  const hq = await hqRecordForCreator(creatorRecordId)
  if (!hq?.team || !TEAM_GROUPS[hq.team]) return null
  const chatId = TEAM_GROUPS[hq.team]
  if (hq.topicId) return { chatId, threadId: Number(hq.topicId) }
  // create the topic (onboarding automation — no manual Telegram setup)
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return null
  const res = await fetch(`https://api.telegram.org/bot${token}/createForumTopic`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, name: creatorAka || creatorName }),
  })
  const data = await res.json()
  if (!data.ok) return null
  const threadId = data.result.message_thread_id
  await fetch(`https://api.airtable.com/v0/${HQ_BASE}/${HQ_CREATORS}/${hq.hqId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { [F_WHALE_TOPIC]: String(threadId) } }),
  }).catch(() => {})
  return { chatId, threadId }
}

/** Offboarding: delete the creator's whale topic (best effort) + clear the field. */
export async function deleteWhaleTopic({ creatorAka, creatorName, creatorRecordId, hqId }) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return false
  const hard = getWhaleTopicForCreator(creatorAka) || getWhaleTopicForCreator(creatorName)
  let target = hard
  let hq = null
  if (!target && (creatorRecordId || hqId)) {
    hq = await hqRecordForCreator(creatorRecordId, hqId)
    if (hq?.topicId && TEAM_GROUPS[hq.team]) target = { chatId: TEAM_GROUPS[hq.team], threadId: Number(hq.topicId) }
  }
  if (!target) return false
  const res = await fetch(`https://api.telegram.org/bot${token}/deleteForumTopic`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: target.chatId, message_thread_id: target.threadId }),
  })
  if (hq?.hqId) {
    await fetch(`https://api.airtable.com/v0/${HQ_BASE}/${HQ_CREATORS}/${hq.hqId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { [F_WHALE_TOPIC]: '' } }),
    }).catch(() => {})
  }
  return (await res.json())?.ok === true
}
