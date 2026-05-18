import { NextResponse } from 'next/server'
import { requireAdmin, patchAirtableRecord, OPS_BASE } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, deleteDropboxFile } from '@/lib/dropbox'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const VARS = 'Recreate Room Variations'

// PATCH ?id=rec...&status=Approved|Rejected|Pending
export async function PATCH(request) {
  try {
    await requireAdmin()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const status = searchParams.get('status')
    if (!id || !/^rec[A-Za-z0-9]{14}$/.test(id)) {
      return NextResponse.json({ error: 'Valid id required' }, { status: 400 })
    }
    if (!['Approved', 'Rejected', 'Pending'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    await patchAirtableRecord(VARS, id, { Status: status }, { typecast: true })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE ?id=rec...
export async function DELETE(request) {
  try {
    await requireAdmin()
    const id = new URL(request.url).searchParams.get('id')
    if (!id || !/^rec[A-Za-z0-9]{14}$/.test(id)) {
      return NextResponse.json({ error: 'Valid id required' }, { status: 400 })
    }

    // Grab the Dropbox master path before the record is gone.
    let dbxPath = ''
    try {
      const gRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(VARS)}/${id}`,
        { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' })
      if (gRes.ok) dbxPath = (await gRes.json()).fields?.['Dropbox Path'] || ''
    } catch {}

    const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(VARS)}/${id}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } })
    if (!res.ok) throw new Error(`Airtable DELETE ${res.status}`)

    // Non-fatal: remove the full-res master so deleted variations don't
    // linger in Dropbox.
    if (dbxPath) {
      try {
        const tok = await getDropboxAccessToken()
        const ns = await getDropboxRootNamespaceId(tok)
        await deleteDropboxFile(tok, ns, dbxPath)
      } catch (e) {
        console.warn(`[recreate-rooms/variation] Dropbox delete failed for ${dbxPath}: ${e.message}`)
      }
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
