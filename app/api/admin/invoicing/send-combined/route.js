import { requireAdmin } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId } from '@/lib/dropbox'

const HQ_BASE = 'appL7c4Wtotpz07KS'
const INVOICES_TABLE = 'tblKbU8VkdlOHXoJj'
const CREATORS_TABLE = 'tblYhkNvrNuOAHfgw'

// Download a file from the team Dropbox namespace using the authenticated API.
// Way more reliable than fetching a public ?dl=1 share URL, which sometimes returns
// an HTML consent/landing page instead of the raw PDF bytes (the root cause of
// Gmail's "Couldn't preview file" errors — the attachment isn't actually a PDF).
async function downloadInvoicePdfFromDropbox(token, rootId, dropboxPath) {
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath }),
      'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root: rootId }),
    },
  })
  if (!res.ok) throw new Error(`Dropbox download failed for ${dropboxPath}: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

// Compute the canonical team-namespace path for an invoice PDF.
// Must match the layout set in `/api/admin/invoicing/generate`:
//   /Palm Ops/Invoices/{periodStart} to {periodEnd}/{AKA} - {period} - {invoice#}.pdf
// Don't parse the Dropbox share URL — it mangles the filename (spaces → dashes) and
// can't be round-tripped back to the real path.
function dropboxInvoicePath({ aka, periodStart, periodEnd, invoiceNumber }) {
  if (!aka || !periodStart || !periodEnd || !invoiceNumber) return null
  const periodPart = `${periodStart} to ${periodEnd}`
  const filename = `${aka} - ${periodPart} - ${invoiceNumber}.pdf`
  return { path: `/Palm Ops/Invoices/${periodPart}/${filename}`, filename }
}

const atHeaders = () => ({
  Authorization: `Bearer ${process.env.AIRTABLE_PAT}`,
  'Content-Type': 'application/json',
})

// Find this creator's previous pay period total revenue so the email tone can adapt
// (only show "great work" language when earnings went up).
async function fetchPreviousPeriodTotal(aka, currentPeriodStart) {
  if (!aka || !currentPeriodStart) return null
  // Pull this creator's invoices ending strictly before the current period start,
  // sorted descending by Period End. Sum the most recent period's rows.
  const formula = `AND(FIND("${aka.replace(/"/g, '\\"')}", ARRAYJOIN({AKA (from Creator)})), IS_BEFORE({Period End}, "${currentPeriodStart}"))`
  const params = new URLSearchParams()
  params.set('filterByFormula', formula)
  params.set('sort[0][field]', 'Period End')
  params.set('sort[0][direction]', 'desc')
  params.set('pageSize', '20')
  const res = await fetch(
    `https://api.airtable.com/v0/${HQ_BASE}/${INVOICES_TABLE}?${params}`,
    { headers: atHeaders(), cache: 'no-store' }
  )
  if (!res.ok) return null
  const data = await res.json()
  if (!data.records?.length) return null
  // All rows from the single most-recent prior period share the same Period End
  const latestEnd = data.records[0].fields?.['Period End']
  if (!latestEnd) return null
  const prev = data.records.filter(r => r.fields?.['Period End'] === latestEnd)
  return prev.reduce((s, r) => s + Number(r.fields?.['Earnings (TR)'] || 0), 0)
}

function fmtDate(iso) {
  if (!iso) return ''
  const d = iso.includes('T') ? new Date(iso) : new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function fmtMoney(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function buildEmailHtml({ aka, periodStart, periodEnd, dueDate, totalCommission, invoices, earningsDelta }) {
  const accountRows = invoices.map(inv =>
    `<tr>
      <td style="padding:10px 16px;font-size:14px;color:#333;border-bottom:1px solid #f0f0f0;">${inv.accountName}</td>
      <td style="padding:10px 16px;font-size:14px;color:#333;border-bottom:1px solid #f0f0f0;text-align:right;">${fmtMoney(inv.earnings)}</td>
      <td style="padding:10px 16px;font-size:14px;color:#333;border-bottom:1px solid #f0f0f0;text-align:right;">${fmtMoney(inv.totalCommission)}</td>
    </tr>`
  ).join('')

  // All invoice records in a group share the same combined PDF, so render ONE
  // "View PDF" link below the table rather than repeating it per row.
  const pdfLink = invoices.find(inv => inv.dropboxLink)?.dropboxLink || null

  // Only include the celebratory "great work" paragraph when earnings went up from the
  // previous pay period. If earnings were flat or down, drop that paragraph entirely so
  // the email reads as a straightforward invoice — no tone mismatch.
  const celebratoryParagraph = earningsDelta === 'up'
    ? `<p style="font-size:15px;color:#555;margin:0 0 28px;line-height:1.6;">
        Great work this period! Your accounts continue to perform and we're excited about the momentum.
        Here's your invoice breakdown for the latest pay period.
      </p>`
    : `<p style="font-size:15px;color:#555;margin:0 0 28px;line-height:1.6;">
        Here's your invoice breakdown for the latest pay period.
      </p>`

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 24px rgba(0,0,0,0.06);">
    <div style="background:linear-gradient(135deg,#1a1a1a 0%,#2d2d2d 100%);padding:32px 40px;">
      <div style="font-size:24px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Palm Management</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.5);margin-top:4px;">${fmtDate(periodStart)} – ${fmtDate(periodEnd)}</div>
    </div>
    <div style="padding:36px 40px;">
      <p style="font-size:17px;color:#111;margin:0 0 8px;font-weight:600;">Hey ${aka},</p>
      ${celebratoryParagraph}
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:16px;">
        <thead>
          <tr style="background:#fafafa;">
            <th style="padding:10px 16px;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.05em;text-align:left;font-weight:600;">Account</th>
            <th style="padding:10px 16px;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.05em;text-align:right;font-weight:600;">Revenue</th>
            <th style="padding:10px 16px;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.05em;text-align:right;font-weight:600;">Mgmt Fee</th>
          </tr>
        </thead>
        <tbody>${accountRows}</tbody>
      </table>
      ${pdfLink ? `<div style="text-align:center;margin:0 0 28px;">
        <a href="${pdfLink}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:10px 24px;border-radius:8px;font-size:13px;font-weight:600;">View Invoice PDF →</a>
      </div>` : ''}
      <div style="background:#FFF8FA;border-radius:12px;padding:20px 24px;margin:0 0 28px;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:6px;">Management Fee Due</div>
        <div style="font-size:28px;font-weight:800;color:#E88FAC;letter-spacing:-0.5px;">${fmtMoney(totalCommission)}</div>
      </div>
      <p style="font-size:15px;color:#555;margin:0 0 8px;line-height:1.6;">
        If you could send payment via <strong>Zelle</strong> by <strong>${fmtDate(dueDate)}</strong>, that would be great.
        Payment details are on the invoice PDF above.
      </p>
      <p style="font-size:13px;color:#999;margin:24px 0 0;">
        Questions about your invoice? Just reply to this email and we'll sort it out.
      </p>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #f0f0f0;background:#fafafa;">
      <div style="font-size:12px;color:#bbb;">Palm Digital Management LLC</div>
    </div>
  </div>
</body>
</html>`
}

// GET — preflight: gather all invoice data for a creator's period
export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }

  const { searchParams } = new URL(request.url)
  const recordIds = searchParams.get('recordIds')?.split(',') || []
  // `mode` param: 'test' (default — Evan + Josh) or 'production' (creator + cc Josh + bcc Evan)
  const mode = searchParams.get('mode') === 'production' ? 'production' : 'test'
  if (!recordIds.length) return Response.json({ error: 'recordIds required' }, { status: 400 })

  // Fetch all invoice records
  const invoices = await Promise.all(recordIds.map(async (id) => {
    const res = await fetch(
      `https://api.airtable.com/v0/${HQ_BASE}/${INVOICES_TABLE}/${id}`,
      { headers: atHeaders(), cache: 'no-store' }
    )
    const data = await res.json()
    const f = data.fields || {}
    return {
      id: data.id,
      invoice: f['Invoice'] || '',
      invoiceNumber: f['Invoice Number'] || null,
      accountName: (f['Invoice'] || '').match(/- (.+?) \|/)?.[1] || '',
      earnings: f['Earnings (TR)'] || 0,
      totalCommission: f['Total Commission'] || 0,
      commissionPct: f['Commission % (Snapshot)'] || 0,
      periodStart: f['Period Start'] || '',
      periodEnd: f['Period End'] || '',
      dueDate: f['Due Date'] || '',
      dropboxLink: f['Invoice Dropbox Link'] || null,
      hasPdf: !!(f['Creator Invoice']?.length || f['Invoice Dropbox Link']),
      creatorIds: f['Creator'] || [],
      aka: (f['AKA (from Creator)'] || [])[0] || '',
    }
  }))

  const aka = invoices[0]?.aka || ''
  const periodStart = invoices[0]?.periodStart
  const periodEnd = invoices[0]?.periodEnd
  const dueDate = invoices[0]?.dueDate
  const totalCommission = invoices.reduce((s, inv) => s + (inv.totalCommission || 0), 0)
  const totalEarnings = invoices.reduce((s, inv) => s + (inv.earnings || 0), 0)
  const allHavePdfs = invoices.every(inv => inv.hasPdf)

  // Fetch creator email
  let email = null
  let creatorName = aka
  const creatorIds = invoices[0]?.creatorIds || []
  if (creatorIds.length) {
    const crRes = await fetch(
      `https://api.airtable.com/v0/${HQ_BASE}/${CREATORS_TABLE}/${creatorIds[0]}`,
      { headers: atHeaders(), cache: 'no-store' }
    )
    const cr = await crRes.json()
    creatorName = cr.fields?.['Creator'] || aka
    email = cr.fields?.['Communication Email'] || null
  }

  // Earnings delta: compare to the creator's previous pay period. If UP → include the
  // "great work" paragraph; if flat or DOWN → omit it (don't sound tone-deaf).
  const previousTotal = await fetchPreviousPeriodTotal(aka, periodStart)
  const earningsDelta = previousTotal == null
    ? null
    : (totalEarnings > previousTotal ? 'up' : totalEarnings < previousTotal ? 'down' : 'flat')

  const html = buildEmailHtml({ aka, periodStart, periodEnd, dueDate, totalCommission, invoices, earningsDelta })

  // Recipients depend on mode:
  //   test       → to: Evan + Josh, bcc Evan (so both appear in Evan's inbox as received)
  //   production → to: creator's Communication Email, cc Josh, bcc Evan (shadow copy)
  let to, cc, bcc
  if (mode === 'production') {
    to = email ? [email] : []
    cc = ['josh@palm-mgmt.com']
    bcc = ['evan@palm-mgmt.com']
  } else {
    to = ['evan@palm-mgmt.com', 'josh@palm-mgmt.com']
    cc = []
    bcc = ['evan@palm-mgmt.com']
  }
  const from = 'evan@palm-mgmt.com'
  // Include invoice number in subject so each period gets its own Gmail thread (Gmail
  // threads by subject + participants regardless of Message-ID). The GET preview shows
  // a placeholder test suffix; the real POST appends a unique token per send.
  const primaryInvoiceNumber = invoices.find(i => i.invoiceNumber)?.invoiceNumber || null
  const subjectBase = primaryInvoiceNumber
    ? `Palm Invoice #${primaryInvoiceNumber} — ${fmtDate(periodStart)} to ${fmtDate(periodEnd)}`
    : `Palm Invoice — ${fmtDate(periodStart)} to ${fmtDate(periodEnd)}`
  const subject = mode === 'test' ? `${subjectBase} [test]` : subjectBase

  // Validation warnings — surfaced in the modal before sending
  const warnings = []
  if (!email) warnings.push({ type: 'missingEmail', message: `No Communication Email on file for ${creatorName || aka || 'this creator'}. Add one to the HQ Creators record before sending to creators.` })
  if (!aka) warnings.push({ type: 'missingAka', message: `Creator AKA field is blank — the email greeting will say "Hey ,". Set an AKA on the creator record.` })

  return Response.json({
    email,
    creatorName,
    aka,
    periodStart,
    periodEnd,
    dueDate,
    totalCommission,
    totalEarnings,
    previousPeriodTotal: previousTotal,
    earningsDelta,
    allHavePdfs,
    html,
    to,
    cc,
    bcc,
    from,
    subject,
    mode,
    testMode: mode === 'test',
    wouldSendTo: email ? [email] : [], // what production would use
    wouldCc: ['josh@palm-mgmt.com'],
    warnings,
    invoices: invoices.map(inv => ({
      id: inv.id,
      accountName: inv.accountName,
      earnings: inv.earnings,
      totalCommission: inv.totalCommission,
      dropboxLink: inv.dropboxLink,
      hasPdf: inv.hasPdf,
    })),
  })
}

// POST — send the combined invoice email
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  const body = await request.json()
  const recordIds = body.recordIds
  const mode = body.mode === 'production' ? 'production' : 'test'
  if (!recordIds?.length) return Response.json({ error: 'recordIds required' }, { status: 400 })

  // Fetch preflight data via internal logic (not self-call)
  const invoices = await Promise.all(recordIds.map(async (id) => {
    const res = await fetch(
      `https://api.airtable.com/v0/${HQ_BASE}/${INVOICES_TABLE}/${id}`,
      { headers: atHeaders(), cache: 'no-store' }
    )
    const data = await res.json()
    const f = data.fields || {}
    return {
      id: data.id,
      invoice: f['Invoice'] || '',
      accountName: (f['Invoice'] || '').match(/- (.+?) \|/)?.[1] || '',
      earnings: f['Earnings (TR)'] || 0,
      totalCommission: f['Total Commission'] || 0,
      periodStart: f['Period Start'] || '',
      periodEnd: f['Period End'] || '',
      dueDate: f['Due Date'] || '',
      dropboxLink: f['Invoice Dropbox Link'] || null,
      invoiceNumber: f['Invoice Number'] || null,
      creatorIds: f['Creator'] || [],
      aka: (f['AKA (from Creator)'] || [])[0] || '',
    }
  }))

  const aka = invoices[0]?.aka || ''
  const periodStart = invoices[0]?.periodStart
  const periodEnd = invoices[0]?.periodEnd
  const dueDate = invoices[0]?.dueDate
  const totalCommission = invoices.reduce((s, inv) => s + (inv.totalCommission || 0), 0)

  // Fetch creator email
  let creatorName = aka
  let email = null
  const creatorIds = invoices[0]?.creatorIds || []
  if (creatorIds.length) {
    const crRes = await fetch(
      `https://api.airtable.com/v0/${HQ_BASE}/${CREATORS_TABLE}/${creatorIds[0]}`,
      { headers: atHeaders(), cache: 'no-store' }
    )
    const cr = await crRes.json()
    creatorName = cr.fields?.['Creator'] || aka
    email = cr.fields?.['Communication Email'] || null
  }

  // Recipients depend on mode (sent from client via body.mode).
  //   test       → to: Evan + Josh only
  //   production → to: creator's Communication Email, cc Josh, bcc Evan
  let to, cc, bcc
  if (mode === 'production') {
    if (!email) {
      return Response.json({
        error: `No Communication Email on file for ${creatorName || aka}. Add one before sending in production mode.`,
      }, { status: 400 })
    }
    to = [email]
    cc = ['josh@palm-mgmt.com']
    bcc = ['evan@palm-mgmt.com']
  } else {
    to = ['evan@palm-mgmt.com', 'josh@palm-mgmt.com']
    cc = []
    bcc = ['evan@palm-mgmt.com']
  }
  const from = 'Evan <evan@palm-mgmt.com>'
  const replyTo = 'josh@palm-mgmt.com' // Josh handles money questions

  // Gmail threads by subject + participants even with different Message-IDs. Make the
  // subject unique per send so every email is its own thread:
  //   production → includes invoice number (naturally unique per pay period)
  //   test       → appends a unique token so repeat test sends never thread together
  const primaryInvoiceNumber = invoices.find(i => i.invoiceNumber)?.invoiceNumber || null
  const subjectBase = primaryInvoiceNumber
    ? `Palm Invoice #${primaryInvoiceNumber} — ${fmtDate(periodStart)} to ${fmtDate(periodEnd)}`
    : `Palm Invoice — ${fmtDate(periodStart)} to ${fmtDate(periodEnd)}`
  const subject = mode === 'test'
    ? `${subjectBase} [test ${Date.now().toString(36)}]`
    : subjectBase

  const totalEarnings = invoices.reduce((s, inv) => s + (inv.earnings || 0), 0)
  const previousTotal = await fetchPreviousPeriodTotal(aka, periodStart)
  const earningsDelta = previousTotal == null
    ? null
    : (totalEarnings > previousTotal ? 'up' : totalEarnings < previousTotal ? 'down' : 'flat')

  const html = buildEmailHtml({ aka, periodStart, periodEnd, dueDate, totalCommission, invoices, earningsDelta })

  // Send via Resend if configured, otherwise return for manual
  if (!process.env.RESEND_API_KEY) {
    return Response.json({
      ok: false,
      manual: true,
      to, cc, bcc, from, subject, html,
      message: 'Resend API key not configured. Set RESEND_API_KEY in .env.local.',
    })
  }

  // Download PDFs via authenticated Dropbox API. Multi-account creators share ONE
  // combined PDF across all their invoice records, so dedupe by (aka, period, invoice#).
  const attachments = []
  const seenPaths = new Set()
  const dbxToken = await getDropboxAccessToken()
  const dbxRoot = await getDropboxRootNamespaceId(dbxToken)
  for (const inv of invoices) {
    const computed = dropboxInvoicePath({
      aka: inv.aka || aka,
      periodStart: inv.periodStart,
      periodEnd: inv.periodEnd,
      invoiceNumber: inv.invoiceNumber,
    })
    if (!computed) continue
    if (seenPaths.has(computed.path)) continue
    seenPaths.add(computed.path)

    let pdfBuffer = null
    try {
      pdfBuffer = await downloadInvoicePdfFromDropbox(dbxToken, dbxRoot, computed.path)
    } catch (e) {
      console.warn('Auth Dropbox download failed:', computed.path, '—', e.message)
    }
    if (!pdfBuffer) continue

    // Sanity check — a valid PDF starts with "%PDF"
    if (pdfBuffer.slice(0, 4).toString() !== '%PDF') {
      console.warn('Dropbox returned non-PDF bytes for', computed.path)
      continue
    }

    attachments.push({
      filename: computed.filename,
      content: pdfBuffer.toString('base64'),
      content_type: 'application/pdf',
    })
  }
  console.log(`[send-combined] attaching ${attachments.length} PDF(s) for ${aka}`)

  const sendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      ...(cc.length ? { cc } : {}),
      ...(bcc.length ? { bcc } : {}),
      reply_to: replyTo,
      subject,
      html,
      attachments,
    }),
  })

  if (!sendRes.ok) {
    const err = await sendRes.json()
    return Response.json({ error: err }, { status: 500 })
  }

  // Mark all invoices as Sent + write Sent At timestamp
  const sentAt = new Date().toISOString()
  await Promise.all(recordIds.map(id =>
    fetch(`https://api.airtable.com/v0/${HQ_BASE}/${INVOICES_TABLE}/${id}`, {
      method: 'PATCH',
      headers: atHeaders(),
      body: JSON.stringify({ fields: { 'Invoice Status': 'Sent', 'Sent At': sentAt } }),
    })
  ))

  return Response.json({ ok: true, mode, to, cc, bcc, from, recordIds, sentAt })
}
