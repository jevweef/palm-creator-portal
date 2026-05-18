import { NextResponse } from 'next/server'
import { requireAdmin, patchAirtableRecord, OPS_BASE } from '@/lib/adminAuth'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const ROOMS = 'Recreate Rooms'
const MODEL = 'claude-sonnet-4-6'

// Framework: tell Sonnet the permanent-vs-transient taxonomy so it locks
// the right things — the room's identity — and explicitly does NOT lock
// the things that are SUPPOSED to vary between content posts.
const SYSTEM_PROMPT = `You are building a "do-not-change lock list" for an image-edit pipeline. A creator's room photo is the fixed location for many AI content variations. Each variation will edit ONLY transient things (bed made/messy, clothes/objects in or out, time of day, lighting, curtains). The room's IDENTITY must stay byte-identical across every variation so it always reads as the same real apartment.

Look at THIS specific image and write the lock list of what must NEVER change. Be concrete and specific to what is actually visible — name the real objects, their material, color, and position. Generic lists cause drift; specific ones hold.

LOCK (permanent — list the ones actually present in this image, specifically):
- Architecture: walls, ceiling, room shape, doorways, structural columns
- Windows / glass walls and the EXACT view through them (buildings, ocean, sky, foliage)
- Flooring (material, color)
- Large furniture and its exact placement: bed frame + where it sits, headboard + which wall, dresser, nightstand(s), mirror (type/shape), desk, shelving, seating
- The rug (size, pile, color, placement)
- Wall décor and fixtures: framed art, macramé, mirrors, strung lights, sconces — only if present
- EVERY plant: count, each plant's type, its pot/planter, size, and exact location (e.g. "the large monstera in a woven basket on the floor left of the window")
- The camera: exact angle, height, framing, crop, perspective and lens

DO NOT LOCK (these are the whole point of variations — never mention them as fixed):
- Bedding state (made/messy), duvet, throw blankets, pillow arrangement
- Clothes, laundry, bags, shoes, cups, books, makeup, packing — anything that naturally comes and goes
- Items sitting on the nightstand/dresser that would change day to day
- Time of day, sky, lighting mood, lamps on/off, candles, how open the curtains are

OUTPUT: one concise imperative paragraph (no bullets, no preamble) that starts describing the specific permanent elements to keep identical and ENDS with the camera-lock clause. Only describe what is genuinely visible in this image. Do not invent objects. Do not mention any transient/variable element.`

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
    const f = (await rRes.json()).fields || {}
    const imgUrl = Array.isArray(f['Base Image']) && f['Base Image'][0]?.url
    if (!imgUrl) return NextResponse.json({ error: 'Room has no base image' }, { status: 400 })

    // Anthropic's URL fetcher respects robots.txt (Airtable/Dropbox block
    // bots) → always pass base64.
    const imgRes = await fetch(imgUrl)
    if (!imgRes.ok) return NextResponse.json({ error: `Image fetch failed (${imgRes.status})` }, { status: 400 })
    const b64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64')
    const ct = imgRes.headers.get('content-type') || ''
    const m = ct.match(/^(image\/[a-z]+)/i)
    const mediaType = m ? m[1].toLowerCase().replace('image/jpg', 'image/jpeg') : 'image/jpeg'

    const tool = {
      name: 'submit_lock_list',
      description: 'Submit the do-not-change lock list for this room image.',
      input_schema: {
        type: 'object',
        properties: {
          lockList: {
            type: 'string',
            description: 'One concise imperative paragraph of the specific permanent elements in THIS image to keep identical, ending with the camera-lock clause. No transient/variable elements.',
          },
        },
        required: ['lockList'],
      },
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'submit_lock_list' },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
          { type: 'text', text: 'Write the do-not-change lock list for this room using the submit_lock_list tool.' },
        ],
      }],
    })

    const toolUse = resp.content.find(b => b.type === 'tool_use')
    const lockList = toolUse?.input?.lockList?.trim()
    if (!lockList) {
      return NextResponse.json({ error: `Sonnet did not return a lock list (stop: ${resp.stop_reason})` }, { status: 500 })
    }
    await patchAirtableRecord(ROOMS, roomId, { 'Lock Inventory': lockList })
    return NextResponse.json({ ok: true, lockList })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 })
  }
}
