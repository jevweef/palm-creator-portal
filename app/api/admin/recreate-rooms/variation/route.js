import { NextResponse } from 'next/server'
import { requireAdmin, patchAirtableRecord, fetchAirtableRecords, OPS_BASE } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, deleteDropboxFile, uploadToDropbox, createDropboxSharedLink, moveDropboxItem, createDropboxFolder } from '@/lib/dropbox'

export const maxDuration = 300

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const VARS = 'Recreate Room Variations'
const ROOMS = 'Recreate Rooms'

// POST { roomId, action? } —
//   default        : backfill Dropbox masters for variations that never
//                     got one (Dropbox auth blip). Pulls the Airtable image.
//   action:renumber : rename every master to a unique sequential name
//                     ("Variation NN.jpg") and resync Airtable. Fixes the
//                     legacy duplicate "Shuffle 1/2/3" names.
export async function POST(request) {
  try {
    await requireAdmin()
    const { roomId, action } = await request.json()
    if (!roomId || !/^rec[A-Za-z0-9]{14}$/.test(roomId)) {
      return NextResponse.json({ error: 'Valid roomId required' }, { status: 400 })
    }

    const rRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(ROOMS)}/${roomId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' })
    if (!rRes.ok) return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    const roomFields = (await rRes.json()).fields || {}
    const roomName = roomFields['Room Name'] || 'Room'
    const folderSafe = roomName.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'Room'

    const all = await fetchAirtableRecords(VARS, { fields: ['Variation', 'Room', 'Recipe', 'Image', 'Dropbox Path'] })

    if (action === 'renumber') {
      const mine = all
        .filter(v => (v.fields?.Room || []).includes(roomId) && v.fields?.['Dropbox Path'])
        .sort((a, b) => String(a.createdTime).localeCompare(String(b.createdTime)))
      const tok = await getDropboxAccessToken()
      const ns = await getDropboxRootNamespaceId(tok)
      let renamed = 0
      let baseMoved = false
      let baseError = ''
      const skipped = []

      // Put the room's BASE image inside its own /{room}/_base/ folder
      // so every room is organized the same way. MUST run before any
      // variation early-return — angle rooms often have no variations yet.
      const basePath = roomFields['Base Dropbox Path']
      if (basePath) {
        const baseTo = `/Palm Ops/Recreate Rooms/${folderSafe}/_base/${folderSafe} base.jpg`
        if (basePath !== baseTo) {
          try {
            try { await createDropboxFolder(tok, ns, `/Palm Ops/Recreate Rooms/${folderSafe}/_base`) } catch {}
            await moveDropboxItem(tok, ns, basePath, baseTo, { autorename: false })
            let bl = ''
            try { bl = await createDropboxSharedLink(tok, ns, baseTo) } catch {}
            await patchAirtableRecord(ROOMS, roomId, {
              'Base Dropbox Path': baseTo,
              ...(bl ? { 'Base Dropbox Link': bl } : {}),
              // No 'Base Image' attachment — Dropbox is the canonical source.
            })
            baseMoved = true
          } catch (e) { baseError = e?.message || String(e) }
        } else {
          baseMoved = true
        }
      }
      for (let i = 0; i < mine.length; i++) {
        const v = mine[i]
        const label = `Variation ${String(i + 1).padStart(2, '0')}`
        const from = v.fields['Dropbox Path']
        const to = `/Palm Ops/Recreate Rooms/${folderSafe}/${label}.jpg`
        try {
          if (from !== to) {
            await moveDropboxItem(tok, ns, from, to, { autorename: false })
          }
          let link = ''
          try { link = await createDropboxSharedLink(tok, ns, to) } catch {}
          await patchAirtableRecord(VARS, v.id, {
            'Dropbox Path': to,
            Recipe: label,
            Variation: `${roomName} - ${label}`,
            ...(link ? { 'Dropbox Link': link } : {}),
          })
          renamed++
        } catch { skipped.push(v.id) }
      }
      return NextResponse.json({ ok: true, renamed, skipped: skipped.length, baseMoved, baseError })
    }

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
// Optional JSON body { reason } — stored as tuning feedback on reject.
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
    let reason = ''
    try { reason = String((await request.json())?.reason || '').trim() } catch {}
    await patchAirtableRecord(VARS, id, {
      Status: status,
      ...(status === 'Rejected' && reason ? { 'Reject Reason': reason } : {}),
    }, { typecast: true })
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
