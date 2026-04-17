import { requireAdmin } from '@/lib/adminAuth'
import { generateInvoicePdf } from '@/lib/generateInvoicePdf'
import { getDropboxAccessToken, getDropboxRootNamespaceId } from '@/lib/dropbox'

const HQ_BASE = 'appL7c4Wtotpz07KS'
const INVOICES_TABLE = 'tblKbU8VkdlOHXoJj'
const CREATORS_TABLE = 'tblYhkNvrNuOAHfgw'
const DROPBOX_FOLDER = '/Palm Ops/Invoices'
// Hardcoded team namespace ID — same as chat logs, avoids hitting personal Palm Ops folder
const PATH_ROOT_HEADER = (rootId) => JSON.stringify({ '.tag': 'root', root: rootId })

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

async function dropboxUpload(token, rootId, fileBytes, dropboxPath) {
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath, mode: 'overwrite' }),
      'Dropbox-API-Path-Root': PATH_ROOT_HEADER(rootId),
      'Content-Type': 'application/octet-stream',
    },
    body: fileBytes,
  })
  if (!res.ok) throw new Error(`Dropbox upload failed: ${res.status} ${await res.text()}`)
  return res.json()
}

async function dropboxShareLink(token, rootId, dropboxPath) {
  let url = null
  const res = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Dropbox-API-Path-Root': PATH_ROOT_HEADER(rootId),
    },
    body: JSON.stringify({ path: dropboxPath, settings: { requested_visibility: 'public' } }),
  })
  if (res.status === 409) {
    const res2 = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Dropbox-API-Path-Root': PATH_ROOT_HEADER(rootId),
      },
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

export const maxDuration = 60 // needs Pro plan for >10s, but set high for safety

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

    // Upload to team-space Palm Ops — folder by pay period, filename combines AKA + period + invoice #
    // e.g. /Palm Ops/Invoices/2026-03-29 to 2026-04-14/Amelia - 2026-03-29 to 2026-04-14 - 1148.pdf
    const token = await getDropboxAccessToken()
    const rootId = await getDropboxRootNamespaceId(token)
    const akaPart = aka || 'Unassigned'
    const periodPart = periodStart && periodEnd ? `${periodStart} to ${periodEnd}` : 'unassigned'
    const filename = `${akaPart} - ${periodPart} - ${invoiceNumber}.pdf`
    const dropboxPath = `${DROPBOX_FOLDER}/${periodPart}/${filename}`

    await dropboxUpload(token, rootId, pdfBuffer, dropboxPath)
    const { browsable, direct } = await dropboxShareLink(token, rootId, dropboxPath)

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
