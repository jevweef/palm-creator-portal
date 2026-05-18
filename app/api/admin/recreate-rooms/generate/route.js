import { NextResponse } from 'next/server'
import { requireAdmin, createAirtableRecord, OPS_BASE } from '@/lib/adminAuth'
import { submitWaveSpeedTask, pollWaveSpeedTask } from '@/lib/wavespeed'

export const maxDuration = 300

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const ROOMS = 'Recreate Rooms'
const VARS = 'Recreate Room Variations'
const EDIT_MODEL = 'google/nano-banana-2/edit'
const MAX_PER_RUN = 6

function buildPrompt(lockInventory, change) {
  return (
    'Minimal local edit of this photo — do NOT re-render, restyle, relight or '
    + 'reinterpret the scene. Copy the input image pixel-faithfully EXCEPT for '
    + 'the one small change below.\n\n'
    + `DO NOT CHANGE (the room's permanent identity — keep identical): ${lockInventory}\n\n`
    + `ONLY THIS CHANGES: ${change}\n\n`
    + 'This is everyday life in the SAME room: only ordinary transient things '
    + '(bedding, clutter brought in/out, items on surfaces, how open the '
    + 'curtains are, time of day and lighting) may differ — and only exactly '
    + 'as instructed above. Everything else stays pixel-identical. '
    + 'Same candid iPhone photo style, consistent room, no people, no text, no watermark.'
  )
}

async function runEdit(baseUrl, prompt) {
  const task = await submitWaveSpeedTask(EDIT_MODEL, {
    images: [baseUrl],
    prompt,
    aspect_ratio: '9:16',
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
        await createAirtableRecord(VARS, {
          Variation: `${roomName} - ${name}`,
          Room: [roomId],
          Recipe: name,
          'Prompt Used': prompt,
          Image: [{ url }],
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
