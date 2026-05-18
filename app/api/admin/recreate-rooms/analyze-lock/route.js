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
const SYSTEM_PROMPT = `You are building a "do-not-change lock list" for an image-edit pipeline. A creator's room photo is the fixed location for many AI content variations. The room's IDENTITY must stay byte-identical across every variation so it always reads as the same real apartment, while ordinary daily life (mess, clutter, light, time of day) is free to change. The human will NOT tell you what to lock — you already know how a real lived-in room behaves. Apply the universal model below to THIS image.

UNIVERSAL ROOM-REALISM MODEL — true for ANY room:

PERMANENT — the room's identity; ALWAYS lock these (name the specific ones visible in this image, with material/color/position):
- Shell: walls, ceiling, floor surface & material, room shape, doorways, the window / sliding-door openings themselves, built-ins, columns
- The view through the windows (the outside world does not change)
- Anchored furniture and its exact placement: bed frame + which wall it's against, headboard, dresser, nightstand(s), desk, shelving, wardrobe, large/standing mirror, seating, and the RUG (heavy — its size/placement stays)
- Fixed wall décor & fixtures: framed art, mounted mirror, macramé, mounted shelves, strung/fairy lights, light fixtures
- Every plant, in its planter and position (people don't swap plants daily)
- The camera: same tripod/spot films the same room — angle, height, framing, crop, perspective, lens

TRANSIENT — real daily life; NEVER lock or even mention these (they are the whole point of variations):
- Bed state: made / unmade / half-made, duvet, top sheet, throw blanket, pillow arrangement
- Things brought in & out: clothes, laundry, towels, bags, shoes, packages, shopping, books, a suitcase, a yoga mat
- What sits on surfaces day to day: phone, a glass of water or drink, a mug, a candle, makeup, chargers, jewelry, remotes
- Openings state: how far the sliding door / curtains / blinds are open
- Light & time: time of day, sun angle and warmth, sky, lamps on/off, candle lit, overall brightness and mood
- Overall tidiness level: spotless ↔ lived-in ↔ messy

EDGE RULES: a glass/mug/cup is TRANSIENT even though it "sits there". A plant or the rug is PERMANENT even though it's "an object". Curtains/blinds as fabric are PERMANENT, but how open they are is TRANSIENT. A standing mirror, dresser, lamp body = PERMANENT; whether the lamp is on = TRANSIENT.

OUTPUT: one concise imperative paragraph (no bullets, no preamble). Apply the model above: enumerate the SPECIFIC permanent elements actually visible in this image (real objects, material, color, position) and end with the camera-lock clause. Only describe what is genuinely visible — do not invent objects, and never mention any transient category.`

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
