import { NextResponse } from 'next/server'
import { requireAdmin, createAirtableRecord, OPS_BASE } from '@/lib/adminAuth'
import { submitWaveSpeedTask, pollWaveSpeedTask } from '@/lib/wavespeed'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'

export const maxDuration = 300

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const ROOMS = 'Recreate Rooms'
const VARS = 'Recreate Room Variations'
const EDIT_MODEL = 'google/nano-banana-2/edit'
const MAX_PER_RUN = 6

function buildPrompt(lockInventory, change) {
  return (
    'This is a TINY local edit of the photo. Treat the input image as final '
    + 'and reproduce it pixel-for-pixel, changing ONLY the one small thing '
    + 'described below. Do not re-render, regenerate, restyle or reinterpret '
    + 'the scene.\n\n'
    + 'HARD CONSTRAINTS — these are violations, not preferences: do NOT resize, '
    + 'rescale, stretch, move, rotate, add, remove, replace or redesign ANY '
    + 'furniture or object. The bed keeps the EXACT same size, shape, footprint '
    + 'and position. The rug keeps the EXACT same size, shape and position and '
    + 'must NOT be removed or shrunk. Walls, windows, the view, floor, dresser, '
    + 'nightstand, mirror, plants and décor keep their exact size and position. '
    + 'The camera does not move — identical framing, angle, perspective, crop, '
    + 'zoom.\n\n'
    + `KEEP IDENTICAL (the room's permanent identity): ${lockInventory}\n\n`
    + `THE ONLY THING THAT MAY CHANGE: ${change}\n\n`
    + 'Everything not explicitly named in that one change stays pixel-identical '
    + 'to the input. Same candid iPhone photo style, no people, no text, no watermark.'
  )
}

async function runEdit(baseUrl, prompt) {
  const task = await submitWaveSpeedTask(EDIT_MODEL, {
    images: [baseUrl],
    prompt,
    aspect_ratio: '9:16',
    resolution: '2k',          // full-res master (kept on Dropbox)
    output_format: 'jpeg',
  })
  const t0 = Date.now()
  while (Date.now() - t0 < 120000) {
    const d = await pollWaveSpeedTask(task.id)
    if (d.status === 'completed') {
      const out = (d.outputs || [])[0]
      if (!out) throw new Error('no output')
      return out
    }
    if (d.status === 'failed') throw new Error(d.error || 'edit failed')
    await new Promise(r => setTimeout(r, 3000))
  }
  throw new Error('edit timed out')
}

// POST — { roomId, recipes: [{ name, change }] }  (cap MAX_PER_RUN)
export async function POST(request) {
  try {
    await requireAdmin()
    const { roomId, recipes } = await request.json()
    if (!roomId || !/^rec[A-Za-z0-9]{14}$/.test(roomId)) {
      return NextResponse.json({ error: 'Valid roomId required' }, { status: 400 })
    }
    if (!Array.isArray(recipes) || recipes.length === 0) {
      return NextResponse.json({ error: 'recipes required' }, { status: 400 })
    }

    const rRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(ROOMS)}/${roomId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' })
    if (!rRes.ok) return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    const rf = (await rRes.json()).fields || {}
    if ((rf.Status?.name || rf.Status) !== 'Locked') {
      return NextResponse.json({ error: 'Lock the room before generating variations' }, { status: 400 })
    }
    const baseUrl = Array.isArray(rf['Base Image']) && rf['Base Image'][0]?.url
    if (!baseUrl) return NextResponse.json({ error: 'Room has no base image' }, { status: 400 })
    const lock = rf['Lock Inventory'] || ''
    const roomName = rf['Room Name'] || 'Room'

    // Dropbox = full-res master store (same as the rest of the system).
    let dbxToken = null, dbxNs = null
    try {
      dbxToken = await getDropboxAccessToken()
      dbxNs = await getDropboxRootNamespaceId(dbxToken)
    } catch (e) {
      console.warn('[recreate-rooms/generate] Dropbox auth failed (variations still saved to Airtable):', e.message)
    }
    const folderSafe = roomName.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'Room'

    const batch = recipes.slice(0, MAX_PER_RUN)
    const made = []
    const failed = []
    for (const r of batch) {
      const name = String(r?.name || 'variation').slice(0, 60)
      const change = String(r?.change || '').trim()
      if (!change) { failed.push({ name, reason: 'no change text' }); continue }
      const prompt = buildPrompt(lock, change)
      try {
        const url = await runEdit(baseUrl, prompt)

        // Pull the full-res model output and store it as the Dropbox
        // master. Non-fatal: if Dropbox fails the variation still lands
        // in Airtable (the gallery), just without a master link.
        let dbxPath = '', dbxLink = ''
        if (dbxToken) {
          try {
            const imgRes = await fetch(url)
            if (imgRes.ok) {
              const buf = Buffer.from(await imgRes.arrayBuffer())
              dbxPath = `/Palm Ops/Recreate Rooms/${folderSafe}/${name.replace(/[^a-zA-Z0-9-_ ]/g, '')}-${Date.now()}.jpg`
              await uploadToDropbox(dbxToken, dbxNs, dbxPath, buf, { overwrite: true })
              try { dbxLink = await createDropboxSharedLink(dbxToken, dbxNs, dbxPath) } catch {}
            }
          } catch (e) {
            console.warn(`[recreate-rooms/generate] Dropbox save failed for ${name}: ${e.message}`)
          }
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
        made.push(name)
      } catch (e) {
        failed.push({ name, reason: e.message })
      }
    }
    return NextResponse.json({ ok: true, made, failed, capped: recipes.length > MAX_PER_RUN })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
