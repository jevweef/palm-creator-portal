import { auth } from '@clerk/nextjs/server'
import { google } from 'googleapis'

// ── HTML Parser — extracts transactions from saved OF statements page ───────

function parseHtml(html) {
  const txns = []
  // Each transaction is a <tr> with class "b-table__date" in the first <td>
  const rows = html.match(/<tr><td class="b-table__date">(.*?)<\/tr>/gs) || []

  for (const row of rows) {
    // Date & time
    const dateM = row.match(/b-table__date__date.*?<span[^>]*>\s*([^<]+?)\s*<\/span>/)
    const timeM = row.match(/b-table__date__time.*?<span[^>]*>\s*([^<]+?)\s*<\/span>/)
    // Amounts
    const amountM = row.match(/data-title="Amount".*?\$([\d,.]+)/)
    const feeM = row.match(/data-title="Fee".*?\$([\d,.]+)/)
    const netM = row.match(/data-title="Net".*?\$([\d,.]+)/)

    if (!dateM || !timeM || !amountM || !feeM || !netM) continue

    // Description — two patterns: <a href> (has username) or <span> (deleted account)
    let type = '', username = '', displayName = ''
    const linkM = row.match(/(Tip|Recurring subscription|Subscription|Payment for message|Referral bonus|Stream)\s+from\s+<a href="https:\/\/onlyfans\.com\/([^"]+)">([^<]+)<\/a>/)
    const spanM = row.match(/(Tip|Recurring subscription|Subscription|Payment for message|Referral bonus|Stream)\s+from\s+<span>([^<]+)<\/span>/)

    if (linkM) {
      type = linkM[1]
      username = linkM[2]
      displayName = linkM[3].trim()
    } else if (spanM) {
      type = spanM[1]
      username = ''
      displayName = spanM[2].trim()
    }

    const dt = parseDate(dateM[1].trim(), timeM[1].trim())

    txns.push({
      dt,
      gross: parseMoney(amountM[1]),
      of_fee: parseMoney(feeM[1]),
      net: parseMoney(netM[1]),
      type,
      username,
      displayName,
      fan: displayName,
      desc: type ? `${type} from ${displayName}` : '',
      origDate: null,
    })
  }

  return txns
}

function parseChargebackHtml(html) {
  const txns = []
  // Chargeback rows from the disputes page — different structure than earnings
  const rows = html.match(/<tr class="m-responsive__reset-pb">(.*?)<\/tr>/gs) || []

  for (const row of rows) {
    // Dispute date & time (first <strong> block)
    const disputeM = row.match(/<td[^>]*><strong>\s*([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})\s*<br>\s*(\d{1,2}:\d{2}\s*[ap]m)\s*<\/strong>/)
    if (!disputeM) continue

    // Payment date (second <td>)
    const payDateM = row.match(/<\/td>\s*<td[^>]*>\s*([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})\s*<br>\s*(\d{1,2}:\d{2}\s*[ap]m)/)

    // Amounts — three dollar amounts: gross, fee, net
    const amountMatches = [...row.matchAll(/\$\s*([\d,]+\.\d{2})/g)]
    if (amountMatches.length < 3) continue

    const gross = parseMoney(amountMatches[0][1])
    const fee = parseMoney(amountMatches[1][1])
    const net = parseMoney(amountMatches[2][1])

    // Description — type + username
    let type = '', username = '', displayName = ''
    const linkM = row.match(/(Subscription|Payment for message|Tip|Recurring subscription|Stream)\s+from\s+<a[^>]*>([^<]+)<\/a>/)
    const spanM = row.match(/(Subscription|Payment for message|Tip|Recurring subscription|Stream)\s+from\s+<span>([^<]+)<\/span>/)

    if (linkM) {
      type = linkM[1]
      displayName = linkM[2].trim()
      const urlM = row.match(/href="https:\/\/onlyfans\.com\/([^"]+)"/)
      username = urlM ? urlM[1] : ''
    } else if (spanM) {
      type = spanM[1]
      displayName = spanM[2].trim()
    }

    // Use payment date as the original transaction date (for chargeback matching)
    const origDate = payDateM ? parseDate(payDateM[1].trim(), payDateM[2].trim()) : null
    const dt = parseDate(disputeM[1].trim(), disputeM[2].trim())

    txns.push({
      dt,
      gross: -gross,  // Chargebacks are negative
      of_fee: -fee,
      net: -net,
      type: 'Chargeback',
      username,
      displayName,
      fan: displayName,
      desc: `Chargeback: ${type} from ${displayName}`,
      origDate,
    })
  }

  return txns
}

// ── Text parsers (for raw paste fallback) ───────────────────────────────────

const SALES_RE = /^(\w{3}\s+\d{1,2},\s+\d{4})(\d{1,2}:\d{2}\s*[ap]m)\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})/
const DATE_RE = /^(\w{3}\s+\d{1,2},\s+\d{4})$/
const TIME_RE = /^(\d{1,2}:\d{2}\s*[ap]m)$/
const AMOUNT_RE = /^\$?([\d,]+\.\d{2})$/
const DESC_RE = /^(Tip|Subscription|Payment for message|Chargeback|Referral bonus|Stream|Post)(?:\s+from\s+(.+))?$/i

function parseSales(lines) {
  const txns = []
  let i = 0
  while (i < lines.length) {
    const m = lines[i].match(SALES_RE)
    if (m) {
      const dt = parseDate(m[1], m[2])
      const gross = parseMoney(m[3])
      const of_fee = parseMoney(m[4])
      const net = parseMoney(m[5])
      let desc = '', type = '', fan = ''
      if (i + 1 < lines.length && !SALES_RE.test(lines[i + 1])) {
        desc = lines[i + 1]
        const parsed = parseDesc(desc)
        type = parsed.type; fan = parsed.fan
        i++
      }
      txns.push({ dt, gross, of_fee, net, type, username: '', displayName: fan, fan, desc, origDate: null })
      i++
    } else { i++ }
  }
  return txns
}

function parseChargebacks(lines) {
  const txns = []
  let i = 0
  while (i < lines.length) {
    const dm = lines[i].match(DATE_RE)
    if (!dm) { i++; continue }
    if (i + 7 > lines.length) { i++; continue }
    const cbTimeM = lines[i+1].match(TIME_RE)
    const origDateM = lines[i+2].match(DATE_RE)
    const origTimeM = lines[i+3].match(TIME_RE)
    const grossM = lines[i+4].match(AMOUNT_RE)
    const feeM = lines[i+5].match(AMOUNT_RE)
    const netM = lines[i+6].match(AMOUNT_RE)
    if (!cbTimeM || !origDateM || !origTimeM || !grossM || !feeM || !netM) { i++; continue }
    const cbDt = parseDate(dm[1], cbTimeM[1])
    const origDt = parseDate(origDateM[1], origTimeM[1])
    const gross = parseMoney(grossM[1])
    const of_fee = parseMoney(feeM[1])
    const net = parseMoney(netM[1])
    let desc = '', type = 'Chargeback', fan = ''
    if (i + 7 < lines.length && !lines[i+7].match(DATE_RE)) {
      desc = lines[i + 7]
      const parsed = parseDesc(desc)
      type = parsed.type ? `Chargeback (${parsed.type})` : 'Chargeback'
      fan = parsed.fan
      i += 8
    } else { i += 7 }
    txns.push({ dt: cbDt, gross, of_fee, net, type, username: '', displayName: fan, fan, desc, origDate: origDt })
  }
  return txns
}

function detectFormat(lines) {
  for (const line of lines.slice(0, 10)) {
    if (SALES_RE.test(line)) return 'sales'
  }
  for (let i = 0; i < Math.min(5, lines.length - 1); i++) {
    if (DATE_RE.test(lines[i]) && TIME_RE.test(lines[i + 1])) return 'chargebacks'
  }
  return 'sales'
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function parseMoney(s) { return parseFloat(s.replace(/,/g, '')) }

function parseDate(dateStr, timeStr) {
  const months = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 }
  const dm = dateStr.trim().match(/(\w{3})\s+(\d{1,2}),\s+(\d{4})/)
  if (!dm) return null
  const tm = timeStr.trim().match(/(\d{1,2}):(\d{2})\s*([ap]m)/i)
  if (!tm) return null
  let hour = parseInt(tm[1])
  const min = parseInt(tm[2])
  const ampm = tm[3].toLowerCase()
  if (ampm === 'pm' && hour !== 12) hour += 12
  if (ampm === 'am' && hour === 12) hour = 0
  return new Date(parseInt(dm[3]), months[dm[1]], parseInt(dm[2]), hour, min)
}

function fmtDate(d) {
  const yyyy = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mo}-${dd}`
}
function fmtTime(d) { return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) }
// Combined 24h datetime for sorted column: "2026-04-07 15:47"
function fmtDateTime(d) {
  const yyyy = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mo}-${dd} ${hh}:${mm}`
}

function parseDesc(desc) {
  const m = desc.match(DESC_RE)
  if (m) return { type: m[1], fan: (m[2] || '').trim() }
  return { type: desc, fan: '' }
}

// ── Google Sheets helpers ───────────────────────────────────────────────────

function getAuth() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  )
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })
  return oauth2
}

const HEADER_ROW = ['DateTime', 'Gross', 'OF Fee', 'Net', 'Type',
                    'Display Name', 'OF Username', 'Original Date', 'Description']
const SPREADSHEET_ID = process.env.OF_TRANSACTIONS_SPREADSHEET_ID

async function getOrCreateTab(sheets, creator, dataType) {
  const tabName = `${creator} - ${dataType}`
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID })
  const existing = spreadsheet.data.sheets.find(s => s.properties.title === tabName)

  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title: tabName } } }] }
    })
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        valueInputOption: 'RAW',
        data: [
          { range: `'${tabName}'!A1`, values: [['⏳ No data uploaded yet — upload your first file!']] },
          { range: `'${tabName}'!A3`, values: [HEADER_ROW] },
        ]
      }
    })
  }
  return tabName
}

async function getCutoff(sheets, tabName) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tabName}'!A4:A10000`,
    })
    const rows = res.data.values || []
    if (rows.length === 0) return null
    let latest = null
    for (const [dateTimeStr] of rows) {
      if (!dateTimeStr) continue
      try {
        // Handle both new format "2026-04-07 15:47" and legacy "2026-04-07"
        const dt = new Date(dateTimeStr.includes(' ') ? dateTimeStr.replace(' ', 'T') + ':00' : dateTimeStr)
        if (!isNaN(dt) && (!latest || dt > latest)) latest = dt
      } catch {}
    }
    return latest
  } catch { return null }
}

// Build a fingerprint for a transaction row: datetime|net|fan
function txnFingerprint(dateTime, _unused, net, fan) {
  return `${(dateTime || '').trim()}|${String(net).trim()}|${(fan || '').trim()}`
}

// Get the last N rows from the sheet for overlap matching
async function getLastRows(sheets, tabName, count = 50) {
  try {
    const colRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID, range: `'${tabName}'!A:A`,
    })
    const totalRows = colRes.data.values?.length || 3
    if (totalRows <= 3) return [] // only header rows
    const startRow = Math.max(4, totalRows - count + 1)
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tabName}'!A${startRow}:I${totalRows}`,
    })
    return (res.data.values || []).map(row => ({
      dateTime: row[0] || '', gross: row[1] || '',
      ofFee: row[2] || '', net: row[3] || '', type: row[4] || '',
      displayName: row[5] || '', username: row[6] || '',
      fingerprint: txnFingerprint(row[0], '', row[3], row[5]),
    }))
  } catch { return [] }
}

async function updateCutoff(sheets, tabName, cutoffDt) {
  const notice = cutoffDt
    ? `⚠️  ONLY UPLOAD SALES AFTER: ${cutoffDt.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`
    : '⏳ No data uploaded yet — upload your first file!'
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabName}'!A1`,
    valueInputOption: 'RAW',
    resource: { values: [[notice]] },
  })
}

// ── Airtable coverage update ───────────────────────────────────────────────

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const HQ_BASE = 'appL7c4Wtotpz07KS'
const HQ_CREATORS_TABLE = 'tblYhkNvrNuOAHfgw'
const AT_FIELDS = {
  aka: 'fldi2BNvf928yVuZx',
  earningsStart: 'fldiMIvM5hf2MNzck',
  earningsEnd: 'fld6n02I6LXpaAQMC',
  chargebackStart: 'fldnl6I0NQm3LohCJ',
  chargebackEnd: 'fldw4KB1rCJULWje1',
  earningsLastUpload: 'fldbBT5iNJU8bEREk',
  chargebacksLastUpload: 'fldbcQzv0Bhf3Ys8a',
}

async function updateAirtableCoverage(creatorName, sheetType, txns, fileTimestamp) {
  if (!AIRTABLE_PAT) return

  try {
    // Find dates from transactions (may be empty if all skipped)
    const dates = (txns || []).filter(t => t.dt).map(t => t.dt).sort((a, b) => a - b)
    const earliest = dates.length > 0 ? dates[0] : null
    const earliestStr = earliest ? fmtDate(earliest) : null

    // Look up creator by AKA
    const params = new URLSearchParams()
    params.append('filterByFormula', `{AKA}="${creatorName}"`)
    params.append('fields[]', AT_FIELDS.aka)
    params.append('fields[]', AT_FIELDS.earningsStart)
    params.append('fields[]', AT_FIELDS.earningsEnd)
    params.append('fields[]', AT_FIELDS.chargebackStart)
    params.append('fields[]', AT_FIELDS.chargebackEnd)
    params.append('returnFieldsByFieldId', 'true')
    params.append('pageSize', '1')

    const searchRes = await fetch(
      `https://api.airtable.com/v0/${HQ_BASE}/${HQ_CREATORS_TABLE}?${params}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } }
    )
    if (!searchRes.ok) return
    const searchData = await searchRes.json()
    const record = searchData.records?.[0]
    if (!record) return

    const fields = {}
    const isSales = sheetType === 'Sales'

    // Use the file's last modified timestamp as the coverage cutoff
    // That's when the HTML was saved — the actual line in the sand
    const coverageDate = fileTimestamp ? new Date(fileTimestamp) : new Date()
    const coverageISO = coverageDate.toISOString()
    const coverageDateStr = coverageISO.split('T')[0]

    if (isSales) {
      // Always update the end date and timestamp — even if no new transactions
      fields[AT_FIELDS.earningsEnd] = coverageDateStr
      fields[AT_FIELDS.earningsLastUpload] = coverageISO
      if (earliestStr) {
        const currentStart = record.fields[AT_FIELDS.earningsStart]
        if (!currentStart || earliestStr < currentStart) {
          fields[AT_FIELDS.earningsStart] = earliestStr
        }
      }
    } else {
      fields[AT_FIELDS.chargebackEnd] = coverageDateStr
      fields[AT_FIELDS.chargebacksLastUpload] = coverageISO
      if (earliestStr) {
        const currentStart = record.fields[AT_FIELDS.chargebackStart]
        if (!currentStart || earliestStr < currentStart) {
          fields[AT_FIELDS.chargebackStart] = earliestStr
        }
      }
    }

    await fetch(
      `https://api.airtable.com/v0/${HQ_BASE}/${HQ_CREATORS_TABLE}/${record.id}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${AIRTABLE_PAT}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields }),
      }
    )
  } catch (err) {
    // Non-blocking — log but don't fail the upload
    console.error('Airtable coverage update error:', err)
  }
}

// ── POST: upload transactions ───────────────────────────────────────────────

export async function POST(request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const contentType = request.headers.get('content-type') || ''
  let txns, creator, sheetType, fileTimestamp

  if (contentType.includes('multipart/form-data')) {
    // HTML file upload
    const formData = await request.formData()
    const file = formData.get('file')
    creator = formData.get('creator')
    if (!file || !creator) return Response.json({ error: 'Missing file or creator' }, { status: 400 })

    const html = await file.text()
    const formDataType = formData.get('dataType')
    // Auto-detect page type from HTML, or use the explicit dataType from the modal
    const isDisputesPage = html.includes('statements/disputes') || html.includes('Dispute date')
    if (isDisputesPage || formDataType === 'chargebacks') {
      txns = parseChargebackHtml(html)
      sheetType = 'Chargebacks'
    } else {
      txns = parseHtml(html)
      sheetType = 'Sales'
    }
    // File's last modified timestamp — when the HTML was saved on disk
    const fileLastModified = formData.get('fileLastModified')
    fileTimestamp = fileLastModified ? Number(fileLastModified) : (file.lastModified || null)
  } else {
    // JSON body — raw text paste (legacy fallback)
    const { rawData, creator: c, dataType } = await request.json()
    creator = c
    if (!rawData || !creator) return Response.json({ error: 'Missing rawData or creator' }, { status: 400 })

    const lines = rawData.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) return Response.json({ error: 'No data to parse' }, { status: 400 })

    const fmt = dataType === 'chargebacks' ? 'chargebacks'
      : dataType === 'sales' ? 'sales'
      : detectFormat(lines)

    txns = fmt === 'chargebacks' ? parseChargebacks(lines) : parseSales(lines)
    sheetType = fmt === 'chargebacks' ? 'Chargebacks' : 'Sales'
  }

  if (!txns || txns.length === 0) {
    // No transactions found — but still update coverage timestamp
    // (e.g. chargeback page with "No data during selected period" is still valid data)
    await updateAirtableCoverage(creator, sheetType, [], fileTimestamp)
    return Response.json({
      message: `No ${sheetType === 'Chargebacks' ? 'chargebacks' : 'transactions'} found — coverage timestamp updated.`,
      parsed: 0, skipped: 0, uploaded: 0, overlapMethod: 'none',
    })
  }

  // Push to Google Sheets
  try {
    const authClient = getAuth()
    const sheets = google.sheets({ version: 'v4', auth: authClient })
    const tabName = await getOrCreateTab(sheets, creator, sheetType)

    // Overlap-based dedup: fetch last rows from sheet, find the match point
    // in the new data, only append everything after it
    const existingRows = await getLastRows(sheets, tabName, 50)
    let filtered = txns
    let skipped = 0
    let overlapMethod = 'none'

    if (existingRows.length > 0) {
      // Build fingerprint set from existing sheet rows
      const existingFingerprints = new Set(existingRows.map(r => r.fingerprint))

      // Build fingerprints for new transactions
      const newWithFp = txns.map(t => ({
        ...t,
        fingerprint: txnFingerprint(
          t.dt ? fmtDateTime(t.dt) : '',
          '',
          t.net,
          t.displayName || t.fan
        ),
      }))

      // Strategy: find the LAST matching transaction in the new data
      // (the overlap point), then take everything after it
      let lastMatchIdx = -1
      for (let i = 0; i < newWithFp.length; i++) {
        if (existingFingerprints.has(newWithFp[i].fingerprint)) {
          lastMatchIdx = i
        }
      }

      if (lastMatchIdx >= 0) {
        // Found overlap — take everything after the last match
        overlapMethod = 'fingerprint'
        skipped = lastMatchIdx + 1
        filtered = txns.slice(lastMatchIdx + 1)
      } else {
        // No overlap found — fall back to timestamp cutoff to avoid dupes
        const cutoff = await getCutoff(sheets, tabName)
        if (cutoff) {
          overlapMethod = 'cutoff_fallback'
          filtered = txns.filter(t => {
            if (t.dt && t.dt <= cutoff) { skipped++; return false }
            return true
          })
        }
        // If no cutoff either, append everything (first upload or gap fill)
      }
    }

    if (filtered.length === 0) {
      // Still update the coverage timestamp even though no new rows
      await updateAirtableCoverage(creator, sheetType, txns, fileTimestamp)
      return Response.json({
        message: `All ${txns.length} transactions already exist in the sheet — nothing new to upload.`,
        parsed: txns.length, skipped: txns.length, uploaded: 0, overlapMethod,
      })
    }

    // Convert to rows — combined datetime, 9 columns
    // Sort newest first so inserted rows maintain descending order
    const sortedFiltered = [...filtered].sort((a, b) => (b.dt || 0) - (a.dt || 0))
    const rows = sortedFiltered.map(t => [
      t.dt ? fmtDateTime(t.dt) : '',
      t.gross,
      t.of_fee,
      t.net,
      t.type,
      t.displayName || t.fan,
      t.username || '',
      t.origDate ? fmtDate(t.origDate) : '',
      t.desc,
    ])

    // Insert new rows at top (row 4, right after headers) so newest data is always first
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID })
    const sheetMeta = spreadsheet.data.sheets.find(s => s.properties.title === tabName)
    const sheetId = sheetMeta?.properties?.sheetId

    // First, insert blank rows at position 4 to make room
    if (sheetId !== undefined) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          requests: [{
            insertDimension: {
              range: { sheetId, dimension: 'ROWS', startIndex: 3, endIndex: 3 + rows.length },
              inheritFromBefore: false,
            }
          }]
        }
      })
    }

    // Write the new rows starting at row 4
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tabName}'!A4`,
      valueInputOption: 'RAW',
      resource: { values: rows },
    })

    // Update cutoff — find the latest timestamp across all sheet data + new rows
    let newCutoff = null
    // Check existing rows for latest date
    for (const r of existingRows) {
      try {
        if (!r.dateTime) continue
        const dt = new Date(r.dateTime.replace(' ', 'T') + ':00')
        if (!isNaN(dt) && (!newCutoff || dt > newCutoff)) newCutoff = dt
      } catch {}
    }
    // Check new rows
    for (const t of filtered) {
      if (t.dt && (!newCutoff || t.dt > newCutoff)) newCutoff = t.dt
    }
    await updateCutoff(sheets, tabName, newCutoff)

    // Update Airtable coverage dates (non-blocking)
    await updateAirtableCoverage(creator, sheetType, txns, fileTimestamp)

    // Build summary
    const typeBreakdown = {}
    const fanTotals = {}
    let totalGross = 0, totalNet = 0
    for (const t of filtered) {
      typeBreakdown[t.type || 'Unknown'] = (typeBreakdown[t.type || 'Unknown'] || 0) + t.net
      const fan = t.displayName || t.fan || 'Unknown'
      fanTotals[fan] = (fanTotals[fan] || 0) + t.net
      totalGross += t.gross
      totalNet += t.net
    }
    const topFans = Object.entries(fanTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, total]) => ({ name, total }))

    const withUsernames = filtered.filter(t => t.username).length

    return Response.json({
      message: `Uploaded ${filtered.length} transactions to "${tabName}"`,
      parsed: txns.length, skipped, uploaded: filtered.length,
      withUsernames, overlapMethod,
      totalGross, totalNet, typeBreakdown, topFans,
      cutoff: newCutoff?.toISOString(),
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`,
    })
  } catch (err) {
    console.error('Google Sheets error:', err)
    return Response.json({ error: 'Failed to push to Google Sheets: ' + err.message }, { status: 500 })
  }
}

// GET: return cutoff info for each creator tab
export async function GET(request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const authClient = getAuth()
    const sheets = google.sheets({ version: 'v4', auth: authClient })
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID })
    const tabs = spreadsheet.data.sheets.map(s => s.properties.title).filter(t => t.includes(' - '))

    const cutoffs = {}
    const ranges = {}
    for (const tabName of tabs) {
      const cutoff = await getCutoff(sheets, tabName)
      cutoffs[tabName] = cutoff?.toISOString() || null
      // Get all dates from column A to find the full range
      try {
        const allDates = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `'${tabName}'!A4:A`,
        })
        const dateVals = (allDates.data.values || []).map(r => r[0]?.split(' ')[0]).filter(Boolean)
        if (dateVals.length > 0) {
          const sorted = [...dateVals].sort()
          ranges[tabName] = { earliest: sorted[0], latest: sorted[sorted.length - 1], rowCount: dateVals.length }
        }
      } catch (_) {}
    }

    return Response.json({
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`,
      tabs: cutoffs,
      ranges,
    })
  } catch (err) {
    console.error('Google Sheets error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
