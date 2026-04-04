import { requireAdmin } from '@/lib/adminAuth'
import { generateInvoicePdf } from '@/lib/generateInvoicePdf'

const HQ_BASE = 'appL7c4Wtotpz07KS'
const INVOICES_TABLE = 'tblKbU8VkdlOHXoJj'
const CREATORS_TABLE = 'tblYhkNvrNuOAHfgw'
const DROPBOX_FOLDER = '/Palm Mgmt/Invoices'

const atHeaders = () => ({
  Authorization: `Bearer ${process.env.AIRTABLE_PAT}`,
  'Content-Type': 'application/json',
})

async function fetchRecord(table, recordId) {
  const res = await fetch(
    `https://api.airtable.com/v0/${HQ_BASE}/${table}/${recordId}?returnFieldsByFieldId=true`,
    { headers: atHeaders(), cache: 'no-store' }
  )
  if (!res.ok) throw new Error(`Airtable fetch failed: ${res.status}`)
  return res.json()
}

async function getMaxInvoiceNumber() {
  const params = new URLSearchParams({
    'returnFieldsByFieldId': 'true',
    'fields[]': 'fldl3FDN3H4pr2nIY',
    'sort[0][field]': 'fldl3FDN3H4pr2nIY',
    'sort[0][direction]': 'desc',
    'pageSize': '1',
  })
  const res = await fetch(
    `https://api.airtable.com/v0/${HQ_BASE}/${INVOICES_TABLE}?${params}`,
    { headers: atHeaders(), cache: 'no-store' }
  )
  const data = await res.json()
  const val = data.records?.[0]?.fields?.fldl3FDN3H4pr2nIY
  return val ? Number(val) : 1141
}

async function getDropboxToken() {
  const res = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.DROPBOX_REFRESH_TOKEN,
      client_id: process.env.DROPBOX_APP_KEY,
      client_secret: process.env.DROPBOX_APP_SECRET,
    }),
  })
  if (!res.ok) throw new Error('Dropbox token refresh failed')
  const data = await res.json()
  return data.access_token
}

async function dropboxUpload(token, fileBytes, dropboxPath) {
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath, mode: 'overwrite' }),
      'Content-Type': 'application/octet-stream',
    },
    body: fileBytes,
  })
  if (!res.ok) throw new Error(`Dropbox upload failed: ${res.status}`)
  return res.json()
}

async function dropboxShareLink(token, dropboxPath) {
  let url = null
  const res = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: dropboxPath, settings: { requested_visibility: 'public' } }),
  })
  if (res.status === 409) {
    // Link already exists, fetch it
    const res2 = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: dropboxPath, direct_only: true }),
    })
    const data2 = await res2.json()
    url = data2.links?.[0]?.url || null
  } else if (res.ok) {
    const data = await res.json()
    url = data.url
  }
  if (!url) throw new Error('Could not get Dropbox share link')

  const browsable = url.includes('dl=') ? url.replace('dl=1', 'dl=0') : url + '?dl=0'
  const direct = browsable.replace('dl=0', 'dl=1').replace('www.dropbox.com', 'dl.dropboxusercontent.com')
  return { browsable, direct }
}

export const maxDuration = 10 // Vercel Hobby max

export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  const { recordId } = await request.json()
  if (!recordId) return Response.json({ error: 'recordId required' }, { status: 400 })

  try {
    // Fetch invoice record
    const inv = await fetchRecord(INVOICES_TABLE, recordId)
    const f = inv.fields

    const creatorIds = f['fldGggvFzR0zzl9p4'] || []
    const akaArr = f['fld37wwgvM0znxDPa'] || []
    const earnings = Number(f['fldUBcYSMy74lt9Xf'] || 0)
    const commissionPct = Number(f['fldeQoHxbYYWAnJYZ'] || 0)
    const periodStart = f['fldeucG0jEvjem841'] || ''
    const periodEnd = f['fldZhX5uMZjrAkAeP'] || ''
    const invoiceFormula = f['fldCimhMbOOeOQrFJ'] || ''
    const existingNum = f['fldl3FDN3H4pr2nIY']

    const aka = akaArr[0] || ''
    const accountPart = invoiceFormula.includes(' | ') ? invoiceFormula.split(' | ')[0].trim() : ''
    const accountLabel = aka ? accountPart.replace(`${aka} - `, '').trim() : accountPart

    // Fetch creator's legal name
    let creatorName = aka
    if (creatorIds.length) {
      const cr = await fetchRecord(CREATORS_TABLE, creatorIds[0])
      creatorName = cr.fields?.['fldMNaYOWpDxpvMxf'] || aka
    }

    // Assign invoice number
    const invoiceNumber = existingNum ? Number(existingNum) : (await getMaxInvoiceNumber()) + 1
    const commissionAmt = earnings * commissionPct

    // Build invoice data
    const invoiceData = {
      creator_name: creatorName,
      aka,
      invoice_number: invoiceNumber,
      periods: [{
        label: accountLabel,
        start: periodStart,
        end: periodEnd,
        earnings,
        commission_pct: commissionPct,
        commission_amt: commissionAmt,
      }],
    }

    // Generate PDF
    const pdfBuffer = await generateInvoicePdf(invoiceData)

    // Upload to Dropbox
    const token = await getDropboxToken()
    const akaSlug = aka.toLowerCase().replace(/ /g, '_')
    const filename = `invoice_${invoiceNumber}_${akaSlug}.pdf`
    const dropboxPath = `${DROPBOX_FOLDER}/${filename}`

    await dropboxUpload(token, pdfBuffer, dropboxPath)
    const { browsable, direct } = await dropboxShareLink(token, dropboxPath)

    // Update Airtable: attachment, invoice number, dropbox link, generated timestamp
    await fetch(`https://api.airtable.com/v0/${HQ_BASE}/${INVOICES_TABLE}/${recordId}`, {
      method: 'PATCH',
      headers: atHeaders(),
      body: JSON.stringify({
        fields: {
          fldDrn5gbFp03ngNC: [{ url: direct, filename }],
          fldl3FDN3H4pr2nIY: invoiceNumber,
          fldhtbiwnxDm2KJpg: browsable,
          fldtJxnQil7qFI3v1: new Date().toISOString(), // Generated At
        },
      }),
    })

    return Response.json({
      ok: true,
      dropboxLink: browsable,
      invoiceNumber: String(invoiceNumber),
      filename,
      generatedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('Generate invoice error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
