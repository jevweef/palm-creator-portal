// OnlyFansAPI.com client — read-only helpers for the whale-hunting feature.
//
// Design notes:
// - Auth: ONLYFANS_API_KEY (Bearer). The key is team-scoped; each connected OF
//   account is addressed by an acct_... id, stored per creator on Palm Creators
//   in 'OF API Account ID'.
// - Credits: regular API calls cost ~1 credit per REQUEST (not per row), data
//   exports 1 credit / 20 rows, webhooks 1 / 100 events. We log per-call usage.
// - Rate limits: 5,000 req/min on this plan; we still pace paginated pulls
//   (150ms between pages) and honor Retry-After on 429.
// - NEVER write to OnlyFans through this module. Read-only by policy (Evan's
//   call, 2026-07-03): the ban-risk posture is "gentlest possible usage".

const BASE = 'https://app.onlyfansapi.com/api'

function apiKey() {
  const k = process.env.ONLYFANS_API_KEY
  if (!k) throw new Error('ONLYFANS_API_KEY not configured')
  return k
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Core request with retry. Returns the parsed JSON body.
 * Retries: 429 (Retry-After honored), 5xx / network (exponential backoff).
 */
export async function ofApi(path, { method = 'GET', body = null, timeoutMs = 30000 } = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`
  let lastErr
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeoutMs)
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: ctrl.signal,
      })
      clearTimeout(timer)
      if (res.status === 429) {
        const wait = parseInt(res.headers.get('retry-after') || '2', 10) * 1000
        await sleep(Math.min(wait, 15000))
        continue
      }
      const text = await res.text()
      let json
      try { json = JSON.parse(text) } catch {
        throw new Error(`OF API non-JSON response (${res.status}): ${text.slice(0, 120)}`)
      }
      if (!res.ok) {
        const msg = json?.error?.message || json?.message || json?.detail || text.slice(0, 200)
        // 4xx (other than 429) won't improve on retry
        if (res.status >= 400 && res.status < 500) throw new Error(`OF API ${res.status}: ${msg}`)
        lastErr = new Error(`OF API ${res.status}: ${msg}`)
        await sleep(1000 * (attempt + 1))
        continue
      }
      return json
    } catch (e) {
      if (e.message?.startsWith('OF API 4')) throw e
      lastErr = e
      await sleep(1000 * (attempt + 1))
    }
  }
  throw lastErr || new Error('OF API request failed')
}

/** Credits used by a response (for logging/telemetry). */
export function creditsUsed(json) {
  return json?._meta?._credits?.used ?? null
}
export function creditsBalance(json) {
  return json?._meta?._credits?.balance ?? null
}

/** Unwrap the various list shapes the API returns. */
function unwrapList(json) {
  const d = json?.data ?? json
  if (Array.isArray(d)) return d
  if (Array.isArray(d?.list)) return d.list
  if (Array.isArray(d?.messages)) return d.messages
  if (Array.isArray(d?.chats)) return d.chats
  return []
}

export async function listAccounts() {
  const json = await ofApi('/accounts')
  return Array.isArray(json) ? json : (json?.data || [])
}

/** Active fans w/ spending totals. filters: { total_spent, tips, online, duration, query } */
export async function listActiveFans(accountId, { limit = 20, offset = 0, filters = {} } = {}) {
  const p = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '') p.set(k.startsWith('filter.') || k === 'query' ? k : `filter.${k}`, String(v))
  }
  return ofApi(`/${accountId}/fans/active?${p}`)
}

/** Resolve a fan's OF user id from their username (or search by name). */
export async function resolveFanId(accountId, { username, name } = {}) {
  if (username) {
    try {
      const json = await ofApi(`/${accountId}/users/${encodeURIComponent(username)}`)
      const u = json?.data ?? json
      if (u?.id) return { id: String(u.id), username: u.username || username, name: u.name || '' }
    } catch { /* fall through to search */ }
  }
  const q = username || name
  if (!q) return null
  // Search across all fans (active + expired) by name/username
  for (const scope of ['active', 'all', 'expired']) {
    try {
      const json = await ofApi(`/${accountId}/fans/${scope}?limit=20&query=${encodeURIComponent(q)}`)
      const fans = unwrapList(json)
      if (fans.length) {
        const ql = q.toLowerCase()
        const hit = fans.find((f) => (f.username || '').toLowerCase() === ql)
          || fans.find((f) => (f.name || '').toLowerCase() === ql)
          || fans[0]
        return { id: String(hit.id), username: hit.username || '', name: hit.name || '' }
      }
    } catch { /* try next scope */ }
  }
  return null
}

/**
 * Pull a fan's chat history, newest-first pages, back to `sinceDate` (ISO) or
 * the start of the chat. Cursor pagination by oldest message id per page.
 * maxPages caps credits (1 credit/page).
 */
export async function fetchChatHistory(accountId, fanId, { sinceDate = null, maxPages = 40 } = {}) {
  const all = []
  let cursor = null
  let pages = 0
  let credits = 0
  const since = sinceDate ? new Date(sinceDate).getTime() : null
  for (let i = 0; i < maxPages; i++) {
    const p = new URLSearchParams({ limit: '100' })
    // The API paginates with first_id (see its _pagination.next_page link).
    // We previously sent `id`, which it doesn't honor — pages overlapped
    // heavily and every overlapping page still billed a credit (a 992-message
    // chat cost 40 pages instead of 10; fixed 2026-07-04).
    if (cursor) p.set('first_id', String(cursor))
    const json = await ofApi(`/${accountId}/chats/${fanId}/messages?${p}`)
    credits += creditsUsed(json) || 0
    const batch = unwrapList(json)
    if (!batch.length) break
    all.push(...batch)
    pages++
    const oldest = batch.reduce((a, b) => ((a.createdAt || '') < (b.createdAt || '') ? a : b))
    if (since && oldest.createdAt && new Date(oldest.createdAt).getTime() < since) break
    // Prefer the cursor the API hands us; fall back to the oldest id.
    const nextLink = json?._pagination?.next_page || ''
    const m = String(nextLink).match(/first_id=(\d+)/)
    const next = (m && m[1]) || oldest?.id
    if (!next || String(next) === String(cursor)) break
    cursor = next
    await sleep(150)
  }
  // Dedup by id, sort ascending (oldest first)
  const seen = new Set()
  const msgs = all.filter((m) => {
    if (!m?.id || seen.has(m.id)) return false
    seen.add(m.id)
    if (since && m.createdAt && new Date(m.createdAt).getTime() < since) return false
    return true
  }).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
  return { messages: msgs, pages, credits }
}

// ── Transform API messages → the exact shape parseChatHtml() produces ────────
// The whale analysis pipeline (analyze-chat route + FansPanel) consumes
// { conversation, messages:[{date,time,sender,line}], messageCount,
//   fanMessages, creatorMessages, firstMessageDate, lastMessageDate }.
// Dates are formatted in ET to match how the OF web UI (and the old HTML
// exports) present chat timestamps.

const ET = 'America/New_York'
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: ET })
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: ET }).toLowerCase()
}
function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

/**
 * @param rawMessages ascending-sorted API message objects
 * @param fanId the fan's OF user id (string/number) — used to identify sender
 */
export function toParsedChat(rawMessages, fanId) {
  const fid = String(fanId)
  const messages = []
  for (const m of rawMessages) {
    const fromId = String(m?.fromUser?.id ?? '')
    const isCreator = m?.isSentByMe === true || (fromId && fromId !== fid)
    const sender = isCreator ? 'CREATOR' : 'FAN'
    const text = stripHtml(m?.text)
    const mediaCount = m?.mediaCount || (Array.isArray(m?.media) ? m.media.length : 0)
    const price = Number(m?.price || 0)
    const isTip = !!m?.isTip

    let line = `[${sender}]`
    // Mass-blast marker — API-only signal (isFromQueue). Lets the analysis
    // discount promo blasts vs. genuine 1:1 conversation.
    if (isCreator && m?.isFromQueue) line += ' [MASS]'
    if (text) line += ` ${text}`
    if (mediaCount) line += ` [media x${mediaCount}]`
    if (price > 0) {
      // API-only upgrade over the HTML parse: we KNOW whether the fan actually
      // bought the PPV (isOpened) instead of just being offered it.
      const bought = m?.isOpened === true
      line += ` [PPV $${price.toFixed(2)}${bought ? ' • PURCHASED' : ' • not purchased'}]`
    }
    if (isTip) line += ' [TIP]'

    if (text || mediaCount || isTip) {
      messages.push({ date: m.createdAt ? fmtDate(m.createdAt) : '', time: m.createdAt ? fmtTime(m.createdAt) : '', sender, line })
    }
  }

  let currentDate = ''
  const lines = []
  for (const msg of messages) {
    if (msg.date && msg.date !== currentDate) {
      currentDate = msg.date
      lines.push(`\n--- ${msg.date} ---`)
    }
    lines.push(msg.line)
  }
  const first = messages[0] || null
  const last = messages[messages.length - 1] || null
  return {
    conversation: lines.join('\n'),
    messages,
    messageCount: messages.length,
    fanMessages: messages.filter((m) => m.sender === 'FAN').length,
    creatorMessages: messages.filter((m) => m.sender === 'CREATOR').length,
    firstMessageDate: first ? (first.time ? `${first.date}, ${first.time}` : first.date) : '',
    lastMessageDate: last ? (last.time ? `${last.date}, ${last.time}` : last.date) : '',
  }
}

// ── Data exports (bulk transactions / chargebacks) ───────────────────────────

export async function createDataExport({ type, accountIds, startDate, endDate, fileType = 'csv' }) {
  const json = await ofApi('/data-exports', {
    method: 'POST',
    body: { type, account_ids: accountIds, start_date: startDate, end_date: endDate, file_type: fileType, auto_start: true },
  })
  return json?.data ?? json
}

export async function getDataExport(exportId) {
  const json = await ofApi(`/data-exports/${exportId}`)
  return json?.data ?? json
}

export async function listDataExports(page = 1) {
  const json = await ofApi(`/data-exports?page=${page}`)
  return json?.data?.data ?? json?.data ?? []
}

/** Find an existing export matching account + type + window (same calendar
 * days). Lets a re-run ATTACH to an in-progress export (big accounts take
 * many minutes to scrape) or reuse a completed one for free, instead of
 * creating a duplicate — which the API rejects with a 404. */
export async function findDataExport({ type, accountId, startDate, endDate }) {
  const sameDay = (a, b) => String(a || '').slice(0, 10) === String(b || '').slice(0, 10)
  const list = await listDataExports()
  return (Array.isArray(list) ? list : []).find((e) =>
    e.type === type &&
    (e.accounts || []).some((a) => a.id === accountId) &&
    sameDay(e.start_date, startDate) && sameDay(e.end_date, endDate) &&
    ['pending', 'queued', 'in_progress', 'completed'].includes(e.status)
  ) || null
}

/** Poll an export to completion. Their guidance: periodic checks suffice. */
export async function waitForDataExport(exportId, { intervalMs = 5000, maxWaitMs = 240000 } = {}) {
  const started = Date.now()
  while (Date.now() - started < maxWaitMs) {
    const d = await getDataExport(exportId)
    if (d.status === 'completed') return d
    if (d.status === 'failed' || d.failed_at) throw new Error(`Export failed: ${d.failed_reason || 'unknown'}`)
    await sleep(intervalMs)
  }
  throw new Error('Export timed out')
}

/** Download a completed export's CSV as text. */
export async function downloadExportCsv(exportData) {
  const url = exportData.download_url || exportData?.accounts?.[0]?.download_url
  if (!url) throw new Error('No download URL on export')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Export download failed: ${res.status}`)
  return res.text()
}
