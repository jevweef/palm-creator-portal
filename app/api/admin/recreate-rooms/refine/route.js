import { NextResponse } from 'next/server'
import { requireAdmin, createAirtableRecord, patchAirtableRecord, OPS_BASE } from '@/lib/adminAuth'
import { submitWaveSpeedTask, pollWaveSpeedTask } from '@/lib/wavespeed'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'

export const maxDuration = 300

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const VARS = 'Recreate Room Variations'
const ROOMS = 'Recreate Rooms'
const EDIT_MODEL = 'google/nano-banana-2/edit'

const rawDbx = (u) => u ? String(u).replace('dl=0', 'raw=1').replace('dl=1', 'raw=1') : ''

// Precise touch-up of ONE existing image (not a base shuffle). Keeps
// the exact camera/room and applies only the typed instruction —
// fixing a wall, adding a plant, a poster, etc.
function buildRefinePrompt(instruction) {
  return (
    'This is a precise local edit of the photograph. Keep the EXACT same '
    + 'camera angle, framing, perspective, crop, room, furniture, layout, '
    + 'lighting and overall style. Apply ONLY the following change(s) and '
    + 'nothing else:\n\n'
    + instruction + '\n\n'
    + 'Blend the change in photorealistically so it looks like it was always '
    + 'part of this candid iPhone photo (matching light, shadow, perspective '
    + 'and grain). Do not alter, move, resize or restyle anything that is not '
    + 'named in that instruction. No added text, lettering, captions, logos or '
    + 'watermark anywhere. No people.'
  )
}

async function runEdit(imageUrl, prompt) {
  const task = await submitWaveSpeedTask(EDIT_MODEL, {
    images: [imageUrl],
    prompt,
    aspect_ratio: '9:16',
    resolution: '2k',
    output_format: 'jpeg',
  })
  const t0 = Date.now()
  while (Date.now() - t0 < 270000) {
    const d = await pollWaveSpeedTask(task.id)
    if (d.status === 'completed') {
      const out = (d.outputs || [])[0]
      if (!out) throw new Error('no output')
      return out
    }
    if (d.status === 'failed') throw new Error(d.error || 'edit failed')
    await new Promise(r => setTimeout(r, 3000))
  }
  throw new Error('refine timed out')
}

// POST — two modes:
//   { variationId, instruction } → edits that variation, saves a NEW
//       variation under the same room.
//   { roomId, instruction }      → edits the room's locked BASE image
//       and replaces it IN PLACE (Base Image + Base Dropbox), so a
//       locked angle can be cleaned up (e.g. remove hallucinated lights).
export async function POST(request) {
  try {
    await requireAdmin()
    const { variationId, roomId: bodyRoomId, instruction } = await request.json()
    const instr = String(instruction || '').trim()
    if (!instr) return NextResponse.json({ error: 'instruction required' }, { status: 400 })

    // ---- Base-image mode (locked angle rooms) ----
    if (bodyRoomId && /^rec[A-Za-z0-9]{14}$/.test(bodyRoomId)) {
      const rRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(ROOMS)}/${bodyRoomId}`,
        { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' })
      if (!rRes.ok) return NextResponse.json({ error: 'Room not found' }, { status: 404 })
      const rf = (await rRes.json()).fields || {}
      const baseSrc = (rf['Base Dropbox Link'] && rawDbx(rf['Base Dropbox Link']))
        || (Array.isArray(rf['Base Image']) && rf['Base Image'][0]?.url) || ''
      if (!baseSrc) return NextResponse.json({ error: 'Room has no base image' }, { status: 400 })
      const rName = String(rf['Room Name'] || 'Room')
      const safe = rName.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'Room'
      const newUrl = await runEdit(baseSrc, buildRefinePrompt(instr))

      let bPath = '', bLink = ''
      try {
        const ir = await fetch(newUrl)
        if (ir.ok) {
          const buf = Buffer.from(await ir.arrayBuffer())
          const tok = await getDropboxAccessToken()
          const ns = await getDropboxRootNamespaceId(tok)
          bPath = `/Palm Ops/Recreate Rooms/${safe}/_base/${safe}-refined-${Date.now()}.jpg`
          await uploadToDropbox(tok, ns, bPath, buf, { overwrite: true })
          try { bLink = await createDropboxSharedLink(tok, ns, bPath) } catch {}
        }
      } catch (e) {
        console.warn(`[recreate-rooms/refine] base Dropbox save failed: ${e.message}`)
      }
      await patchAirtableRecord(ROOMS, bodyRoomId, {
        // No 'Base Image' attachment — Dropbox is canonical source.
        ...(bPath ? { 'Base Dropbox Path': bPath } : {}),
        ...(bLink ? { 'Base Dropbox Link': bLink } : {}),
      })
      return NextResponse.json({ ok: true, base: true })
    }

    // ---- Variation mode ----
    if (!variationId || !/^rec[A-Za-z0-9]{14}$/.test(variationId)) {
      return NextResponse.json({ error: 'Valid variationId or roomId required' }, { status: 400 })
    }

    const vRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(VARS)}/${variationId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' })
    if (!vRes.ok) return NextResponse.json({ error: 'Variation not found' }, { status: 404 })
    const vf = (await vRes.json()).fields || {}
    const roomId = Array.isArray(vf.Room) ? vf.Room[0] : null
    const srcUrl = (vf['Dropbox Link'] && rawDbx(vf['Dropbox Link']))
      || (Array.isArray(vf.Image) && vf.Image[0]?.url) || ''
    if (!roomId) return NextResponse.json({ error: 'Variation has no room' }, { status: 400 })
    if (!srcUrl) return NextResponse.json({ error: 'Variation has no image' }, { status: 400 })

    const baseRecipe = String(vf.Recipe || 'variation').slice(0, 50)
    const roomName = String(vf.Variation || 'Room').split(' - ')[0]
    const prompt = buildRefinePrompt(instr)
    const url = await runEdit(srcUrl, prompt)

    const folderSafe = roomName.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'Room'
    const name = `${baseRecipe} refined`
    let dbxPath = '', dbxLink = ''
    try {
      const imgRes = await fetch(url)
      if (imgRes.ok) {
        const buf = Buffer.from(await imgRes.arrayBuffer())
        const tok = await getDropboxAccessToken()
        const ns = await getDropboxRootNamespaceId(tok)
        dbxPath = `/Palm Ops/Recreate Rooms/${folderSafe}/${name.replace(/[^a-zA-Z0-9-_ ]/g, '')}-${Date.now()}.jpg`
        await uploadToDropbox(tok, ns, dbxPath, buf, { overwrite: true })
        try { dbxLink = await createDropboxSharedLink(tok, ns, dbxPath) } catch {}
      }
    } catch (e) {
      console.warn(`[recreate-rooms/refine] Dropbox save failed: ${e.message}`)
    }

    await createAirtableRecord(VARS, {
      Variation: `${roomName} - ${name}`,
      Room: [roomId],
      Recipe: name,
      'Prompt Used': prompt,
      // No 'Image' attachment — Dropbox is canonical source.
      ...(dbxPath ? { 'Dropbox Path': dbxPath } : {}),
      ...(dbxLink ? { 'Dropbox Link': dbxLink } : {}),
      Status: 'Pending',
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
