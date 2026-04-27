import { NextResponse } from 'next/server'
import { requireAdmin, patchAirtableRecord } from '@/lib/adminAuth'

const INSPIRATION_TABLE = 'tblnQhATaMtpoYErb'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const GEMINI_MODEL = 'gemini-2.5-flash'

const SYSTEM_INSTRUCTION = `You watch a short Instagram reel and produce a compact "video context" summary that will be injected into a separate per-frame analysis pass. The downstream consumer (Claude Sonnet) sees ONE still image at a time and can't tell what's happening across the timeline. Your job is to give it the cross-frame context it can't derive from a single frame.

Output via the submit_video_context tool. Keep it tight — 6-10 short bullet lines, each starting with "- ".

Cover ONLY the things Sonnet can't see from a still:
- Beat-by-beat action (what happens 0:00 → 0:01 → 0:02 ...). Brief — one phrase per beat.
- Cross-frame props/wardrobe/object continuity (e.g. "she removes her white underwear and uses it to tie her hair at 0:06" — Sonnet looking at the end frame would otherwise mistake the underwear-as-hair-tie for a regular fabric tie).
- Things that change across the video (clothing changes, hair styling changes, prop introductions, prop removals).
- Setting reveals only visible at certain moments (e.g. "ring light blinks on at 0:03 — visible in some frames, not others").
- Audio cues that affect framing (lip sync timing, voiceover content if relevant to action).

Do NOT include:
- Physical character traits (hair color, body type, age, ethnicity, makeup) — those come from reference images.
- Generic scene description that's already obvious in any frame (e.g. "she's in a bedroom").
- Camera-direction jargon, fantasy language, mood adjectives.

Example output for a reel where a creator films herself getting ready:
- 0:00–0:01: subject walks into frame from the right, full body framing.
- 0:01–0:03: stops in front of a desk, hair flips back as she turns.
- 0:03–0:04: removes white cotton underwear from under her oversized blue shirt.
- 0:04–0:06: uses the underwear as a hair tie, ties hair into a low ponytail.
- 0:06–end: turns toward camera, glances back over shoulder. Camera stays static on tripod.
- Wardrobe is constant: oversized light blue button-up shirt, fully buttoned, worn as dress. No pants or visible underwear after 0:06.
- iPhone + ring light tripod stays in same position bottom-right entire time.`

async function fetchVideoBuffer(videoUrl) {
  const res = await fetch(videoUrl, { redirect: 'follow' })
  if (!res.ok) throw new Error(`Video fetch failed: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > 18 * 1024 * 1024) {
    throw new Error(`Video too large (${(buf.length / 1024 / 1024).toFixed(1)}MB). Limit is ~18MB inline.`)
  }
  return buf
}

// POST — body: { videoUrl, inspoRecordId? }
// Returns: { ok, videoContext }
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { videoUrl, inspoRecordId } = await request.json()
    if (!videoUrl) return NextResponse.json({ error: 'Missing videoUrl' }, { status: 400 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY is not set' }, { status: 500 })

    const buf = await fetchVideoBuffer(videoUrl)
    const base64Video = buf.toString('base64')
    const mimeType = videoUrl.toLowerCase().includes('.mov') ? 'video/quicktime' : 'video/mp4'

    const requestBody = {
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: base64Video } },
          { text: 'Analyze this reel and produce the cross-frame video context summary. Use the submit_video_context tool.' },
        ],
      }],
      tools: [{
        functionDeclarations: [{
          name: 'submit_video_context',
          description: 'Submit the cross-frame video context summary for this reel.',
          parameters: {
            type: 'object',
            properties: {
              videoContext: {
                type: 'string',
                description: '6-10 bullet lines starting with "- " covering beat-by-beat action and cross-frame details a per-frame analyzer would miss.',
              },
            },
            required: ['videoContext'],
          },
        }],
      }],
      toolConfig: {
        functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['submit_video_context'] },
      },
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      }
    )
    const data = await res.json()
    if (!res.ok) {
      console.error('[extract-video-context] Gemini error:', data)
      return NextResponse.json({ error: data?.error?.message || `Gemini ${res.status}` }, { status: 500 })
    }

    const candidates = data.candidates || []
    const parts = candidates[0]?.content?.parts || []
    const fnCall = parts.find(p => p.functionCall)?.functionCall
    if (!fnCall || fnCall.name !== 'submit_video_context') {
      return NextResponse.json({
        error: 'Gemini did not call the tool',
        raw: candidates[0]?.content,
      }, { status: 500 })
    }

    const { videoContext } = fnCall.args || {}
    if (!videoContext) {
      return NextResponse.json({ error: 'Tool input missing videoContext', raw: fnCall.args }, { status: 500 })
    }

    if (inspoRecordId) {
      try {
        await patchAirtableRecord(INSPIRATION_TABLE, inspoRecordId, {
          'Recreate Video Context': videoContext,
        })
      } catch (e) {
        console.warn('[extract-video-context] Airtable cache write failed:', e.message)
      }
    }

    return NextResponse.json({ ok: true, videoContext })
  } catch (err) {
    console.error('[recreate/extract-video-context] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
