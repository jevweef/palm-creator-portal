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
    const linkM = row.match(/(Tip|Subscription|Payment for message|Referral bonus|Stream)\s+from\s+<a href="https:\/\/onlyfans\.com\/([^"]+)">([^<]+)<\/a>/)
    const spanM = row.match(/(Tip|Subscription|Payment for message|Referral bonus|Stream)\s+from\s+<span>([^<]+)<\/span>/)

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

function fmtDate(d) { return d.toISOString().split('T')[0] }
function fmtTime(d) { return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) }

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

const HEADER_ROW = ['Date', 'Time', 'Gross', 'OF Fee', 'Net', 'Type',
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
      range: `'${tabName}'!A4:B10000`,
    })
    const rows = res.data.values || []
    if (rows.length === 0) return null
    let latest = null
    for (const [dateStr, timeStr] of rows) {
      if (!dateStr) continue
      try {
        const dt = new Date(`${dateStr} ${timeStr || '12:00 AM'}`)
        if (!latest || dt > latest) latest = dt
      } catch {}
    }
    return latest
  } catch { return null }
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

// ── POST: upload transactions ───────────────────────────────────────────────

export async function POST(request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const contentType = request.headers.get('content-type') || ''
  let txns, creator, sheetType

  if (contentType.includes('multipart/form-data')) {
    // HTML file upload
    const formData = await request.formData()
    const file = formData.get('file')
    creator = formData.get('creator')
    if (!file || !creator) return Response.json({ error: 'Missing file or creator' }, { status: 400 })

    const html = await file.text()
    txns = parseHtml(html)
    sheetType = 'Sales' // HTML is always the earnings/statements page
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
    return Response.json({ error: 'Could not parse any transactions from the uploaded data' }, { status: 400 })
  }

  // Push to Google Sheets
  try {
    const authClient = getAuth()
    const sheets = google.sheets({ version: 'v4', auth: authClient })
    const tabName = await getOrCreateTab(sheets, creator, sheetType)

    // Check cutoff and filter duplicates
    const cutoff = await getCutoff(sheets, tabName)
    let filtered = txns
    let skipped = 0
    if (cutoff) {
      filtered = txns.filter(t => {
        if (t.dt && t.dt <= cutoff) { skipped++; return false }
        return true
      })
    }

    if (filtered.length === 0) {
      return Response.json({
        message: `All ${txns.length} transactions are before the cutoff — nothing new to upload.`,
        cutoff: cutoff?.toISOString(), parsed: txns.length, skipped: txns.length, uploaded: 0,
      })
    }

    // Convert to rows — now includes username column
    const rows = filtered.map(t => [
      t.dt ? fmtDate(t.dt) : '',
      t.dt ? fmtTime(t.dt) : '',
      t.gross,
      t.of_fee,
      t.net,
      t.type,
      t.displayName || t.fan,
      t.username || '',
      t.origDate ? fmtDate(t.origDate) : '',
      t.desc,
    ])

    // Find next empty row
    let nextRow = 4
    try {
      const existing = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID, range: `'${tabName}'!A:A`,
      })
      nextRow = Math.max(4, (existing.data.values?.length || 3) + 1)
    } catch {}

    // Append rows
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tabName}'!A${nextRow}`,
      valueInputOption: 'RAW',
      resource: { values: rows },
    })

    // Update cutoff
    let newCutoff = cutoff
    for (const t of filtered) {
      if (t.dt && (!newCutoff || t.dt > newCutoff)) newCutoff = t.dt
    }
    await updateCutoff(sheets, tabName, newCutoff)

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
      withUsernames,
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
    for (const tabName of tabs) {
      const cutoff = await getCutoff(sheets, tabName)
      cutoffs[tabName] = cutoff?.toISOString() || null
    }

    return Response.json({
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`,
      tabs: cutoffs,
    })
  } catch (err) {
    console.error('Google Sheets error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
