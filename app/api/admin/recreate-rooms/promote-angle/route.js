import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, createAirtableRecord, OPS_BASE } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'

export const maxDuration = 60

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const ROOMS = 'Recreate Rooms'
const VARS = 'Recreate Room Variations'

const rawDbx = (u) => u ? String(u).replace('dl=0', 'raw=1').replace('dl=1', 'raw=1') : ''

// POST { variationId } — promote a generated angle candidate into its
// own locked Room for the same creator (so clutter/time variations can
// be shuffled off that angle as a stable base). Returns the new roomId;
// the client then calls /analyze-lock to write its Sonnet lock list.
export async function POST(request) {
  try {
    await requireAdmin()
    const { variationId } = await request.json()
    if (!variationId || !/^rec[A-Za-z0-9]{14}$/.test(variationId)) {
      return NextResponse.json({ error: 'Valid variationId required' }, { status: 400 })
    }

    const vRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(VARS)}/${variationId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' })
    if (!vRes.ok) return NextResponse.json({ error: 'Variation not found' }, { status: 404 })
    const vf = (await vRes.json()).fields || {}
    const parentRoomId = Array.isArray(vf.Room) ? vf.Room[0] : null
    const dbxPath = vf['Dropbox Path'] || ''
    const dbxLink = vf['Dropbox Link'] || ''
    const imgUrl = (dbxLink && rawDbx(dbxLink)) || (Array.isArray(vf.Image) && vf.Image[0]?.url) || ''
    if (!parentRoomId) return NextResponse.json({ error: 'Variation has no parent room' }, { status: 400 })
    if (!imgUrl) return NextResponse.json({ error: 'Variation has no usable image' }, { status: 400 })

    const rRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(ROOMS)}/${parentRoomId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' })
    if (!rRes.ok) return NextResponse.json({ error: 'Parent room not found' }, { status: 404 })
    const rf = (await rRes.json()).fields || {}
    const creatorId = Array.isArray(rf.Creator) ? rf.Creator[0] : null
    if (!creatorId) return NextResponse.json({ error: 'Parent room has no creator' }, { status: 400 })
    const root = String(rf['Room Name'] || 'Room').replace(/\s*[—-]\s*Angle\s*\d+\s*$/i, '').trim() || 'Room'

    // Number the new angle: count existing rooms for this creator whose
    // name shares the root (the original counts as Angle 1).
    const allRooms = await fetchAirtableRecords(ROOMS, { fields: ['Room Name', 'Creator'] })
    const sameRoot = allRooms.filter(r =>
      (r.fields?.Creator || []).includes(creatorId)
      && String(r.fields?.['Room Name'] || '').replace(/\s*[—-]\s*Angle\s*\d+\s*$/i, '').trim() === root)
    const angleN = sameRoot.length + 1
    const newName = `${root} — Angle ${angleN}`
    const safe = newName.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'Room'

    // Give the angle room its OWN Dropbox master (independent copy), so
    // the staging candidate can be removed without breaking it and the
    // two never share a file. Falls back to the shared path if the copy
    // fails (non-fatal).
    let baseDbxPath = dbxPath, baseDbxLink = dbxLink
    try {
      const imgRes = await fetch(imgUrl)
      if (imgRes.ok) {
        const buf = Buffer.from(await imgRes.arrayBuffer())
        const tok = await getDropboxAccessToken()
        const ns = await getDropboxRootNamespaceId(tok)
        const newPath = `/Palm Ops/Recreate Rooms/${safe}/_base/${safe}-${Date.now()}.jpg`
        await uploadToDropbox(tok, ns, newPath, buf, { overwrite: true })
        let link = ''
        try { link = await createDropboxSharedLink(tok, ns, newPath) } catch {}
        baseDbxPath = newPath
        if (link) baseDbxLink = link
      }
    } catch (e) {
      console.warn(`[promote-angle] independent copy failed, sharing source path: ${e.message}`)
    }

    const fields = {
      'Room Name': newName,
      Creator: [creatorId],
      Angle: `Angle ${angleN}`,
      'Base Prompt': '',
      Status: 'Locked',
      // No 'Base Image' attachment — Dropbox is canonical source.
      // baseDbxPath / baseDbxLink were resolved upstream (either via
      // the variation's Dropbox path, or a copy that was just minted).
      ...(baseDbxPath ? { 'Base Dropbox Path': baseDbxPath } : {}),
      ...(baseDbxLink ? { 'Base Dropbox Link': baseDbxLink } : {}),
    }
    const created = await createAirtableRecord(ROOMS, fields)
    const roomId = created?.records?.[0]?.id || created?.id

    // Remove the source candidate from the staging gallery so a promoted
    // angle never lingers as a pending candidate. Airtable record ONLY —
    // do not touch Dropbox (only safe to skip the file delete because the
    // angle room now has its own independent copy when baseDbxPath !=
    // dbxPath; if the copy fell back to the shared path, keep the source).
    let removedSource = false
    if (baseDbxPath && baseDbxPath !== dbxPath) {
      try {
        const dRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(VARS)}/${variationId}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } })
        removedSource = dRes.ok
      } catch {}
    }
    return NextResponse.json({ ok: true, roomId, name: newName, removedSource })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
