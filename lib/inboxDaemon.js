// Helpers for fetching iMessage data live from the user's Mac via the
// Cloudflare-tunneled daemon. This is the local-first path: data stays
// on the Mac unless the user opts a chat into Watching.
//
// Env required:
//   DAEMON_URL     — public tunnel URL (e.g. https://xxx.trycloudflare.com)
//   DAEMON_SECRET  — shared secret matching daemon_secret in ~/.palm-inbox.json
//
// All endpoints return null on failure (silent degrade — daemon being
// unreachable shouldn't break the whole inbox page; we just lose live data).

const DAEMON_TIMEOUT_MS = 8000

function _baseUrl() {
  const url = process.env.DAEMON_URL
  if (!url) return null
  return url.replace(/\/$/, '')
}

function _headers() {
  return {
    'X-Daemon-Secret': process.env.DAEMON_SECRET || '',
    'Accept': 'application/json',
  }
}

async function _fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DAEMON_TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal, cache: 'no-store' })
    return res
  } finally {
    clearTimeout(timer)
  }
}

export function isDaemonConfigured() {
  return !!(process.env.DAEMON_URL && process.env.DAEMON_SECRET)
}

export async function daemonHealth() {
  const base = _baseUrl()
  if (!base) return { configured: false }
  try {
    const res = await _fetchWithTimeout(`${base}/health`)
    if (!res.ok) return { configured: true, reachable: false, status: res.status }
    const data = await res.json()
    return { configured: true, reachable: true, ...data }
  } catch (err) {
    return { configured: true, reachable: false, error: err.message }
  }
}

// Returns array of chats from chat.db, or null on failure.
// Shape: [{chatId, title, type, messageCount, lastMessageAt, lastMessageSnippet, isFromMeLast}]
export async function fetchDaemonChats(limit = 200) {
  const base = _baseUrl()
  if (!base) return null
  try {
    const res = await _fetchWithTimeout(`${base}/chats?limit=${limit}`, { headers: _headers() })
    if (!res.ok) {
      console.warn(`[daemon] /chats failed: ${res.status}`)
      return null
    }
    const data = await res.json()
    return Array.isArray(data?.chats) ? data.chats : null
  } catch (err) {
    console.warn('[daemon] /chats error:', err.message)
    return null
  }
}

// Sends an iMessage via the Mac daemon (which runs AppleScript). Returns
// {ok: true, chatId} on success, or {error, ...} on failure.
export async function sendDaemonMessage(chatId, text) {
  const base = _baseUrl()
  if (!base) return { error: 'daemon not configured' }
  if (!chatId || !text) return { error: 'chatId and text required' }
  try {
    const res = await _fetchWithTimeout(`${base}/send`, {
      method: 'POST',
      headers: { ..._headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, text }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { error: data.error || `HTTP ${res.status}`, ...data }
    return data
  } catch (err) {
    return { error: err.message }
  }
}

// Returns array of messages for a chat, or null on failure.
// Shape: [{messageKey, text, senderHandle, senderName, sentAt, isFromMe, hasMedia, mediaType}]
export async function fetchDaemonMessages(chatId, limit = 200) {
  const base = _baseUrl()
  if (!base || !chatId) return null
  try {
    const url = `${base}/chat?chatId=${encodeURIComponent(chatId)}&limit=${limit}`
    const res = await _fetchWithTimeout(url, { headers: _headers() })
    if (!res.ok) {
      console.warn(`[daemon] /chat ${chatId} failed: ${res.status}`)
      return null
    }
    const data = await res.json()
    return Array.isArray(data?.messages) ? data.messages : null
  } catch (err) {
    console.warn(`[daemon] /chat ${chatId} error:`, err.message)
    return null
  }
}
