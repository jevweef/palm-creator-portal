// Per-fan raw chat archive on Dropbox — the "we already have this part"
// memory that makes chat pulls INCREMENTAL. One JSON per fan next to the
// human-readable transcripts:
//   /Palm Ops/Chat Logs/{Creator}/{Fan}/messages.json
//   { fanId, fanUsername, fanName, lastMessageAt, lastMessageId,
//     updatedAt, messages: [raw API message objects, ascending] }
//
// Pull flow: load archive (0 credits) → fetch only messages NEWER than
// lastMessageAt (~1 credit per 100) → merge by id → save. First pull pays
// for the full history once; every pull after that costs ~1 credit.
// The archived fanId also skips the resolveFanId lookup on repeat pulls.

import {
  getDropboxAccessToken, getDropboxRootNamespaceId,
  uploadToDropbox, downloadFromDropbox, createDropboxFolder,
} from './dropbox.js' // relative (not @/) so standalone scripts can import this lib too

// Same sanitization as analyze-chat's getChatBasePath — keeps the archive in
// the same folder as that fan's transcripts.
export function chatBasePath(creatorName, fanName, fanUsername) {
  const safeFan = (fanUsername || fanName).replace(/[^a-zA-Z0-9_-]/g, '_')
  const safeCreator = creatorName.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `/Palm Ops/Chat Logs/${safeCreator}/${safeFan}`
}

export async function loadChatArchive(creatorName, fanName, fanUsername) {
  try {
    const token = await getDropboxAccessToken()
    const rootNs = await getDropboxRootNamespaceId(token)
    const buf = await downloadFromDropbox(token, rootNs, `${chatBasePath(creatorName, fanName, fanUsername)}/messages.json`)
    if (!buf) return null
    const arc = JSON.parse(buf.toString('utf8'))
    return Array.isArray(arc?.messages) ? arc : null
  } catch { return null } // no archive yet — first pull
}

export async function saveChatArchive(creatorName, fanName, fanUsername, archive) {
  const token = await getDropboxAccessToken()
  const rootNs = await getDropboxRootNamespaceId(token)
  const base = chatBasePath(creatorName, fanName, fanUsername)
  const safeCreator = base.split('/')[3]
  await createDropboxFolder(token, rootNs, '/Palm Ops/Chat Logs')
  await createDropboxFolder(token, rootNs, `/Palm Ops/Chat Logs/${safeCreator}`)
  await createDropboxFolder(token, rootNs, base)
  await uploadToDropbox(token, rootNs, `${base}/messages.json`, Buffer.from(JSON.stringify(archive), 'utf8'))
}

/** Merge new raw messages into existing ones — dedup by id, ascending by createdAt. */
export function mergeMessages(existing, incoming) {
  const byId = new Map()
  for (const m of existing || []) if (m?.id != null) byId.set(String(m.id), m)
  let added = 0
  for (const m of incoming || []) {
    if (m?.id == null) continue
    if (!byId.has(String(m.id))) added++
    byId.set(String(m.id), m)
  }
  const merged = [...byId.values()].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
  return { merged, added }
}
