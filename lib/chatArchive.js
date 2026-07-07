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
  listDropboxFolder, deleteDropboxPath,
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
  // overwrite is required — default 'add' mode autorenames to "messages (1).json"
  // once the file exists, so every incremental re-save silently vanished
  await uploadToDropbox(token, rootNs, `${base}/messages.json`, Buffer.from(JSON.stringify(archive), 'utf8'), { overwrite: true })
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


// ── Chunked-pull shards ───────────────────────────────────────────────────────
// Long pulls run as many small requests. Each request must stay LIGHT: reading
// and re-saving a multi-MB messages.json per chunk is what blew the serverless
// window (504s). Instead every chunk appends one small shard file under
// {fan}/chunks/, and a single FINALIZE call merges the shards into
// messages.json once. Shards are write-only — no read-modify-write races, and
// a retried chunk at worst duplicates messages the id-dedup merge drops.

export async function saveChunkShard(creatorName, fanName, fanUsername, messages) {
  if (!messages?.length) return
  const token = await getDropboxAccessToken()
  const rootNs = await getDropboxRootNamespaceId(token)
  const base = chatBasePath(creatorName, fanName, fanUsername)
  const safeCreator = base.split('/')[3]
  await createDropboxFolder(token, rootNs, '/Palm Ops/Chat Logs')
  await createDropboxFolder(token, rootNs, `/Palm Ops/Chat Logs/${safeCreator}`)
  await createDropboxFolder(token, rootNs, base)
  await createDropboxFolder(token, rootNs, `${base}/chunks`)
  const name = `pull-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`
  await uploadToDropbox(token, rootNs, `${base}/chunks/${name}`, Buffer.from(JSON.stringify(messages), 'utf8'), { overwrite: true })
}

/** Merge all pending shards into the archive, save it, delete the shards.
 *  Returns the saved archive (or the existing one when no shards pending). */
export async function finalizeChunks(creatorName, fanName, fanUsername, { fanId, historyComplete }) {
  const token = await getDropboxAccessToken()
  const rootNs = await getDropboxRootNamespaceId(token)
  const base = chatBasePath(creatorName, fanName, fanUsername)
  const archive = (await loadChatArchive(creatorName, fanName, fanUsername))
    || { fanId: String(fanId || ''), fanUsername: fanUsername || '', fanName: fanName || '', messages: [], lastMessageAt: null, lastMessageId: null }
  let shardFiles = []
  try {
    const entries = await listDropboxFolder(token, rootNs, `${base}/chunks`)
    shardFiles = (entries || []).filter((e) => (e['.tag'] === 'file' || e.tag === 'file' || e.name) && /\.json$/.test(e.name)).map((e) => e.name)
  } catch { /* no chunks folder — nothing pending */ }
  let incoming = []
  for (const name of shardFiles) {
    try {
      const buf = await downloadFromDropbox(token, rootNs, `${base}/chunks/${name}`)
      if (buf) incoming = incoming.concat(JSON.parse(buf.toString('utf8')))
    } catch { /* skip an unreadable shard */ }
  }
  const { merged } = mergeMessages(archive.messages, incoming)
  const last = merged[merged.length - 1]
  const out = {
    ...archive,
    fanId: String(archive.fanId || fanId || ''),
    messages: merged,
    lastMessageAt: last?.createdAt || null,
    lastMessageId: last?.id ?? null,
    historyComplete: historyComplete ?? !!archive.historyComplete,
    pendingExportId: null,
    updatedAt: new Date().toISOString(),
  }
  await saveChatArchive(creatorName, fanName, fanUsername, out)
  for (const name of shardFiles) {
    try { await deleteDropboxPath(token, rootNs, `${base}/chunks/${name}`) } catch { /* best effort */ }
  }
  return out
}
