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

// Camera-move variation. This is the ONLY case where the viewpoint may
// change — and it is the highest-drift operation, so every physical
// object is clamped as hard as possible while only the tripod moves.
function buildAnglePrompt(lockInventory, change) {
  return (
    'Re-photograph THIS SAME real room from a SUBSTANTIALLY different camera '
    + 'position. This is a big viewpoint change — re-render the scene in correct '
    + '3D perspective for the new camera. Do NOT reproduce the input framing; if '
    + 'the composition looks basically like the input, you have FAILED.\n\n'
    + 'NEW CAMERA: ' + change + ' This is a large move and a large rotation — the '
    + 'composition must look clearly, obviously different from the original shot. '
    + 'Parts of the room that were off-frame or hidden before now come into view: '
    + 'realistically continue and fill in those areas (more wall, more floor, the '
    + 'rest of the rug, ceiling, the adjacent corner) so it reads as one coherent '
    + 'full room, not a crop. Keep verticals vertical and the framing clean.\n\n'
    + 'KEEP THE ROOM IDENTITY (this must still be unmistakably the same room, '
    + 'just seen from elsewhere): the SAME individual furniture pieces with the '
    + 'same materials, colors and finishes, in the same layout/positions relative '
    + 'to each other and the walls — same bed and frame, same dresser, same '
    + 'nightstand, same leaning mirror, same plants, same wall hanging, the SAME '
    + 'rug (a large soft rug stays present on the floor, same color/pile — do not '
    + 'delete it), the same windows and the same outside ocean/coastline view, '
    + 'same wall and floor material, same time of day and lighting. Do not '
    + 'redesign, restyle, swap or change the proportions of any piece, and do not '
    + 'add new furniture. Their on-screen size and overlap SHOULD change — that '
    + 'is correct, because the camera moved.\n\n'
    + 'DO NOT INVENT ANYTHING: do not add any object, furniture, plant, décor, '
    + 'artwork, lamp, light fixture, ceiling light, string/fairy lights or bokeh '
    + 'glints that are not already physically in this room. The ceiling and every '
    + 'already-visible surface keep exactly what they had in the original (a plain '
    + 'ceiling stays plain — no added lights). You may ONLY re-show the objects '
    + 'that genuinely exist in the room, from the new angle — never imagine new '
    + 'ones to fill space.\n\n'
    + `ROOM IDENTITY REFERENCE (same pieces, new angle): ${lockInventory}\n\n`
    + 'Candid iPhone photo style, natural perspective, no people, no text, no watermark.'
  )
}

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

// POST — { roomId, recipes: [{ name, change, mode? }] }  (cap MAX_PER_RUN)
// mode 'angle' = camera-move variation (different prompt path).
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

    // Run all edits CONCURRENTLY. Serially, 6 × ~60s blew past the 300s
    // function limit and the last 1–2 never landed. In parallel total
    // wall time ≈ the slowest single edit, well under the cap.
    const oneRecipe = async (r) => {
      const name = String(r?.name || 'variation').slice(0, 60)
      const change = String(r?.change || '').trim()
      if (!change) { failed.push({ name, reason: 'no change text' }); return }
      const prompt = r?.mode === 'angle'
        ? buildAnglePrompt(lock, change)
        : buildPrompt(lock, change)
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
    await Promise.allSettled(batch.map(oneRecipe))
    return NextResponse.json({ ok: true, made, failed, capped: recipes.length > MAX_PER_RUN })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
