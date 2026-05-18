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
    + 'rest of the rug, ceiling, the adjacent corner). Keep verticals vertical.\n\n'
    + 'FAILURE CONDITION — reject and re-shoot if this happens: the result is the '
    + 'WIDE full-room establishing shot with the bed running along the LEFT side, '
    + 'the windows/ocean centered in the background, and the dresser on the RIGHT. '
    + 'That is the ORIGINAL framing. If your output looks like that you have '
    + 'FAILED. The named subject below must dominate the CENTER of the frame in a '
    + 'tighter, closer composition — not a far wide view of the whole room.\n\n'
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
    'Same room, same camera — a DIFFERENT DAY in this room. Keep the camera '
    + 'locked (identical framing, angle, perspective, crop, zoom) and keep the '
    + "room's PERMANENT IDENTITY exactly: every furniture piece (bed, frame, "
    + 'dresser, nightstand, leaning mirror), the wall hanging, the architecture, '
    + 'walls, ceiling, the windows and the exact outside view, the floor material, '
    + 'and the rug — same rug, same size, same position (do not delete, resize or '
    + 'move it). Furniture does not move, resize or change.\n\n'
    + `PERMANENT IDENTITY (must stay identical): ${lockInventory}\n\n`
    + 'But the LIVED-IN / TRANSIENT layer genuinely changes, the way a real room '
    + 'looks on a different day — and it must change across the WHOLE scene, NOT '
    + 'clustered in one spot:\n'
    + `• THE CHANGE TO STAGE: ${change}\n`
    + '• Spread it through the frame — use the BARE porcelain tile floor (not '
    + 'just the rug), the room EDGES and corners, AGAINST THE LEFT WALL by the '
    + 'nightstand, and the lower-LEFT or lower-RIGHT corners of the frame — not '
    + 'only on or beside the bed.\n'
    + '• KEEP THE DEAD-CENTER FOREGROUND AND CENTER FLOOR CLEAR: the bottom-center '
    + 'and the open central floor in front of the bed must stay empty — a person '
    + 'will stand there. Any near-camera item sits off to the far LEFT or far '
    + 'RIGHT edge. Large flat items (a yoga mat, a towel spread out) go along the '
    + 'SIDE by the windows or against a wall, parallel to it — never unrolled '
    + 'across the center of the room.\n'
    + '• Clothing is TOSSED and crumpled — casually thrown, draped, rumpled, '
    + 'half-inside-out — NOT laid out flat, spread perfectly or arranged. (A '
    + 'folded laundry stack may be neat; loose garments are messy.)\n'
    + '• Clutter is ADDITIVE: never strip a surface bare to make room. The '
    + 'nightstand and dresser KEEP everything already on them by default (lamp, '
    + 'candle, glass, books, frames, décor) — those stay exactly as in the '
    + 'original. A draped piece of clothing may be ADDED on top of/beside them, '
    + 'but do not remove or clear their existing items first. Clothing on the '
    + 'dresser/back table must be casually DRAPED or tossed — never a neat '
    + 'folded stack of laundry on the dresser.\n'
    + '• Do NOT add any plants, greenery or pots — every plant in the room is '
    + 'permanent and fixed; never introduce a new one (especially not in front '
    + 'of the nightstand).\n'
    + '• The shag rug is soft: its pile realistically looks pushed around, '
    + 'walked-on, a little uneven or footprinted — NOT perfectly vacuumed and '
    + 'flat. Its size, shape and position stay the same.\n'
    + '• The trailing vine plants drape/hang a little differently than before — '
    + 'as if they were watered and nudged — same plants, same pots, same spots.\n'
    + '• Favor VARIETY OF PLACEMENT over quantity: a believable amount of stuff '
    + '(often just one or two items: a couple pieces of clothing, a folded '
    + 'laundry stack, a bag), but in places it would not have been before.\n\n'
    + 'Photoreal, same candid iPhone style and lighting unless the change says '
    + 'otherwise. No people, no text, no watermark, no added furniture or décor.'
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
