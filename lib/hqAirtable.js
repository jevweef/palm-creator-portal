/**
 * Airtable REST API helpers for the HQ base (appL7c4Wtotpz07KS).
 * Mirrors the pattern in adminAuth.js which targets the OPS base.
 */

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const HQ_BASE = 'appL7c4Wtotpz07KS'

const hqHeaders = {
  Authorization: `Bearer ${AIRTABLE_PAT}`,
  'Content-Type': 'application/json',
}

const MAX_PAGINATION_PAGES = 50

export async function fetchHqRecords(table, params = {}) {
  const records = []
  let offset = null
  let pages = 0

  do {
    if (++pages > MAX_PAGINATION_PAGES) {
      console.warn(`[fetchHqRecords] Hit max pagination limit for table "${table}"`)
      break
    }
    const query = new URLSearchParams()
    if (offset) query.set('offset', offset)
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

    const url = `https://api.airtable.com/v0/${HQ_BASE}/${encodeURIComponent(table)}?${query}`
    const res = await fetch(url, { headers: hqHeaders, cache: 'no-store' })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Airtable HQ ${res.status}: ${text}`)
    }
    const data = await res.json()
    records.push(...(data.records || []))
    offset = data.offset || null
  } while (offset)

  return records
}

export async function fetchHqRecord(table, recordId) {
  const url = `https://api.airtable.com/v0/${HQ_BASE}/${encodeURIComponent(table)}/${recordId}`
  const res = await fetch(url, { headers: hqHeaders, cache: 'no-store' })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Airtable HQ GET ${res.status}: ${text}`)
  }
  return res.json()
}

export async function patchHqRecord(table, recordId, fields) {
  const res = await fetch(
    `https://api.airtable.com/v0/${HQ_BASE}/${encodeURIComponent(table)}/${recordId}`,
    {
      method: 'PATCH',
      headers: hqHeaders,
      body: JSON.stringify({ fields }),
    }
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Airtable HQ PATCH ${res.status}: ${text}`)
  }
  return res.json()
}

export async function createHqRecord(table, fields) {
  const res = await fetch(
    `https://api.airtable.com/v0/${HQ_BASE}/${encodeURIComponent(table)}`,
    {
      method: 'POST',
      headers: hqHeaders,
      body: JSON.stringify({ fields }),
    }
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Airtable HQ POST ${res.status}: ${text}`)
  }
  return res.json()
}

export { HQ_BASE, hqHeaders }
