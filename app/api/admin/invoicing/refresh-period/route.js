import { requireAdmin } from '@/lib/adminAuth'
import { google } from 'googleapis'

export const maxDuration = 60

// ── Constants ───────────────────────────────────────────────────────────────

const HQ_BASE = 'appL7c4Wtotpz07KS'
const INVOICES_TABLE = 'tblKbU8VkdlOHXoJj'
const REVENUE_ACCOUNTS_TABLE = 'tblQqPWlsjiyJA0ba'
const CREATORS_TABLE = 'tblYhkNvrNuOAHfgw'
const SPREADSHEET_ID = process.env.OF_TRANSACTIONS_SPREADSHEET_ID

// Hard cutover: never operate on periods that ended before this date.
// Protects historic invoices from accidental rewrites.
const AUTOMATION_START = '2026-04-15'

// Default ManageHer chat team fee, expressed as % of net revenue.
// Stored on each invoice as `Chat Team Fee % (Snapshot)` so future rate
// changes (e.g. dropping to 17.5% for select creators) don't retroactively
// affect already-finalized invoices. The snapshot is stored as % of
// commission (not % of revenue) because that's what the Airtable
// `Chat Team Cost` formula multiplies against:
//   chatTeamCost = Earnings × Commission% × Chat Team Fee%
// To target 20% of revenue at e.g. 40% commission:
//   Chat Team Fee% = 0.20 / 0.40 = 0.50
const DEFAULT_CHAT_FEE_OF_REVENUE = 0.20

// ── Field IDs ───────────────────────────────────────────────────────────────

const INV_FIELDS = {
  creator: 'fldGggvFzR0zzl9p4',          // multipleRecordLinks → Creators
  earningsTR: 'fldUBcYSMy74lt9Xf',       // currency
  commissionSnap: 'fldeQoHxbYYWAnJYZ',   // percent (Snapshot)
  chatFeeSnap: 'fldO2YiCr4FWxn5rG',      // percent (Snapshot)
  periodStart: 'fldeucG0jEvjem841',      // date
  periodEnd: 'fldZhX5uMZjrAkAeP',        // date
  status: 'fldQEjYB0DxpNWxhU',           // singleSelect
  revenueAccount: 'fld6OleRMqVZJeE8f',   // multipleRecordLinks → Revenue Accounts
  accountNameLink: 'fldvQyOlJFfsWUODU',  // multipleRecordLinks → Revenue Accounts
  pdfAttachment: 'fldDrn5gbFp03ngNC',    // multipleAttachments
  commissionLookup: 'fldpZWDIqalRtHmas', // multipleLookupValues — Commission % from Creator
}
const RA_FIELDS = {
  accountName: 'fldkEi3jW9tUXSTc5',
  managementStart: 'fldkJVsyI43xkVGFT',
  creator: 'fldiO0GNTmM7XbL31',
}
const CR_FIELDS = {
  commissionPct: 'fldha0dCCEnSxJkti',
  managementStart: 'flddRQe5WGegIBomQ',
  managementTeam: 'fldtzIn9DjBkjtYwZ',
}

const atHeaders = () => ({
  Authorization: `Bearer ${process.env.AIRTABLE_PAT}`,
  'Content-Type': 'application/json',
})

// ── Sheets auth ─────────────────────────────────────────────────────────────

function getSheetsAuth() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  )
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })
  return oauth2
}

// ── Period earnings reader ──────────────────────────────────────────────────

function parseMoney(s) {
  if (!s) return 0
  return parseFloat(String(s).replace(/[$,]/g, '')) || 0
}

// Sheet timestamps are ET-naive (no Z). Parse as ET → return Date in UTC.
// Period end = 8 PM ET on the period end date (= midnight UTC = OF day boundary).
function parseSheetDateET(s) {
  if (!s) return null
  // Format: "YYYY-MM-DD HH:MM" or "YYYY-MM-DD"
  // Treat as ET (UTC-4 during EDT in April-October, UTC-5 in EST). For simplicity,
  // we just use the new Date() parser which treats no-Z strings as local server time.
  // On Vercel, server is UTC, so we manually shift: ET = UTC - 4 (EDT) or UTC - 5 (EST).
  // For April-October (which is what we care about for now) it's EDT = UTC-4.
  // Build a UTC date by shifting forward 4 hours.
  const [datePart, timePart = '00:00'] = s.split(' ')
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mm] = timePart.split(':').map(Number)
  if (!y || !m || !d) return null
  // EDT (Apr-Oct in 2026): ET = UTC - 4
  // The transaction happened at HH:MM ET → UTC = HH:MM + 4
  return new Date(Date.UTC(y, m - 1, d, hh + 4, mm))
}

/**
 * Fetch earnings totals for a single account, bounded by period.
 * Reads BOTH `{accountName} - Sales` AND `{accountName} - Chargebacks` tabs:
 *   - Sales tab: regular transactions; sometimes also has inline Chargeback rows
 *     (when the same upload mixed both)
 *   - Chargebacks tab: disputes uploaded separately from the OF disputes page
 * Chargeback rows have negative net values; we sum them as `chargebackNet`
 * (a negative number) and the caller adds it to `net` to get the final figure.
 * @returns {Promise<{gross, net, ofFee, txnCount, chargebackNet, chargebackCount, missingTab}>}
 */
async function getEarningsForPeriod(sheets, accountName, periodStartDt, periodEndDt) {
  let gross = 0, net = 0, ofFee = 0, txnCount = 0
  let chargebackNet = 0, chargebackCount = 0
  let salesTabExists = false

  const accumulate = (rows) => {
    for (const row of rows) {
      const [dateTime, g, fee, n, type] = row
      if (!dateTime) continue
      const dt = parseSheetDateET(dateTime)
      if (!dt) continue
      // Inclusive start, exclusive end → strict less-than on end
      if (dt < periodStartDt || dt >= periodEndDt) continue
      const isChargeback = type === 'Chargeback'
      if (isChargeback) {
        chargebackNet += parseMoney(n)
        chargebackCount++
      } else {
        gross += parseMoney(g)
        ofFee += parseMoney(fee)
        net += parseMoney(n)
        txnCount++
      }
    }
  }

  // Sales tab — required (a missing Sales tab means we have no earnings data at all)
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${accountName} - Sales'!A4:I`,
    })
    accumulate(res.data.values || [])
    salesTabExists = true
  } catch (err) {
    console.warn(`[refresh-period] Sales tab "${accountName} - Sales" missing:`, err.message)
  }

  // Chargebacks tab — optional (only present if disputes data was ever uploaded)
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${accountName} - Chargebacks'!A4:I`,
    })
    accumulate(res.data.values || [])
  } catch (err) {
    // Silently OK — most accounts won't have a Chargebacks tab unless disputes were uploaded
  }

  return { gross, net, ofFee, txnCount, chargebackNet, chargebackCount, missingTab: !salesTabExists }
}

// ── Airtable helpers ────────────────────────────────────────────────────────

async function fetchInvoicesForPeriod(periodStart, periodEnd) {
  // Period Start/End are date fields — use DATETIME_FORMAT to compare against a string date
  const formula = `AND(DATETIME_FORMAT({Period Start},'YYYY-MM-DD')='${periodStart}',DATETIME_FORMAT({Period End},'YYYY-MM-DD')='${periodEnd}')`
  const params = new URLSearchParams()
  params.set('filterByFormula', formula)
  params.set('returnFieldsByFieldId', 'true')
  params.set('pageSize', '100')
  // Request all the fields we need
  for (const f of Object.values(INV_FIELDS)) params.append('fields[]', f)
  // Also need the formula "Invoice" field to read account name
  params.append('fields[]', 'fldCimhMbOOeOQrFJ')
  params.append('fields[]', 'fld37wwgvM0znxDPa') // AKA from Creator

  const res = await fetch(`https://api.airtable.com/v0/${HQ_BASE}/${INVOICES_TABLE}?${params}`, {
    headers: atHeaders(), cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Airtable invoice list failed: ${res.status} ${text}`)
  }
  const data = await res.json()
  return data.records || []
}

async function fetchRevenueAccountsByIds(ids) {
  if (!ids || ids.length === 0) return {}
  const result = {}
  // Airtable formula limit ≈ 16k chars; batch in 10s to be safe
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10)
    const formula = 'OR(' + batch.map(id => `RECORD_ID()="${id}"`).join(',') + ')'
    const params = new URLSearchParams()
    params.set('filterByFormula', formula)
    params.set('returnFieldsByFieldId', 'true')
    params.set('pageSize', '20')
    for (const f of Object.values(RA_FIELDS)) params.append('fields[]', f)
    const res = await fetch(`https://api.airtable.com/v0/${HQ_BASE}/${REVENUE_ACCOUNTS_TABLE}?${params}`, {
      headers: atHeaders(), cache: 'no-store',
    })
    if (!res.ok) continue
    const data = await res.json()
    for (const rec of data.records || []) result[rec.id] = rec.fields
  }
  return result
}

async function fetchCreatorsByIds(ids) {
  if (!ids || ids.length === 0) return {}
  const result = {}
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10)
    const formula = 'OR(' + batch.map(id => `RECORD_ID()="${id}"`).join(',') + ')'
    const params = new URLSearchParams()
    params.set('filterByFormula', formula)
    params.set('returnFieldsByFieldId', 'true')
    params.set('pageSize', '20')
    for (const f of Object.values(CR_FIELDS)) params.append('fields[]', f)
    const res = await fetch(`https://api.airtable.com/v0/${HQ_BASE}/${CREATORS_TABLE}?${params}`, {
      headers: atHeaders(), cache: 'no-store',
    })
    if (!res.ok) continue
    const data = await res.json()
    for (const rec of data.records || []) result[rec.id] = rec.fields
  }
  return result
}

async function patchInvoice(invoiceId, fields) {
  const res = await fetch(`https://api.airtable.com/v0/${HQ_BASE}/${INVOICES_TABLE}/${invoiceId}`, {
    method: 'PATCH',
    headers: atHeaders(),
    body: JSON.stringify({ fields }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Patch invoice ${invoiceId} failed: ${res.status} ${text}`)
  }
  return res.json()
}

// ── POST handler ────────────────────────────────────────────────────────────

export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  let body
  try { body = await request.json() } catch { body = {} }
  const { periodStart, periodEnd, dryRun = false } = body

  if (!periodStart || !periodEnd) {
    return Response.json({ error: 'periodStart and periodEnd required (YYYY-MM-DD)' }, { status: 400 })
  }

  // Retroactive guard — never touch periods before automation cutover
  if (periodEnd < AUTOMATION_START) {
    return Response.json({
      error: `Period ended ${periodEnd} which is before automation cutover ${AUTOMATION_START}. Refusing to operate on historic data.`,
    }, { status: 400 })
  }

  try {
    // 1. Find all invoice rows for this period
    const invoices = await fetchInvoicesForPeriod(periodStart, periodEnd)
    if (invoices.length === 0) {
      return Response.json({ error: `No invoice rows found for period ${periodStart} to ${periodEnd}` }, { status: 404 })
    }

    // 2. Filter out invoices that already have PDFs attached (immutable once finalized)
    const eligible = invoices.filter(inv => {
      const atts = inv.fields[INV_FIELDS.pdfAttachment] || []
      return atts.length === 0
    })
    const skippedPdf = invoices.length - eligible.length

    if (eligible.length === 0) {
      return Response.json({
        message: `All ${invoices.length} invoices already have PDFs attached. Nothing to refresh.`,
        skippedPdf, populated: 0,
      })
    }

    // 3. Resolve linked Revenue Accounts and Creators in bulk
    const accountIds = new Set()
    const creatorIds = new Set()
    for (const inv of eligible) {
      const accLink = inv.fields[INV_FIELDS.revenueAccount] || inv.fields[INV_FIELDS.accountNameLink] || []
      accLink.forEach(id => accountIds.add(id))
      const cLink = inv.fields[INV_FIELDS.creator] || []
      cLink.forEach(id => creatorIds.add(id))
    }
    const accountsById = await fetchRevenueAccountsByIds([...accountIds])
    const creatorsById = await fetchCreatorsByIds([...creatorIds])

    // 4. Build period-end UTC boundary (8 PM ET on period end date = midnight UTC next day)
    // Period is INCLUSIVE on both ends in human terms. So Apr 30 end = transactions through
    // Apr 30 8 PM ET. Convert to UTC: that's May 1 00:00 UTC.
    const [pyEnd, pmEnd, pdEnd] = periodEnd.split('-').map(Number)
    const periodEndUTC = new Date(Date.UTC(pyEnd, pmEnd - 1, pdEnd, 24, 0)) // = next-day midnight UTC = 8 PM ET on periodEnd

    // 5. Fetch sheet auth once
    const sheetsClient = google.sheets({ version: 'v4', auth: getSheetsAuth() })

    // 6. Process each eligible invoice
    const results = []
    for (const inv of eligible) {
      const f = inv.fields
      const accLink = f[INV_FIELDS.revenueAccount] || f[INV_FIELDS.accountNameLink] || []
      const accountId = accLink[0]
      const creatorLink = f[INV_FIELDS.creator] || []
      const creatorId = creatorLink[0]
      const aka = (f['fld37wwgvM0znxDPa'] || [])[0] || ''

      if (!accountId) {
        results.push({ id: inv.id, aka, error: 'No linked Revenue Account', updated: false })
        continue
      }

      const account = accountsById[accountId]
      const creator = creatorId ? creatorsById[creatorId] : null
      if (!account) {
        results.push({ id: inv.id, aka, error: 'Revenue Account record not found', updated: false })
        continue
      }

      const accountName = account[RA_FIELDS.accountName] || ''
      const accountStart = account[RA_FIELDS.managementStart] || creator?.[CR_FIELDS.managementStart] || null

      // Period start = max(periodStart, account managementStart)
      // Both are date-only; convert to UTC at 8 PM ET of (date - 1 day) = midnight UTC of date - 4h
      // Actually, OF day starts at 8 PM ET = midnight UTC. So Apr 15 starts at Apr 14 8 PM ET = Apr 15 00:00 UTC.
      const effectiveStartDate = accountStart && accountStart > periodStart ? accountStart : periodStart
      const [psy, psm, psd] = effectiveStartDate.split('-').map(Number)
      const periodStartUTC = new Date(Date.UTC(psy, psm - 1, psd, 0, 0)) // midnight UTC = 8 PM ET previous day

      // Skip if account onboarded after period end
      if (effectiveStartDate > periodEnd) {
        results.push({
          id: inv.id, aka, accountName,
          warning: `Account managed start (${effectiveStartDate}) is after period end — skipping`,
          updated: false,
        })
        continue
      }

      const earnings = await getEarningsForPeriod(sheetsClient, accountName, periodStartUTC, periodEndUTC)

      const commissionPct = creator?.[CR_FIELDS.commissionPct] || null

      // Build patch fields
      const patchFields = {}
      // Net revenue (after OF fees, after chargeback deductions)
      const finalNet = earnings.net + earnings.chargebackNet
      patchFields[INV_FIELDS.earningsTR] = Number(finalNet.toFixed(2))

      // Snapshot commission % if creator has one and not already set
      const existingCommSnap = f[INV_FIELDS.commissionSnap]
      const effectiveCommissionPct = (existingCommSnap != null && existingCommSnap > 0) ? existingCommSnap : commissionPct
      if (commissionPct != null && (existingCommSnap == null || existingCommSnap === 0)) {
        patchFields[INV_FIELDS.commissionSnap] = commissionPct
      }

      // Snapshot chat team fee % if not already set. Stored as % of commission.
      // Default = 20% of revenue → snap = 0.20 / commissionPct.
      const existingChatSnap = f[INV_FIELDS.chatFeeSnap]
      if (effectiveCommissionPct && effectiveCommissionPct > 0
          && (existingChatSnap == null || existingChatSnap === 0)) {
        patchFields[INV_FIELDS.chatFeeSnap] = DEFAULT_CHAT_FEE_OF_REVENUE / effectiveCommissionPct
      }

      if (dryRun) {
        results.push({
          id: inv.id, aka, accountName, dryRun: true,
          effectiveStartDate, periodEnd,
          earningsNet: Number(finalNet.toFixed(2)),
          earningsGross: Number(earnings.gross.toFixed(2)),
          ofFee: Number(earnings.ofFee.toFixed(2)),
          chargebackNet: Number(earnings.chargebackNet.toFixed(2)),
          chargebackCount: earnings.chargebackCount,
          txnCount: earnings.txnCount,
          missingTab: earnings.missingTab,
          commissionPct,
          wouldSetCommissionSnapshot: patchFields[INV_FIELDS.commissionSnap] != null,
          wouldSetChatFeeSnapshot: patchFields[INV_FIELDS.chatFeeSnap] != null,
          chatFeeSnap: patchFields[INV_FIELDS.chatFeeSnap] || null,
        })
        continue
      }

      try {
        await patchInvoice(inv.id, patchFields)
        results.push({
          id: inv.id, aka, accountName,
          effectiveStartDate, periodEnd,
          earningsNet: Number(finalNet.toFixed(2)),
          earningsGross: Number(earnings.gross.toFixed(2)),
          chargebackNet: Number(earnings.chargebackNet.toFixed(2)),
          txnCount: earnings.txnCount,
          missingTab: earnings.missingTab,
          updated: true,
        })
      } catch (err) {
        results.push({ id: inv.id, aka, accountName, error: err.message, updated: false })
      }
    }

    const populated = results.filter(r => r.updated).length
    const errors = results.filter(r => r.error).length

    return Response.json({
      ok: true,
      periodStart, periodEnd,
      total: invoices.length,
      skippedPdf,
      eligible: eligible.length,
      populated,
      errors,
      dryRun,
      results,
    })
  } catch (err) {
    console.error('refresh-period error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
