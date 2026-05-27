import { auth, currentUser } from '@clerk/nextjs/server'

/**
 * Verify the current user has admin role.
 * Call at the top of any /api/admin/* route handler.
 * Returns the user if admin, throws a Response if not.
 */
export async function requireAdmin() {
  const { userId } = auth()
  if (!userId) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const user = await currentUser()
  const role = user?.publicMetadata?.role

  if (role !== 'admin' && role !== 'super_admin') {
    throw new Response(JSON.stringify({ error: 'Forbidden — admin only' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return user
}

/**
 * Stricter check: admin AND in the Inbox owners allowlist.
 *
 * The Inbox surfaces personal iMessage content; Josh shouldn't see it.
 * Defaults to evan@palm-mgmt.com only. Override via env var
 *   INBOX_OWNER_EMAILS="a@x.com,b@y.com"
 * if you ever want to add another person.
 *
 * Use for any /api/admin/inbox/* route AND for the page-level guard.
 */
const INBOX_OWNER_EMAILS = (process.env.INBOX_OWNER_EMAILS || 'evan@palm-mgmt.com')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean)

export function isInboxOwner(user) {
  if (!user) return false
  const emails = (user.emailAddresses || []).map(e => (e.emailAddress || '').toLowerCase())
  return emails.some(e => INBOX_OWNER_EMAILS.includes(e))
}

export async function requireInboxOwner() {
  const user = await requireAdmin()
  if (!isInboxOwner(user)) {
    throw new Response(JSON.stringify({ error: 'Forbidden — Inbox is restricted' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return user
}

/**
 * Verify the current user has admin or editor role.
 * Used for routes that editors can also access (e.g. editor queue).
 */
export async function requireAdminOrEditor() {
  const { userId } = auth()
  if (!userId) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const user = await currentUser()
  const role = user?.publicMetadata?.role

  if (role !== 'admin' && role !== 'super_admin' && role !== 'editor') {
    throw new Response(JSON.stringify({ error: 'Forbidden — admin or editor only' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return user
}

/**
 * Verify the current user has admin or chat_manager role.
 * Used for the Chat Wall photo library (one chat manager + admin oversight).
 */
export async function requireAdminOrChatManager() {
  const { userId } = auth()
  if (!userId) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const user = await currentUser()
  const role = user?.publicMetadata?.role

  if (role !== 'admin' && role !== 'super_admin' && role !== 'chat_manager') {
    throw new Response(JSON.stringify({ error: 'Forbidden — admin or chat manager only' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return user
}

/**
 * Verify the current user has admin or ai_editor role.
 * Used for the AI recreation staging surface — the ai_editor browses a
 * per-creator scrape pool, produces in TJP, and uploads finished output
 * back into the existing review pipeline. Admins can also access it.
 */
export async function requireAdminOrAiEditor() {
  const { userId } = auth()
  if (!userId) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const user = await currentUser()
  const role = user?.publicMetadata?.role

  if (role !== 'admin' && role !== 'super_admin' && role !== 'ai_editor') {
    throw new Response(JSON.stringify({ error: 'Forbidden — admin or AI editor only' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return user
}

/**
 * Verify the current user has admin or social_media role.
 * Used for SMM portal routes + grid planner (which SMM uses daily).
 */
export async function requireAdminOrSocialMedia() {
  const { userId } = auth()
  if (!userId) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const user = await currentUser()
  const role = user?.publicMetadata?.role

  if (role !== 'admin' && role !== 'super_admin' && role !== 'social_media') {
    throw new Response(JSON.stringify({ error: 'Forbidden — admin or SMM only' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return user
}

/**
 * Airtable REST API helper with pagination support.
 */
const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'

const airtableHeaders = {
  Authorization: `Bearer ${AIRTABLE_PAT}`,
  'Content-Type': 'application/json',
}

const MAX_PAGINATION_PAGES = 50

export async function fetchAirtableRecords(table, params = {}) {
  const records = []
  let offset = null
  let pages = 0

  do {
    if (++pages > MAX_PAGINATION_PAGES) {
      console.warn(`[fetchAirtableRecords] Hit max pagination limit (${MAX_PAGINATION_PAGES}) for table "${table}"`)
      break
    }
    const query = new URLSearchParams()
    if (offset) query.set('offset', offset)
    if (params.view) query.set('view', params.view)
    if (params.maxRecords) query.set('maxRecords', String(params.maxRecords))
    if (params.filterByFormula) query.set('filterByFormula', params.filterByFormula)
    if (params.fields) {
      params.fields.forEach(f => query.append('fields[]', f))
    }
    if (params.sort) {
      params.sort.forEach((s, i) => {
        query.set(`sort[${i}][field]`, s.field)
        if (s.direction) query.set(`sort[${i}][direction]`, s.direction)
      })
    }

    const url = `https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(table)}?${query}`
    const res = await fetchAirtableWithRetry(url, { headers: airtableHeaders, cache: 'no-store' })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Airtable ${res.status}: ${text}`)
    }
    const data = await res.json()
    records.push(...(data.records || []))
    offset = data.offset || null
  } while (offset)

  return records
}

// 429-aware fetch wrapper for Airtable. Airtable's hard limit is 5 req/sec
// per base; the editor dashboard fans out 5-10 parallel reads so an
// occasional 429 happens — the operator sees a white screen and has to
// refresh. This helper retries up to 3 times with exponential backoff
// (honoring Retry-After if present). 5xx transient errors get the same
// treatment. On the final attempt the response is returned to the caller
// so the existing error-text path still runs.
async function fetchAirtableWithRetry(url, init, { maxRetries = 3 } = {}) {
  let lastRes = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, init)
    lastRes = res
    if (res.ok) return res
    if (res.status !== 429 && (res.status < 500 || res.status > 503)) return res
    if (attempt === maxRetries) return res
    const retryAfter = res.headers.get('Retry-After')
    const wait = retryAfter
      ? Math.min(Math.max(parseFloat(retryAfter) * 1000, 250), 4000)
      : Math.min(250 * Math.pow(2, attempt), 2000)
    await new Promise(r => setTimeout(r, wait))
  }
  return lastRes
}

export async function patchAirtableRecord(table, recordId, fields, options = {}) {
  // typecast:true lets Airtable auto-create missing singleSelect options instead
  // of rejecting the write. Opt-in so existing callers don't silently create junk.
  const body = { fields }
  if (options.typecast) body.typecast = true

  const res = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(table)}/${recordId}`,
    {
      method: 'PATCH',
      headers: airtableHeaders,
      body: JSON.stringify(body),
    }
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Airtable PATCH ${res.status}: ${text}`)
  }
  return res.json()
}

export async function batchCreateRecords(table, records, options = {}) {
  const created = []
  for (let i = 0; i < records.length; i += 10) {
    const chunk = records.slice(i, i + 10)
    const body = { records: chunk }
    if (options.typecast) body.typecast = true
    const res = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(table)}`,
      {
        method: 'POST',
        headers: airtableHeaders,
        body: JSON.stringify(body),
      }
    )
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Airtable POST ${res.status}: ${text}`)
    }
    const data = await res.json()
    created.push(...(data.records || []))
  }
  return created
}

export async function batchUpdateRecords(table, updates) {
  for (let i = 0; i < updates.length; i += 10) {
    const chunk = updates.slice(i, i + 10)
    const res = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(table)}`,
      {
        method: 'PATCH',
        headers: airtableHeaders,
        body: JSON.stringify({ records: chunk }),
      }
    )
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Airtable batch PATCH ${res.status}: ${text}`)
    }
  }
}

export async function createAirtableRecord(table, fields, options = {}) {
  const body = { fields }
  if (options.typecast) body.typecast = true
  const res = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(table)}`,
    {
      method: 'POST',
      headers: airtableHeaders,
      body: JSON.stringify(body),
    }
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Airtable POST ${res.status}: ${text}`)
  }
  return res.json()
}

export { OPS_BASE, airtableHeaders }
