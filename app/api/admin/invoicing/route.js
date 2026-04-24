import { requireAdmin } from '@/lib/adminAuth'

const HQ_BASE = 'appL7c4Wtotpz07KS'
const INVOICES_TABLE = 'tblKbU8VkdlOHXoJj'

const headers = () => ({
  Authorization: `Bearer ${process.env.AIRTABLE_PAT}`,
  'Content-Type': 'application/json',
})

const FIELDS = [
  'fldCimhMbOOeOQrFJ', // Invoice (formula)
  'fldGggvFzR0zzl9p4', // Creator (linked)
  'fld37wwgvM0znxDPa', // AKA (lookup)
  'fldUBcYSMy74lt9Xf', // Earnings (TR)
  'fldeQoHxbYYWAnJYZ', // Commission % (Snapshot)
  'fldO2YiCr4FWxn5rG', // Chat Team Fee % (Snapshot)
  'fldrJ6c9JXTdFwGvE', // Net Commission %
  'fldeucG0jEvjem841', // Period Start
  'fldZhX5uMZjrAkAeP', // Period End
  'fldOTpRmDWDfwz8FH', // Due Date
  'fldFPZrQpTqcN4ywK', // Period Label
  'fldk9uXcTQmkb897y', // Total Commission
  'fldirfRJlik40tnde', // Chat Team Cost
  'fldwTZKgEwLm9N3qW', // Net Profit
  'fldBaIZAsl08bJoCq', // Invoice Name
  'fldQEjYB0DxpNWxhU', // Invoice Status
  'fldl3FDN3H4pr2nIY', // Invoice Number
  'fldhtbiwnxDm2KJpg', // Invoice Dropbox Link
  'fld6OleRMqVZJeE8f', // Revenue Account (linked)
  'fldDrn5gbFp03ngNC', // Creator Invoice (attachment)
  'fldtJxnQil7qFI3v1', // Generated At
  'fldurnksixCkoU7Lh', // Sent At
]

// In-memory cache (per server instance)
const cache = new Map() // key → { data, expiresAt }
const CACHE_TTL_MS = 60 * 1000

// Lightweight fields for period list (just enough to render period tabs)
const PERIOD_LIST_FIELDS = [
  'fldeucG0jEvjem841', // Period Start
  'fldZhX5uMZjrAkAeP', // Period End
  'fldFPZrQpTqcN4ywK', // Period Label
]

async function fetchInvoiceRecords({ filterFormula, fieldList }) {
  const records = []
  let offset = null
  do {
    const params = new URLSearchParams()
    params.set('returnFieldsByFieldId', 'true')
    fieldList.forEach(f => params.append('fields[]', f))
    params.set('sort[0][field]', 'fldeucG0jEvjem841')
    params.set('sort[0][direction]', 'desc')
    params.set('sort[1][field]', 'fld37wwgvM0znxDPa')
    params.set('sort[1][direction]', 'asc')
    params.set('pageSize', '100')
    if (filterFormula) params.set('filterByFormula', filterFormula)
    if (offset) params.set('offset', offset)

    const res = await fetch(
      `https://api.airtable.com/v0/${HQ_BASE}/${INVOICES_TABLE}?${params}`,
      { headers: headers(), cache: 'no-store' }
    )
    const data = await res.json()
    if (data.records) records.push(...data.records)
    offset = data.offset || null
  } while (offset)
  return records
}

export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }

  const url = new URL(request.url)
  const periodParam = url.searchParams.get('period') // "YYYY-MM-DD|YYYY-MM-DD"
  const mode = url.searchParams.get('mode') // 'latest' | 'period' | 'all'

  const cacheKey = `${mode || 'latest'}:${periodParam || ''}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json(cached.data)
  }

  // Always fetch the full period list (lightweight - only 3 fields)
  // This gives us tabs to render without loading full records
  const periodListPromise = fetchInvoiceRecords({
    filterFormula: null,
    fieldList: PERIOD_LIST_FIELDS,
  })

  // Determine which records to fetch in full
  let recordsFilter = null
  if (mode === 'all') {
    recordsFilter = null // fetch everything
  } else if (periodParam) {
    const [start, end] = periodParam.split('|')
    recordsFilter = `AND({Period Start}='${start}', {Period End}='${end}')`
  }
  // else mode=latest: fetch nothing yet, resolve after period list

  let fullRecords = []
  if (recordsFilter !== null || mode === 'all') {
    fullRecords = await fetchInvoiceRecords({
      filterFormula: recordsFilter,
      fieldList: FIELDS,
    })
  }

  const periodListRecords = await periodListPromise

  // If mode is latest (default), fetch records for most recent period only
  if (!mode || mode === 'latest') {
    // Find most recent period from period list (sorted desc)
    const first = periodListRecords[0]
    if (first) {
      const start = first.fields['fldeucG0jEvjem841']
      const end = first.fields['fldZhX5uMZjrAkAeP']
      if (start && end) {
        fullRecords = await fetchInvoiceRecords({
          filterFormula: `AND({Period Start}='${start}', {Period End}='${end}')`,
          fieldList: FIELDS,
        })
      }
    }
  }

  const records = fullRecords

  const transformed = records.map(r => {
    const f = r.fields
    const invoiceFormula = f['fldCimhMbOOeOQrFJ'] || ''
    // Formula: "Taby - Free OF | 2026-03-29 to 2026-04-11"
    const accountName = invoiceFormula.split(' | ')[0]?.trim() || ''
    const akaArr = f['fld37wwgvM0znxDPa'] || []
    const attachments = f['fldDrn5gbFp03ngNC'] || []
    const statusRaw = f['fldQEjYB0DxpNWxhU']
    const status = typeof statusRaw === 'object' && statusRaw !== null
      ? statusRaw.name
      : (statusRaw || 'Draft')

    return {
      id: r.id,
      invoiceFormula,
      accountName,
      aka: akaArr[0] || '',
      periodStart: f['fldeucG0jEvjem841'] || '',
      periodEnd: f['fldZhX5uMZjrAkAeP'] || '',
      periodLabel: f['fldFPZrQpTqcN4ywK'] || '',
      earnings: f['fldUBcYSMy74lt9Xf'] || 0,
      commissionPct: f['fldeQoHxbYYWAnJYZ'] || 0,
      chatFeePct: f['fldO2YiCr4FWxn5rG'] || 0,
      netCommissionPct: f['fldrJ6c9JXTdFwGvE'] || 0,
      totalCommission: f['fldk9uXcTQmkb897y'] || 0,
      chatTeamCost: f['fldirfRJlik40tnde'] || 0,
      netProfit: f['fldwTZKgEwLm9N3qW'] || 0,
      invoiceName: f['fldBaIZAsl08bJoCq'] || '',
      status,
      invoiceNumber: f['fldl3FDN3H4pr2nIY'] || null,
      dropboxLink: f['fldhtbiwnxDm2KJpg'] || null,
      hasPdf: attachments.length > 0,
      pdfUrl: attachments[0]?.url || null,
      pdfThumbnail: attachments[0]?.thumbnails?.large?.url || null,
      dueDate: f['fldOTpRmDWDfwz8FH']
        ? f['fldOTpRmDWDfwz8FH'].split('T')[0]
        : null,
      generatedAt: f['fldtJxnQil7qFI3v1'] || null,
      sentAt: f['fldurnksixCkoU7Lh'] || null,
    }
  })

  // Build unique period list from the lightweight period list fetch (newest first)
  const seen = new Set()
  const periods = []
  periodListRecords.forEach(r => {
    const start = r.fields['fldeucG0jEvjem841']
    const end = r.fields['fldZhX5uMZjrAkAeP']
    const label = r.fields['fldFPZrQpTqcN4ywK']
    if (!start || !end) return
    const key = `${start}|${end}`
    if (!seen.has(key)) {
      seen.add(key)
      periods.push({ key, start, end, label: label || '' })
    }
  })

  const payload = { records: transformed, periods }
  cache.set(cacheKey, { data: payload, expiresAt: Date.now() + CACHE_TTL_MS })
  return Response.json(payload)
}

export async function PATCH(request) {
  try { await requireAdmin() } catch (e) { return e }

  const { recordId, fields } = await request.json()

  const allowed = {
    earnings: 'fldUBcYSMy74lt9Xf',
    status: 'fldQEjYB0DxpNWxhU',
    invoiceNumber: 'fldl3FDN3H4pr2nIY',
    generatedAt: 'fldtJxnQil7qFI3v1',
    sentAt: 'fldurnksixCkoU7Lh',
  }

  const airtableFields = {}
  for (const [key, fieldId] of Object.entries(allowed)) {
    if (fields[key] !== undefined) {
      airtableFields[fieldId] = fields[key]
    }
  }

  if (Object.keys(airtableFields).length === 0) {
    return Response.json({ error: 'No valid fields' }, { status: 400 })
  }

  const res = await fetch(
    `https://api.airtable.com/v0/${HQ_BASE}/${INVOICES_TABLE}/${recordId}`,
    {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ fields: airtableFields }),
    }
  )

  if (!res.ok) {
    const err = await res.json()
    return Response.json({ error: err }, { status: res.status })
  }

  return Response.json({ ok: true })
}
