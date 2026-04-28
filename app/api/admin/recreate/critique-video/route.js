import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const GEMINI_MODEL = 'gemini-2.5-flash'

const SYSTEM_INSTRUCTION = `You are reviewing a Kling V3.0 Pro image-to-video output for an OnlyFans creator reel recreation pipeline. Your job is to identify what's wrong with the video so the operator can iterate on prompts/settings.

Focus on these failure modes (be specific — call out timestamps and exact issues):
- IDENTITY DRIFT — does her face/skin/hair stay consistent throughout, or does the model morph her into someone else mid-clip?
- POSE BREAKS — extra limbs, hands phasing through body, body parts swapping, head detaching, hair clipping through skin/clothes.
- TRANSITION SMOOTHNESS — if there's a tail_image, does the motion between start and end look natural, or does it teleport / robot / jitter?
- MOTION FIDELITY — does the action match what a real reel would show, or is it stiff / unnatural / repetitive?
- CAMERA BEHAVIOR — does it match the prompt (tripod static / handheld / etc.) or does Kling add zoom/pan that wasn't asked for?
- LIGHTING / SCENE STABILITY — does the background morph or stay locked? Lighting shift mid-clip?
- HAIR PHYSICS — natural mid-motion behavior or AI-tell wig-flutter?
- LIP SYNC — if she's speaking, does the mouth match the audio? (You can hear the audio in the muxed clip.)
- AUDIO SYNC — does the audio start at the right moment, or is the music misaligned with the visual beat?
- AI ARTIFACTS — uncanny smoothing, plastic skin, glow halo, magazine-glossiness Wan didn't have but Kling reintroduced.

Output via the submit_critique tool with these sections:
- overall: one sentence summary — would this pass for a real reel?
- topIssues: array of 1-4 strings, each one specific issue with timestamp and what to fix
- whatWorked: array of 1-3 strings — things that landed well
- recommendedFix: one concrete next-step suggestion (e.g. "tighten cfg_scale to 0.7", "drop tail_image and let motion prompt drive", "shift audio offset by 0.5s")`

async function fetchVideoBuffer(videoUrl) {
  const res = await fetch(videoUrl, { redirect: 'follow' })
  if (!res.ok) throw new Error(`Video fetch failed: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > 18 * 1024 * 1024) {
    throw new Error(`Video too large (${(buf.length / 1024 / 1024).toFixed(1)}MB). Limit is ~18MB inline.`)
  }
  return buf
}

// POST — body: { videoUrl }
// Returns: { ok, critique: { overall, topIssues, whatWorked, recommendedFix } }
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { videoUrl } = await request.json()
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
          { text: 'Review this Kling V3.0 Pro animation output. Use the submit_critique tool.' },
        ],
      }],
      tools: [{
        functionDeclarations: [{
          name: 'submit_critique',
          description: 'Submit a structured critique of the Kling animation output.',
          parameters: {
            type: 'object',
            properties: {
              overall: { type: 'string', description: 'One-sentence summary — would this pass for a real reel?' },
              topIssues: {
                type: 'array',
                items: { type: 'string' },
                description: '1-4 specific issues with timestamps and what to fix.',
              },
              whatWorked: {
                type: 'array',
                items: { type: 'string' },
                description: '1-3 things that landed well.',
              },
              recommendedFix: { type: 'string', description: 'Concrete next-step suggestion.' },
            },
            required: ['overall', 'topIssues', 'whatWorked', 'recommendedFix'],
          },
        }],
      }],
      toolConfig: {
        functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['submit_critique'] },
      },
    }

    let res, data
    const MAX_ATTEMPTS = 3
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) }
      )
      data = await res.json()
      if (res.ok) break
      const isTransient = res.status === 429 || res.status === 503 ||
        /UNAVAILABLE|RESOURCE_EXHAUSTED|overload|high demand/i.test(data?.error?.message || '')
      if (!isTransient || attempt === MAX_ATTEMPTS) break
      await new Promise(r => setTimeout(r, (2 ** attempt) * 1000 + Math.random() * 500))
    }
    if (!res.ok) {
      return NextResponse.json({ error: data?.error?.message || `Gemini ${res.status}` }, { status: 500 })
    }

    const candidates = data.candidates || []
    const parts = candidates[0]?.content?.parts || []
    const fnCall = parts.find(p => p.functionCall)?.functionCall
    if (!fnCall || fnCall.name !== 'submit_critique') {
      return NextResponse.json({ error: 'Gemini did not call the tool', raw: candidates[0]?.content }, { status: 500 })
    }

    return NextResponse.json({ ok: true, critique: fnCall.args })
  } catch (err) {
    console.error('[recreate/critique-video] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
