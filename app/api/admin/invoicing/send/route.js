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
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function fmtMoney(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// GET — preflight: fetch the creator email + invoice details to show in confirmation modal
export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }

  const { searchParams } = new URL(request.url)
  const recordId = searchParams.get('recordId')
  if (!recordId) return Response.json({ error: 'recordId required' }, { status: 400 })

  const invRes = await fetch(
    `https://api.airtable.com/v0/${HQ_BASE}/${INVOICES_TABLE}/${recordId}?returnFieldsByFieldId=true` +
    `&fields[]=fldGggvFzR0zzl9p4&fields[]=fld37wwgvM0znxDPa&fields[]=fldhtbiwnxDm2KJpg` +
    `&fields[]=fldl3FDN3H4pr2nIY&fields[]=fldCimhMbOOeOQrFJ&fields[]=fldeucG0jEvjem841` +
    `&fields[]=fldZhX5uMZjrAkAeP&fields[]=fldk9uXcTQmkb897y`,
    { headers: atHeaders(), cache: 'no-store' }
  )
  const inv = await invRes.json()
  const f = inv.fields

  const creatorIds = f['fldGggvFzR0zzl9p4'] || []
  const aka = (f['fld37wwgvM0znxDPa'] || [])[0] || ''
  const dropboxLink = f['fldhtbiwnxDm2KJpg'] || null
  const invoiceNumber = f['fldl3FDN3H4pr2nIY'] || null
  const accountName = (f['fldCimhMbOOeOQrFJ'] || '').split(' | ')[0]?.trim() || ''
  const periodStart = f['fldeucG0jEvjem841'] || ''
  const periodEnd = f['fldZhX5uMZjrAkAeP'] || ''
  const totalDue = f['fldk9uXcTQmkb897y'] || 0

  if (!dropboxLink) {
    return Response.json({ error: 'No PDF generated yet. Generate the PDF first.' }, { status: 400 })
  }

  // Fetch creator email
  let creatorName = aka
  let email = null
  if (creatorIds.length) {
    const crRes = await fetch(
      `https://api.airtable.com/v0/${HQ_BASE}/${CREATORS_TABLE}/${creatorIds[0]}?returnFieldsByFieldId=true` +
      `&fields[]=fldMNaYOWpDxpvMxf&fields[]=fldEWO533ctKvA9yZ`,
      { headers: atHeaders(), cache: 'no-store' }
    )
    const cr = await crRes.json()
    creatorName = cr.fields?.['fldMNaYOWpDxpvMxf'] || aka
    email = cr.fields?.['fldEWO533ctKvA9yZ'] || null
  }

  return Response.json({
    email,
    creatorName,
    aka,
    invoiceNumber,
    accountName,
    periodStart,
    periodEnd,
    totalDue,
    dropboxLink,
    subject: `Invoice #${invoiceNumber} — ${accountName} — ${fmtDate(periodStart)} to ${fmtDate(periodEnd)}`,
  })
}

// POST — actually send the email
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  const { recordId } = await request.json()
  if (!recordId) return Response.json({ error: 'recordId required' }, { status: 400 })

  // Re-fetch all details
  const preflight = await (await fetch(
    new URL(`/api/admin/invoicing/send?recordId=${recordId}`, 'http://localhost').toString().replace('http://localhost', ''),
    { headers: atHeaders(), cache: 'no-store' }
  ).catch(() => null))

  // Fetch directly instead of calling self
  const invRes = await fetch(
    `https://api.airtable.com/v0/${HQ_BASE}/${INVOICES_TABLE}/${recordId}?returnFieldsByFieldId=true` +
    `&fields[]=fldGggvFzR0zzl9p4&fields[]=fld37wwgvM0znxDPa&fields[]=fldhtbiwnxDm2KJpg` +
    `&fields[]=fldl3FDN3H4pr2nIY&fields[]=fldCimhMbOOeOQrFJ&fields[]=fldeucG0jEvjem841` +
    `&fields[]=fldZhX5uMZjrAkAeP&fields[]=fldk9uXcTQmkb897y`,
    { headers: atHeaders(), cache: 'no-store' }
  )
  const inv = await invRes.json()
  const f = inv.fields

  const creatorIds = f['fldGggvFzR0zzl9p4'] || []
  const aka = (f['fld37wwgvM0znxDPa'] || [])[0] || ''
  const dropboxLink = f['fldhtbiwnxDm2KJpg']
  const invoiceNumber = f['fldl3FDN3H4pr2nIY']
  const accountName = (f['fldCimhMbOOeOQrFJ'] || '').split(' | ')[0]?.trim() || ''
  const periodStart = f['fldeucG0jEvjem841'] || ''
  const periodEnd = f['fldZhX5uMZjrAkAeP'] || ''
  const totalDue = f['fldk9uXcTQmkb897y'] || 0

  if (!dropboxLink) {
    return Response.json({ error: 'No PDF generated yet.' }, { status: 400 })
  }

  let creatorName = aka
  let email = null
  if (creatorIds.length) {
    const crRes = await fetch(
      `https://api.airtable.com/v0/${HQ_BASE}/${CREATORS_TABLE}/${creatorIds[0]}?returnFieldsByFieldId=true` +
      `&fields[]=fldMNaYOWpDxpvMxf&fields[]=fldEWO533ctKvA9yZ`,
      { headers: atHeaders(), cache: 'no-store' }
    )
    const cr = await crRes.json()
    creatorName = cr.fields?.['fldMNaYOWpDxpvMxf'] || aka
    email = cr.fields?.['fldEWO533ctKvA9yZ'] || null
  }

  if (!email) {
    return Response.json({
      error: `No communication email on file for ${creatorName}. Add it to their Creator record.`,
    }, { status: 400 })
  }

  const subject = `Invoice #${invoiceNumber} — ${accountName} — ${fmtDate(periodStart)} to ${fmtDate(periodEnd)}`

  // If no Resend key, return details for manual send
  if (!process.env.RESEND_API_KEY) {
    return Response.json({ ok: false, manual: true, email, subject, dropboxLink, invoiceNumber })
  }

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.06);">
    <div style="background:linear-gradient(135deg,#fcaf45 0%,#f77737 20%,#e1306c 40%,#c13584 55%,#833ab4 75%,#5b51d8 100%);padding:28px 36px;">
      <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Palm Digital Management</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.7);margin-top:4px;">Invoice #${invoiceNumber}</div>
    </div>
    <div style="padding:32px 36px;">
      <p style="font-size:16px;color:#111;margin:0 0 24px;">Hi ${aka},</p>
      <p style="font-size:15px;color:#444;margin:0 0 24px;">
        Your invoice for <strong>${accountName}</strong> covering
        <strong>${fmtDate(periodStart)} – ${fmtDate(periodEnd)}</strong> is ready.
      </p>
      <div style="background:#f7f7f7;border-radius:10px;padding:20px 24px;margin:0 0 28px;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#999;margin-bottom:8px;">Total Due</div>
        <div style="font-size:32px;font-weight:900;color:#111;letter-spacing:-1px;">${fmtMoney(totalDue)}</div>
      </div>
      <a href="${dropboxLink}" style="display:inline-block;background:#111;color:#fff;padding:13px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">
        View Invoice →
      </a>
      <p style="font-size:13px;color:#999;margin:28px 0 0;">
        Please pay via Zelle or bank transfer as detailed on the invoice.<br>
        Questions? Reply to this email.
      </p>
    </div>
    <div style="padding:20px 36px;border-top:1px solid #f0f0f0;">
      <div style="font-size:12px;color:#bbb;">Palm Digital Management LLC</div>
    </div>
  </div>
</body>
</html>`

  const sendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Palm Digital Management <evan@palm-mgmt.com>',
      to: [email],
      subject,
      html,
    }),
  })

  if (!sendRes.ok) {
    const err = await sendRes.json()
    return Response.json({ error: err }, { status: 500 })
  }

  // Update invoice status to Sent
  await fetch(`https://api.airtable.com/v0/${HQ_BASE}/${INVOICES_TABLE}/${recordId}`, {
    method: 'PATCH',
    headers: atHeaders(),
    body: JSON.stringify({ fields: { fldQEjYB0DxpNWxhU: 'Sent' } }),
  })

  return Response.json({ ok: true, email, invoiceNumber })
}
