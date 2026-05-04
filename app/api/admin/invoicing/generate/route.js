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

  const body = await request.json()
  // Accept either a single recordId OR an array of recordIds. When multiple are provided
  // (same creator, same pay period), produce ONE PDF with all accounts as line items and
  // attach the result to every record in the group.
  const recordIds = Array.isArray(body.recordIds) && body.recordIds.length
    ? body.recordIds
    : (body.recordId ? [body.recordId] : [])
  if (recordIds.length === 0) return Response.json({ error: 'recordId(s) required' }, { status: 400 })

  try {
    // Fetch all records
    const records = []
    for (const id of recordIds) {
      const rec = await fetchRecord(INVOICES_TABLE, id)
      records.push(rec)
    }

    // Validate: all records must share creator (AKA) + period
    const firstF = records[0].fields
    const groupAka = (firstF['fld37wwgvM0znxDPa'] || [])[0] || ''
    const groupStart = firstF['fldeucG0jEvjem841'] || ''
    const groupEnd = firstF['fldZhX5uMZjrAkAeP'] || ''
    for (const r of records) {
      const f = r.fields
      const aka = (f['fld37wwgvM0znxDPa'] || [])[0] || ''
      const ps = f['fldeucG0jEvjem841'] || ''
      const pe = f['fldZhX5uMZjrAkAeP'] || ''
      if (aka !== groupAka || ps !== groupStart || pe !== groupEnd) {
        return Response.json({ error: 'All records must share the same creator and pay period' }, { status: 400 })
      }
    }

    // Sort so Free OF line item comes before VIP OF for consistent display
    records.sort((a, b) => {
      const la = a.fields['fldCimhMbOOeOQrFJ'] || ''
      const lb = b.fields['fldCimhMbOOeOQrFJ'] || ''
      const rank = (s) => s.includes('Free OF') ? 1 : s.includes('VIP OF') ? 2 : s.includes('Fansly') ? 3 : 4
      return rank(la) - rank(lb)
    })

    // Resolve creator legal name (from first record's linked creator)
    let creatorName = groupAka
    const creatorIds = firstF['fldGggvFzR0zzl9p4'] || []
    if (creatorIds.length) {
      const cr = await fetchRecord(CREATORS_TABLE, creatorIds[0])
      creatorName = cr.fields?.['fldMNaYOWpDxpvMxf'] || groupAka
    }

    // Pick one invoice number for the combined invoice.
    // Prefer the smallest existing one among the records; otherwise mint a new one.
    const existingNums = records
      .map(r => r.fields['fldl3FDN3H4pr2nIY'])
      .filter(n => n != null)
      .map(Number)
      .sort((a, b) => a - b)
    const invoiceNumber = existingNums.length ? existingNums[0] : (await getMaxInvoiceNumber()) + 1

    // Build one period entry per record (each account = one line item block)
    const periods = records.map(r => {
      const f = r.fields
      const earnings = Number(f['fldUBcYSMy74lt9Xf'] || 0)
      const commissionPct = Number(f['fldeQoHxbYYWAnJYZ'] || 0)
      const invoiceFormula = f['fldCimhMbOOeOQrFJ'] || ''
      const accountPart = invoiceFormula.includes(' | ') ? invoiceFormula.split(' | ')[0].trim() : ''
      const accountLabel = groupAka ? accountPart.replace(`${groupAka} - `, '').trim() : accountPart
      const customLabel = (f['fldWsJmd2emUxKRkT'] || '').trim()
      return {
        label: accountLabel,
        start: groupStart,
        end: groupEnd,
        earnings,
        commission_pct: commissionPct,
        commission_amt: earnings * commissionPct,
        custom_label: customLabel || null,
      }
    })

    const invoiceData = {
      creator_name: creatorName,
      aka: groupAka,
      invoice_number: invoiceNumber,
      periods,
    }

    // Generate PDF
    const pdfBuffer = await generateInvoicePdf(invoiceData)

    // Upload to team-space Palm Ops — one file for the whole group
    const token = await getDropboxAccessToken()
    const rootId = await getDropboxRootNamespaceId(token)
    const akaPart = groupAka || 'Unassigned'
    const periodPart = groupStart && groupEnd ? `${groupStart} to ${groupEnd}` : 'unassigned'
    const filename = `${akaPart} - ${periodPart} - ${invoiceNumber}.pdf`
    const dropboxPath = `${DROPBOX_FOLDER}/${periodPart}/${filename}`

    await dropboxUpload(token, rootId, pdfBuffer, dropboxPath)
    const { browsable, direct } = await dropboxShareLink(token, rootId, dropboxPath)

    // Attach the same PDF + link + invoice# to every record in the group
    const generatedAt = new Date().toISOString()
    for (const r of records) {
      await fetch(`https://api.airtable.com/v0/${HQ_BASE}/${INVOICES_TABLE}/${r.id}`, {
        method: 'PATCH',
        headers: atHeaders(),
        body: JSON.stringify({
          fields: {
            fldDrn5gbFp03ngNC: [{ url: direct, filename }],
            fldl3FDN3H4pr2nIY: invoiceNumber,
            fldhtbiwnxDm2KJpg: browsable,
            fldtJxnQil7qFI3v1: generatedAt,
          },
        }),
      })
    }

    return Response.json({
      ok: true,
      dropboxLink: browsable,
      invoiceNumber: String(invoiceNumber),
      filename,
      generatedAt,
      recordIds: records.map(r => r.id),
    })
  } catch (err) {
    console.error('Generate invoice error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
