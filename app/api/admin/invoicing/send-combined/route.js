import { requireAdmin } from '@/lib/adminAuth'

const HQ_BASE = 'appL7c4Wtotpz07KS'
const INVOICES_TABLE = 'tblKbU8VkdlOHXoJj'
const CREATORS_TABLE = 'tblYhkNvrNuOAHfgw'

const atHeaders = () => ({
  Authorization: `Bearer ${process.env.AIRTABLE_PAT}`,
  'Content-Type': 'application/json',
})

function fmtDate(iso) {
  if (!iso) return ''
  const d = iso.includes('T') ? new Date(iso) : new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function fmtMoney(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function buildEmailHtml({ aka, periodStart, periodEnd, dueDate, totalCommission, invoices }) {
  const accountRows = invoices.map(inv =>
    `<tr>
      <td style="padding:10px 16px;font-size:14px;color:#333;border-bottom:1px solid #f0f0f0;">${inv.accountName}</td>
      <td style="padding:10px 16px;font-size:14px;color:#333;border-bottom:1px solid #f0f0f0;text-align:right;">${fmtMoney(inv.earnings)}</td>
      <td style="padding:10px 16px;font-size:14px;color:#333;border-bottom:1px solid #f0f0f0;text-align:right;">${fmtMoney(inv.totalCommission)}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;text-align:center;">
        ${inv.dropboxLink ? `<a href="${inv.dropboxLink}" style="color:#E88FAC;font-size:13px;font-weight:600;text-decoration:none;">View PDF</a>` : '—'}
      </td>
    </tr>`
  ).join('')

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
      <p style="font-size:15px;color:#555;margin:0 0 28px;line-height:1.6;">
        Great work this period! Your accounts continue to perform and we're excited about the momentum.
        Here's your invoice breakdown for the latest pay period.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:24px;">
        <thead>
          <tr style="background:#fafafa;">
            <th style="padding:10px 16px;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.05em;text-align:left;font-weight:600;">Account</th>
            <th style="padding:10px 16px;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.05em;text-align:right;font-weight:600;">Revenue</th>
            <th style="padding:10px 16px;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.05em;text-align:right;font-weight:600;">Mgmt Fee</th>
            <th style="padding:10px 16px;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.05em;text-align:center;font-weight:600;">Invoice</th>
          </tr>
        </thead>
        <tbody>${accountRows}</tbody>
      </table>
      <div style="background:#FFF8FA;border-radius:12px;padding:20px 24px;margin:0 0 28px;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:6px;">Management Fee Due</div>
        <div style="font-size:28px;font-weight:800;color:#E88FAC;letter-spacing:-0.5px;">${fmtMoney(totalCommission)}</div>
      </div>
      <p style="font-size:15px;color:#555;margin:0 0 8px;line-height:1.6;">
        If you could send payment via <strong>Zelle</strong> by <strong>${fmtDate(dueDate)}</strong>, that would be great.
        Payment details are on each invoice PDF above.
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

  const html = buildEmailHtml({ aka, periodStart, periodEnd, dueDate, totalCommission, invoices })

  const to = email ? [email] : []
  const cc = ['josh@palm-mgmt.com']
  const from = 'evan@palm-mgmt.com'
  const subject = `Your Palm Invoice — ${fmtDate(periodStart)} to ${fmtDate(periodEnd)}`

  return Response.json({
    email,
    creatorName,
    aka,
    periodStart,
    periodEnd,
    dueDate,
    totalCommission,
    totalEarnings,
    allHavePdfs,
    html,
    to,
    cc,
    from,
    subject,
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

  const { recordIds } = await request.json()
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
      accountName: (f['Invoice'] || '').match(/- (.+?) \|/)?.[1] || '',
      earnings: f['Earnings (TR)'] || 0,
      totalCommission: f['Total Commission'] || 0,
      periodStart: f['Period Start'] || '',
      periodEnd: f['Period End'] || '',
      dueDate: f['Due Date'] || '',
      dropboxLink: f['Invoice Dropbox Link'] || null,
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

  if (!email) {
    return Response.json({
      error: `No Communication Email on file for ${creatorName || aka}. Add one to the creator's HQ record before sending.`,
    }, { status: 400 })
  }

  const to = [email]
  const cc = ['josh@palm-mgmt.com']
  const from = 'Evan <evan@palm-mgmt.com>'
  const subject = `Your Palm Invoice — ${fmtDate(periodStart)} to ${fmtDate(periodEnd)}`
  const html = buildEmailHtml({ aka, periodStart, periodEnd, dueDate, totalCommission, invoices })

  // Send via Resend if configured, otherwise return for manual
  if (!process.env.RESEND_API_KEY) {
    return Response.json({
      ok: false,
      manual: true,
      to, cc, from, subject, html,
      message: 'Resend API key not configured. Set RESEND_API_KEY in .env.local.',
    })
  }

  // Download PDFs and attach to email.
  // Multi-account creators share ONE combined PDF across all their invoice records, so
  // dedupe by Dropbox link to avoid attaching the same file multiple times.
  const attachments = []
  const seenUrls = new Set()
  for (const inv of invoices) {
    if (!inv.dropboxLink) continue
    const pdfUrl = inv.dropboxLink.replace('?dl=0', '?dl=1')
    if (seenUrls.has(pdfUrl)) continue
    seenUrls.add(pdfUrl)
    try {
      const pdfRes = await fetch(pdfUrl)
      if (pdfRes.ok) {
        const pdfBuffer = await pdfRes.arrayBuffer()
        // Pull filename from the Dropbox URL itself (already set to our canonical
        // "AKA - period - invoice#.pdf" format at generation time).
        let filename = `invoice_${aka.toLowerCase().replace(/ /g, '_')}.pdf`
        try {
          const u = new URL(pdfUrl)
          const last = decodeURIComponent(u.pathname.split('/').pop() || '')
          if (last.toLowerCase().endsWith('.pdf')) filename = last
        } catch (_) {}
        attachments.push({
          filename,
          content: Buffer.from(pdfBuffer).toString('base64'),
        })
      }
    } catch (_) {}
  }

  const sendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      cc,
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

  return Response.json({ ok: true, to, cc, from, recordIds, sentAt })
}
