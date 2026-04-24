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
    const res = await fetch(url, { headers: airtableHeaders, cache: 'no-store' })
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

export async function batchCreateRecords(table, records) {
  const created = []
  for (let i = 0; i < records.length; i += 10) {
    const chunk = records.slice(i, i + 10)
    const res = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(table)}`,
      {
        method: 'POST',
        headers: airtableHeaders,
        body: JSON.stringify({ records: chunk }),
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

export async function createAirtableRecord(table, fields) {
  const res = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(table)}`,
    {
      method: 'POST',
      headers: airtableHeaders,
      body: JSON.stringify({ fields }),
    }
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Airtable POST ${res.status}: ${text}`)
  }
  return res.json()
}

export { OPS_BASE, airtableHeaders }
