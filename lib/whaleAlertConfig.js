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
      'Sunny': 6,
      'Taby': 7,
      'MG': 8,
    },
  },
  // B Team — add when ready
  // B: {
  //   chatId: '-100XXXXXXXXXX',
  //   creators: {
  //     'CreatorName': topicId,
  //   },
  // },
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
