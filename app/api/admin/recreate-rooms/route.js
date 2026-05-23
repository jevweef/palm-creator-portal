import { NextResponse } from 'next/server'
import { requireAdmin, requireAdminOrAiEditor, fetchAirtableRecords, createAirtableRecord, patchAirtableRecord, OPS_BASE } from '@/lib/adminAuth'
import { submitWaveSpeedTask, pollWaveSpeedTask } from '@/lib/wavespeed'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'
import { recreateImageUrl } from '@/lib/recreateImageUrl'

export const maxDuration = 300

const rawDbx = (u) => u ? String(u).replace('dl=0', 'raw=1').replace('dl=1', 'raw=1') : ''

// Push a remote image URL (e.g. WaveSpeed t2i output) to Dropbox as the
// full-res master. Returns { path, link } or null on failure (non-fatal).
async function masterToDropbox(srcUrl, path) {
  try {
    const r = await fetch(srcUrl)
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    const tok = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(tok)
    await uploadToDropbox(tok, ns, path, buf, { overwrite: true })
    let link = ''
    try { link = await createDropboxSharedLink(tok, ns, path) } catch {}
    return { path, link }
  } catch { return null }
}

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const ROOMS = 'Recreate Rooms'
const VARS = 'Recreate Room Variations'
const T2I_MODEL = 'openai/gpt-image-2/text-to-image'

// Default "do not change" lock list — editable per room in the UI. It's
// prepended to every variation edit so fixed objects (esp. plants) stay put.
const DEFAULT_LOCK = (
  'the room architecture, all walls, the windows and the EXACT outside view, '
  + 'ceiling, floor, the rug (same size/pile/placement), the bed frame and its '
  + 'position, the headboard, the nightstand and the items on it, the dresser '
  + 'and the décor object on it, the standing mirror, the macramé wall hanging, '
  + 'and EVERY plant in the room and on the dresser — same plant, same pot, same '
  + 'size, same position, same count; never add, remove, swap or restyle a plant. '
  + 'Keep the bedding/comforter the exact same color, fabric and pattern. Keep '
  + 'the EXACT same camera angle, framing, perspective and lens.'
)

async function genBaseImage(prompt) {
  const task = await submitWaveSpeedTask(T2I_MODEL, {
    prompt,
    aspect_ratio: '9:16',
    resolution: '4k',
    quality: 'high',
  })
  const t0 = Date.now()
  while (Date.now() - t0 < 240000) {
    const d = await pollWaveSpeedTask(task.id)
    if (d.status === 'completed') {
      const out = (d.outputs || [])[0]
      if (!out) throw new Error('no image output')
      return out
    }
    if (d.status === 'failed') throw new Error(d.error || 'generation failed')
    await new Promise(r => setTimeout(r, 3000))
  }
  throw new Error('generation timed out')
}

// GET — TJP creators + all rooms + their variations
export async function GET() {
  try {
    await requireAdminOrAiEditor()
    const [creators, rooms, vars] = await Promise.all([
      fetchAirtableRecords('Palm Creators', {
        fields: ['Creator', 'AKA', 'TJP Enabled'],
        filterByFormula: '{TJP Enabled} = 1',
      }),
      fetchAirtableRecords(ROOMS, {
        fields: ['Room Name', 'Creator', 'Angle', 'Base Prompt', 'Lock Inventory', 'Base Image', 'Base Dropbox Link', 'Status', 'Framing'],
      }),
      fetchAirtableRecords(VARS, {
        fields: ['Variation', 'Room', 'Recipe', 'Image', 'Status', 'Dropbox Link'],
      }),
    ])
    // Dropbox-first image resolver (recreateImageUrl imported at top).
    // Rooms use 'Base Dropbox Link' + 'Base Image'; Variations use the
    // default 'Dropbox Link' + 'Image'.
    return NextResponse.json({
      creators: creators
        .map(c => ({ id: c.id, name: c.fields?.AKA || c.fields?.Creator || 'Unknown' }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      rooms: rooms.map(r => {
        const f = r.fields || {}
        return {
          id: r.id,
          name: f['Room Name'] || '',
          creatorId: Array.isArray(f.Creator) ? f.Creator[0] : null,
          angle: f.Angle || '',
          basePrompt: f['Base Prompt'] || '',
          lockInventory: f['Lock Inventory'] || DEFAULT_LOCK,
          baseImage: recreateImageUrl(f, { linkField: 'Base Dropbox Link', attField: 'Base Image' }),
          status: f.Status?.name || f.Status || 'Draft',
          framing: f.Framing?.name || f.Framing || null,
        }
      }),
      variations: vars.map(v => {
        const f = v.fields || {}
        return {
          id: v.id,
          roomId: Array.isArray(f.Room) ? f.Room[0] : null,
          recipe: f.Recipe || '',
          image: recreateImageUrl(f),
          dropbox: f['Dropbox Link'] ? String(f['Dropbox Link']).replace('dl=0', 'dl=1') : null,
          status: f.Status?.name || f.Status || 'Pending',
        }
      }),
    })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST — create a Draft room. Either generate the base (basePrompt) OR
// use an uploaded image (imageBase64) — for rooms you already made.
export async function POST(request) {
  try {
    await requireAdmin()
    // baseDropboxPath = browser already uploaded the FULL-RES image
    // straight to Dropbox (via upload-token). basePrompt = generate it.
    const { creatorId, roomName, angle, basePrompt, baseDropboxPath } = await request.json()
    if (!creatorId || !/^rec[A-Za-z0-9]{14}$/.test(creatorId)) {
      return NextResponse.json({ error: 'Valid creatorId required' }, { status: 400 })
    }
    if (!roomName?.trim()) {
      return NextResponse.json({ error: 'roomName required' }, { status: 400 })
    }
    if (!baseDropboxPath && !basePrompt?.trim()) {
      return NextResponse.json({ error: 'Provide an uploaded image or a base prompt' }, { status: 400 })
    }

    const fields = {
      'Room Name': roomName.trim(),
      Creator: [creatorId],
      Angle: (angle || 'Main').trim(),
      'Base Prompt': (basePrompt || '').trim(),
      'Lock Inventory': DEFAULT_LOCK,
      Status: 'Draft',
    }

    const safe = roomName.trim().replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'room'
    if (baseDropboxPath) {
      // Full-res master is already in Dropbox. Mint a shared link so the
      // UI + downstream consumers can fetch it. No Airtable attachment —
      // Dropbox is the only source of truth (per architecture policy).
      const tok = await getDropboxAccessToken()
      const ns = await getDropboxRootNamespaceId(tok)
      let link = ''
      try { link = await createDropboxSharedLink(tok, ns, baseDropboxPath) } catch {}
      fields['Base Dropbox Path'] = baseDropboxPath
      if (link) fields['Base Dropbox Link'] = link
    } else {
      // t2i — push the full-res model output to Dropbox as master, then
      // store ONLY the Dropbox path/link on the Airtable record. If the
      // upload fails we keep the record minimal; user can re-run.
      const baseUrl = await genBaseImage(basePrompt)
      const m = await masterToDropbox(baseUrl, `/Palm Ops/Recreate Rooms/${safe}/_base/${safe}-${Date.now()}.jpg`)
      if (m) {
        fields['Base Dropbox Path'] = m.path
        if (m.link) fields['Base Dropbox Link'] = m.link
      } else {
        // Dropbox push failed — record gets created without a base image
        // reference. Surface clearly so the user knows to re-run.
        console.warn('[recreate-rooms POST] t2i image generated but Dropbox push failed; room created without Base Dropbox Path')
      }
    }
    const created = await createAirtableRecord(ROOMS, fields)
    const roomId = created?.records?.[0]?.id || created?.id
    return NextResponse.json({ ok: true, roomId })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH — { roomId, action: 'lock' | 'regenerate' | 'updateLock', lockInventory?, roomName? }
export async function PATCH(request) {
  try {
    await requireAdmin()
    const { roomId, action, lockInventory, roomName, baseDropboxPath } = await request.json()
    if (!roomId || !/^rec[A-Za-z0-9]{14}$/.test(roomId)) {
      return NextResponse.json({ error: 'Valid roomId required' }, { status: 400 })
    }
    const recRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(ROOMS)}/${roomId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' })
    if (!recRes.ok) return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    const f = (await recRes.json()).fields || {}

    if (action === 'regenerate') {
      const url = await genBaseImage(f['Base Prompt'] || '')
      await patchAirtableRecord(ROOMS, roomId, { 'Base Image': [{ url }], Status: 'Draft' })
      return NextResponse.json({ ok: true, baseImage: url })
    }
    if (action === 'replaceImage') {
      // Full-res replacement already uploaded to Dropbox via upload-token.
      if (!baseDropboxPath) return NextResponse.json({ error: 'baseDropboxPath required' }, { status: 400 })
      const tok = await getDropboxAccessToken()
      const ns = await getDropboxRootNamespaceId(tok)
      let link = ''
      try { link = await createDropboxSharedLink(tok, ns, baseDropboxPath) } catch {}
      await patchAirtableRecord(ROOMS, roomId, {
        'Base Image': link ? [{ url: rawDbx(link) }] : [],
        'Base Dropbox Path': baseDropboxPath,
        ...(link ? { 'Base Dropbox Link': link } : {}),
        Status: 'Draft',
      })
      return NextResponse.json({ ok: true })
    }
    if (action === 'lock') {
      await patchAirtableRecord(ROOMS, roomId, {
        Status: 'Locked',
        ...(lockInventory ? { 'Lock Inventory': lockInventory } : {}),
        ...(roomName ? { 'Room Name': roomName } : {}),
      }, { typecast: true })
      return NextResponse.json({ ok: true })
    }
    if (action === 'updateLock') {
      await patchAirtableRecord(ROOMS, roomId, { 'Lock Inventory': lockInventory || '' })
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE ?roomId= — remove a room (and its variations)
export async function DELETE(request) {
  try {
    await requireAdmin()
    const roomId = new URL(request.url).searchParams.get('roomId')
    if (!roomId || !/^rec[A-Za-z0-9]{14}$/.test(roomId)) {
      return NextResponse.json({ error: 'Valid roomId required' }, { status: 400 })
    }
    // ARRAYJOIN({Room}) yields primary-field text not rec IDs, so a
    // FIND() filter silently returns nothing — fetch all + match the
    // link array client-side instead.
    const vars = await fetchAirtableRecords(VARS, { fields: ['Room'] })
    const dupIds = vars.filter(v => (v.fields?.Room || []).includes(roomId)).map(v => v.id)
    for (let i = 0; i < dupIds.length; i += 10) {
      const qs = dupIds.slice(i, i + 10).map(id => `records[]=${id}`).join('&')
      await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(VARS)}?${qs}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } }).catch(() => {})
    }
    await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(ROOMS)}/${roomId}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } })
    return NextResponse.json({ ok: true, deletedVariations: dupIds.length })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
