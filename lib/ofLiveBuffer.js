// Live-event store for the OF webhook receiver + live chat views.
//
// v3 — GOOGLE SHEETS APPEND LOG. The Dropbox read-modify-write pattern lost
// events four separate times on 2026-07-04 (concurrent webhook deliveries +
// concurrent pollers). Sheets `values.append` is atomic SERVER-SIDE: any
// number of concurrent writers each get their own row, no read-modify-write
// exists anywhere, so this entire class of bug is structurally impossible.
//
// Layout: spreadsheet LIVE_EVENTS_SPREADSHEET_ID, one tab per acct_… id,
// one JSON-encoded event per row in column A. Readers take the tail.

import { google } from 'googleapis'

const SPREADSHEET_ID = process.env.LIVE_EVENTS_SPREADSHEET_ID
const TAB_CACHE = new Set()

function client() {
  const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET)
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })
  return google.sheets({ version: 'v4', auth: oauth2 })
}

async function ensureTab(sheets, tab) {
  if (TAB_CACHE.has(tab)) return
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets(properties(title))' })
  if (!meta.data.sheets.some((s) => s.properties.title === tab)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title: tab } } }] },
    }).catch(() => {}) // concurrent creator: already exists is fine
  }
  TAB_CACHE.add(tab)
}

export async function writeLiveEvent(accountId, entry) {
  if (!SPREADSHEET_ID) throw new Error('LIVE_EVENTS_SPREADSHEET_ID not configured')
  const sheets = client()
  await ensureTab(sheets, accountId)
  // Retry through quota blips (60 writes/min/user is shared with the money
  // sheet) — a webhook event must never be dropped because of a 429.
  let lastErr
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${accountId}'!A1`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: [[JSON.stringify(entry)]] },
      })
      return
    } catch (e) {
      lastErr = e
      const code = e?.code || e?.response?.status
      if (code !== 429 && code !== 503) throw e
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)))
    }
  }
  throw lastErr
}

function parseRows(rows) {
  const out = []
  const seen = new Set()
  for (const r of rows || []) {
    try {
      const e = JSON.parse(r[0])
      if (e?.id != null && !seen.has(String(e.id))) { out.push(e); seen.add(String(e.id)) }
    } catch { /* skip garbage */ }
  }
  out.sort((a, b) => (b.at || '').localeCompare(a.at || ''))
  return out.slice(0, 400)
}

export async function readLiveMerged(accountId) {
  if (!SPREADSHEET_ID) return []
  const sheets = client()
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID, range: `'${accountId}'!A:A`, majorDimension: 'ROWS',
    })
    const rows = res.data.values || []
    return parseRows(rows.slice(-500))
  } catch { return [] } // tab doesn't exist yet — no events for this account
}

/** Batched read for the stream: ONE API request for all accounts. */
export async function readLiveMany(accountIds) {
  if (!SPREADSHEET_ID || !accountIds.length) return {}
  const sheets = client()
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets(properties(title))' })
  const existing = new Set(meta.data.sheets.map((s) => s.properties.title))
  const wanted = accountIds.filter((a) => existing.has(a))
  if (!wanted.length) return {}
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SPREADSHEET_ID,
    ranges: wanted.map((a) => `'${a}'!A:A`),
    majorDimension: 'ROWS',
  })
  const out = {}
  ;(res.data.valueRanges || []).forEach((vr, i) => {
    out[wanted[i]] = parseRows((vr.values || []).slice(-500))
  })
  return out
}
