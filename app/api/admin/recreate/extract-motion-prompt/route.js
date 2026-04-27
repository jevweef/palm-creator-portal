import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const GEMINI_MODEL = 'gemini-2.5-flash'

const SYSTEM_INSTRUCTION = `You analyze a short Instagram reel video and produce a Kling V3.0 4K image-to-video MOTION prompt that describes what's happening on screen so a Kling task can animate a still image to match.

Critical rule: do NOT describe physical character traits (hair length, hair color, eye color, face shape, body type, skin tone, ethnicity, age, makeup). Those come from the still image. Describe only ACTION, MOTION, and CAMERA behavior.

Output via the submit_motion_prompt tool. Format requirements:

positivePrompt — one paragraph, copy-paste ready, structured like:
- Start with camera framing: "Selfie shot of...", "Mirror selfie of...", "Static shot of...", "Tripod static shot of...", "Handheld shot of...", etc.
- Describe the subject as "an american girl" (or other accent if clearly different) — keep generic
- Describe the literal action / motion beat by beat (walks into frame from left, brushes hair, glances at camera, mouths along to audio, body weight shifts onto right hip, etc.)
- If she speaks audibly, include the EXACT spoken quote: she said "..."
- End with motion descriptors: "Realistic lip sync, subtle hand-held movement, natural movements" (or "Static camera, no movement" for tripod)
- Add constraints when relevant: "no phone visible" if it's a tripod shot, "no cuts" for single-clip, etc.
- Add voice direction at the end: "american accent" (or other)
- No cinematic language. No fantasy words. No camera-direction jargon. No body-shape descriptors.

negativePrompt — comma-separated tokens preventing common Kling failure modes plus framing-specific blockers based on the video. Always include: cartoon, anime, illustration, painting, CGI, 3D render, plastic skin, airbrushed, beauty filter, cinematic lighting, studio lighting, blurry, low resolution, jpeg artifacts, watermark, text, logo, deformed face, asymmetric eyes, extra fingers, missing fingers, distorted hands, malformed hands, extra limbs, broken anatomy, mannequin, AI artifacts, uncanny valley, double face, multiple people, child, underage features, nudity, censor bars, scene cut, jump cut, transition, multiple shots. If video is tripod-static, also add: mirror selfie, mirror reflection, phone in hand, holding a smartphone, selfie pose. If subject doesn't speak, add: lip sync, mouth movement, talking.`

async function fetchVideoBuffer(videoUrl) {
  const res = await fetch(videoUrl, { redirect: 'follow' })
  if (!res.ok) throw new Error(`Video fetch failed: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  // Gemini inline data limit is ~20MB total request — leave headroom.
  if (buf.length > 18 * 1024 * 1024) {
    throw new Error(`Video too large (${(buf.length / 1024 / 1024).toFixed(1)}MB). Limit is ~18MB inline.`)
  }
  return buf
}

// POST — body: { videoUrl }
// Returns: { ok, positivePrompt, negativePrompt }
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { videoUrl } = await request.json()
    if (!videoUrl) return NextResponse.json({ error: 'Missing videoUrl' }, { status: 400 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY is not set' }, { status: 500 })

    const buf = await fetchVideoBuffer(videoUrl)
    const base64Video = buf.toString('base64')
    // Sniff MIME — most reels are mp4
    const mimeType = videoUrl.toLowerCase().includes('.mov') ? 'video/quicktime' : 'video/mp4'

    const requestBody = {
      systemInstruction: {
        parts: [{ text: SYSTEM_INSTRUCTION }],
      },
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: base64Video } },
          { text: 'Analyze this reel and produce the Kling V3.0 motion prompt. Use the submit_motion_prompt tool.' },
        ],
      }],
      tools: [{
        functionDeclarations: [{
          name: 'submit_motion_prompt',
          description: 'Submit the extracted Kling V3.0 motion prompt for this reel.',
          parameters: {
            type: 'object',
            properties: {
              positivePrompt: { type: 'string', description: 'One paragraph Kling motion prompt.' },
              negativePrompt: { type: 'string', description: 'Comma-separated negative tokens.' },
            },
            required: ['positivePrompt', 'negativePrompt'],
          },
        }],
      }],
      toolConfig: {
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames: ['submit_motion_prompt'],
        },
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
      console.error('[extract-motion-prompt] Gemini error:', data)
      return NextResponse.json({ error: data?.error?.message || `Gemini ${res.status}` }, { status: 500 })
    }

    const candidates = data.candidates || []
    const parts = candidates[0]?.content?.parts || []
    const fnCall = parts.find(p => p.functionCall)?.functionCall
    if (!fnCall || fnCall.name !== 'submit_motion_prompt') {
      return NextResponse.json({
        error: 'Gemini did not call the tool',
        raw: candidates[0]?.content,
      }, { status: 500 })
    }

    const args = fnCall.args || {}
    const { positivePrompt, negativePrompt } = args
    if (!positivePrompt || !negativePrompt) {
      return NextResponse.json({ error: 'Tool input missing required fields', raw: args }, { status: 500 })
    }

    return NextResponse.json({ ok: true, positivePrompt, negativePrompt })
  } catch (err) {
    console.error('[recreate/extract-motion-prompt] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
