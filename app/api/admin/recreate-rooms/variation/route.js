import { NextResponse } from 'next/server'
import { requireAdmin, patchAirtableRecord, fetchAirtableRecords, OPS_BASE } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, deleteDropboxFile, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'

export const maxDuration = 300

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const VARS = 'Recreate Room Variations'
const ROOMS = 'Recreate Rooms'

// POST { roomId } — backfill Dropbox masters for variations that never
// got one (e.g. generated during a Dropbox auth blip). Pulls each
// variation's Airtable image and pushes it to Dropbox.
export async function POST(request) {
  try {
    await requireAdmin()
    const { roomId } = await request.json()
    if (!roomId || !/^rec[A-Za-z0-9]{14}$/.test(roomId)) {
      return NextResponse.json({ error: 'Valid roomId required' }, { status: 400 })
    }

    const rRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(ROOMS)}/${roomId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' })
    if (!rRes.ok) return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    const roomName = (await rRes.json()).fields?.['Room Name'] || 'Room'
    const folderSafe = roomName.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'Room'

    const all = await fetchAirtableRecords(VARS, { fields: ['Variation', 'Room', 'Recipe', 'Image', 'Dropbox Path'] })
    const missing = all.filter(v =>
      (v.fields?.Room || []).includes(roomId)
      && !v.fields?.['Dropbox Path']
      && Array.isArray(v.fields?.Image) && v.fields.Image[0]?.url)

    if (missing.length === 0) return NextResponse.json({ ok: true, fixed: 0, skipped: 0 })

    const tok = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(tok)
    let fixed = 0
    const skipped = []
    for (const v of missing) {
      try {
        const name = String(v.fields?.Recipe || 'variation').slice(0, 60).replace(/[^a-zA-Z0-9-_ ]/g, '')
        const r = await fetch(v.fields.Image[0].url)
        if (!r.ok) { skipped.push(v.id); continue }
        const buf = Buffer.from(await r.arrayBuffer())
        const path = `/Palm Ops/Recreate Rooms/${folderSafe}/${name}-${Date.now()}.jpg`
        await uploadToDropbox(tok, ns, path, buf, { overwrite: true })
        let link = ''
        try { link = await createDropboxSharedLink(tok, ns, path) } catch {}
        await patchAirtableRecord(VARS, v.id, {
          'Dropbox Path': path,
          ...(link ? { 'Dropbox Link': link } : {}),
        })
        fixed++
      } catch { skipped.push(v.id) }
    }
    return NextResponse.json({ ok: true, fixed, skipped: skipped.length })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

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
