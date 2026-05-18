import { NextResponse } from 'next/server'
import { requireAdmin, createAirtableRecord, OPS_BASE } from '@/lib/adminAuth'
import { submitWaveSpeedTask, pollWaveSpeedTask } from '@/lib/wavespeed'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'

export const maxDuration = 200

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const VARS = 'Recreate Room Variations'
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
  while (Date.now() - t0 < 150000) {
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

// POST { variationId, instruction } — edits that variation's image and
// saves the result as a NEW variation under the same room.
export async function POST(request) {
  try {
    await requireAdmin()
    const { variationId, instruction } = await request.json()
    if (!variationId || !/^rec[A-Za-z0-9]{14}$/.test(variationId)) {
      return NextResponse.json({ error: 'Valid variationId required' }, { status: 400 })
    }
    const instr = String(instruction || '').trim()
    if (!instr) return NextResponse.json({ error: 'instruction required' }, { status: 400 })

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
      Image: [{ url }],
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
