// Shared helpers for the OF transactions Google Sheet — used by the API-pull
// ingestion (pull-transactions) and the whale audit's sheet reads.
//
// DELIBERATELY self-contained: the proven HTML-upload route
// (app/api/admin/invoicing/upload-transactions/route.js) is not modified or
// imported — its helpers are mirrored here so the existing invoice pipeline
// carries zero regression risk. Keep the two in sync if the sheet format ever
// changes (columns A–I are the frozen contract; extra columns live in J+).
//
// SHEET CONTRACT (per account tab "<Account Name> - Sales" / "- Chargebacks"):
//   row 1: cutoff banner · row 3: headers · rows 4+: data, newest first
//   A DateTime "YYYY-MM-DD HH:mm" (ET!)  B Gross  C OF Fee  D Net  E Type
//   F Display Name  G OF Username  H Original Date  I Description
//   J Fan ID  K VAT  L Source        ← additive richer columns (API pulls only)
// Every existing reader (invoices refresh-period, creator-earnings, Ed) reads
// A4:I or A4:A — columns J+ are invisible to them by construction.

import { google } from 'googleapis'

export const SPREADSHEET_ID = process.env.OF_TRANSACTIONS_SPREADSHEET_ID
export const EXTRA_HEADERS = ['Fan ID', 'VAT', 'Source']

export function sheetsClient() {
  const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET)
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })
  return google.sheets({ version: 'v4', auth: oauth2 })
}

// Retry wrapper mirroring the upload route's quota handling.
export async function withRetry(fn, label = 'sheets call') {
  const delays = [1500, 4000, 10000, 20000]
  let lastErr
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try { return await fn() } catch (e) {
      lastErr = e
      const code = e?.code || e?.response?.status
      const retryable = code === 429 || code === 503 || /quota|rate.?limit/i.test(e?.message || '')
      if (!retryable || attempt === delays.length) throw e
      await new Promise((r) => setTimeout(r, delays[attempt]))
    }
  }
  throw lastErr
}

// ── ET conversion ────────────────────────────────────────────────────────────
// The sheet convention is ET (matches the OF web UI the HTML uploads came
// from); the OF API returns UTC. Verified empirically 2026-07-03: same
// transactions differ by exactly the ET offset.
const etFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
})
export function utcToEtDateTime(utcStr) {
  // API format: "2026-05-25 15:49:00" (UTC) or ISO
  const iso = utcStr.includes('T') ? utcStr : utcStr.replace(' ', 'T') + 'Z'
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z')
  if (isNaN(d)) return ''
  const parts = Object.fromEntries(etFmt.formatToParts(d).map((p) => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`
}
export function utcToEtDate(utcStr) {
  const dt = utcToEtDateTime(utcStr)
  return dt ? dt.slice(0, 10) : ''
}

// ── API → sheet type labels (match the HTML statement wording exactly) ──────
const TYPE_MAP = {
  tip: 'Tip',
  message: 'Payment for message',
  post: 'Payment for post',
  subscription: 'Subscription',
  new_subscription: 'Subscription',
  recurring_subscription: 'Recurring subscription',
  stream: 'Stream',
  referral: 'Referral bonus',
}
export function mapType(apiType) {
  const t = String(apiType || '').toLowerCase().trim()
  return TYPE_MAP[t] || (t ? t.charAt(0).toUpperCase() + t.slice(1) : '')
}

export function stripHtmlText(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function readTabRows(sheets, tabName) {
  try {
    const res = await withRetry(() => sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID, range: `'${tabName}'!A4:L`,
    }), `read ${tabName}`)
    return (res.data.values || []).map((r) => ({
      dateTime: r[0] || '', gross: parseFloat(r[1]) || 0, ofFee: parseFloat(r[2]) || 0,
      net: parseFloat(r[3]) || 0, type: r[4] || '', displayName: r[5] || '',
      ofUsername: r[6] || '', originalDate: r[7] || '', description: r[8] || '',
      fanId: r[9] || '', vat: r[10] || '', source: r[11] || '',
    }))
  } catch { return [] }
}

export async function getCutoff(sheets, tabName) {
  try {
    const res = await withRetry(() => sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID, range: `'${tabName}'!A4:A10000`,
    }), 'getCutoff')
    let latest = null
    for (const [s] of res.data.values || []) {
      if (!s) continue
      const dt = new Date(s.includes(' ') ? s.replace(' ', 'T') + ':00' : s)
      if (!isNaN(dt) && (!latest || dt > latest)) latest = dt
    }
    return latest
  } catch { return null }
}

// Fingerprint identical to the HTML upload route: datetime|net|displayName
export function txnFingerprint(dateTime, net, fan) {
  return `${(dateTime || '').trim()}|${String(net).trim()}|${(fan || '').trim()}`
}

export async function getLastFingerprints(sheets, tabName, count = 400) {
  // Rows are NEWEST-first (row 4 = newest, bottom = oldest). Dedup must read
  // the TOP `count` rows — a recent pull only ever collides with recent
  // existing rows. Reading the BOTTOM (oldest) rows never overlapped the
  // incoming batch, so every pulled row passed the filter and got duplicated
  // on top of the HTML-uploaded originals (fixed 2026-07-03). `count` is large
  // enough to cover any realistic overlap window (cutoff − 4d).
  try {
    const res = await withRetry(() => sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID, range: `'${tabName}'!A4:I${3 + count}`,
    }), 'topRows.range')
    return new Set((res.data.values || []).map((r) => txnFingerprint(r[0], r[3], r[5])))
  } catch { return new Set() }
}

// ── Writes (same insert-at-top pattern as the HTML upload) ───────────────────

export async function ensureTab(sheets, accountName, dataType) {
  const tabName = `${accountName} - ${dataType}`
  const meta = await withRetry(() => sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID }), 'ensureTab')
  const existing = meta.data.sheets.find((s) => s.properties.title === tabName)
  if (!existing) {
    await withRetry(() => sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title: tabName } } }] },
    }), 'ensureTab.add')
    await withRetry(() => sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        valueInputOption: 'RAW',
        data: [
          { range: `'${tabName}'!A1`, values: [['⏳ No data uploaded yet — upload your first file!']] },
          { range: `'${tabName}'!A3`, values: [['DateTime', 'Gross', 'OF Fee', 'Net', 'Type', 'Display Name', 'OF Username', 'Original Date', 'Description', ...EXTRA_HEADERS]] },
        ],
      },
    }), 'ensureTab.headers')
  }
  return { tabName, sheetId: existing?.properties?.sheetId }
}

/** Adds the J/K/L headers on an existing tab if absent (additive, safe). */
export async function ensureExtraHeaders(sheets, tabName) {
  try {
    const res = await withRetry(() => sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID, range: `'${tabName}'!J3:L3`,
    }), 'extraHeaders.get')
    const existing = res.data.values?.[0] || []
    if (existing.length < EXTRA_HEADERS.length) {
      await withRetry(() => sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID, range: `'${tabName}'!J3`,
        valueInputOption: 'RAW', resource: { values: [EXTRA_HEADERS] },
      }), 'extraHeaders.set')
    }
  } catch { /* non-fatal */ }
}

export async function insertRowsAtTop(sheets, tabName, rows) {
  if (!rows.length) return
  const meta = await withRetry(() => sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID }), 'insert.get')
  const sheetId = meta.data.sheets.find((s) => s.properties.title === tabName)?.properties?.sheetId
  if (sheetId !== undefined) {
    await withRetry(() => sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { requests: [{ insertDimension: { range: { sheetId, dimension: 'ROWS', startIndex: 3, endIndex: 3 + rows.length }, inheritFromBefore: false } }] },
    }), 'insert.rows')
  }
  await withRetry(() => sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID, range: `'${tabName}'!A4`,
    valueInputOption: 'RAW', resource: { values: rows },
  }), 'insert.write')
}

// Backfill rows are OLDER than everything on the tab (newest-first), so they
// go at the BOTTOM — never at the top, which would corrupt the ordering the
// cutoff banner and readers rely on.
export async function appendRowsAtBottom(sheets, tabName, rows) {
  if (!rows.length) return
  await withRetry(() => sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID, range: `'${tabName}'!A4`,
    valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    resource: { values: rows },
  }), 'append.bottom')
}

export async function updateCutoffBanner(sheets, tabName, cutoffDt) {
  const notice = cutoffDt
    ? `⚠️  ONLY UPLOAD SALES AFTER: ${cutoffDt.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`
    : '⏳ No data uploaded yet — upload your first file!'
  await withRetry(() => sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID, range: `'${tabName}'!A1`,
    valueInputOption: 'RAW', resource: { values: [[notice]] },
  }), 'banner')
}

// ── Revenue Accounts lookup (HQ Airtable) ────────────────────────────────────
// Account Name starts with "<AKA> - " (e.g. "Meadow Marie - Free OF").
// Same proven pattern as creator-earnings' fetchCreatorAccounts.
const HQ_BASE = 'appL7c4Wtotpz07KS'
const REVENUE_ACCOUNTS_TABLE = 'tblQqPWlsjiyJA0ba'

export async function fetchRevenueAccountNames(creatorAka) {
  try {
    const params = new URLSearchParams()
    params.set('filterByFormula', `AND(FIND("${String(creatorAka).replace(/"/g, '\\"')} - ", {Account Name}) = 1, {Platform}="OnlyFans", {Status}="Active")`)
    params.append('fields[]', 'fldkEi3jW9tUXSTc5') // Account Name
    params.set('returnFieldsByFieldId', 'true')
    params.set('pageSize', '20')
    const res = await fetch(`https://api.airtable.com/v0/${HQ_BASE}/${REVENUE_ACCOUNTS_TABLE}?${params}`, {
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` },
    })
    if (!res.ok) return []
    const data = await res.json()
    return (data.records || []).map((r) => r.fields?.['fldkEi3jW9tUXSTc5']).filter(Boolean)
  } catch { return [] }
}
