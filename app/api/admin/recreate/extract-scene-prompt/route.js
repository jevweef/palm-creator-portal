import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MODEL = 'claude-sonnet-4-6'

const SYSTEM_PROMPT = `You analyze a single frame from an Instagram reel and extract a hyper-realistic image-edit prompt that will be used to recreate the scene with a DIFFERENT model whose identity is provided separately via reference photos.

Critical rule: DO NOT describe physical character traits (hair length, hair color, eye color, face shape, body type, skin tone, ethnicity, age, makeup style). Those come from the reference photos. Describe only the SCENE: setting, clothing, action, pose, framing, lighting, environment, and visual style.

Output ONLY a JSON object with this exact shape — no prose, no code fences:

{
  "shotType": "close-up" | "front" | "back",
  "positivePrompt": "...",
  "negativePrompt": "..."
}

shotType rules (for picking the right reference photo set):
- "close-up" — face fills more than ~40% of frame, or only head/shoulders/upper chest visible
- "front" — three-quarter or full body view from the front
- "back" — subject's back is to the camera

positivePrompt rules:
- One paragraph, copy-paste ready
- Hyper-realistic raw iPhone photo, shot on iPhone camera, ultra detailed, professional, sharp focus, natural skin texture, minimal editing, no cinematic look, 9:16, 4K
- Describe clothing precisely (garment type, color, fit, brand if visible on tag/waistband only, NOT printed graphics)
- Describe action / pose / hand position / what subject is holding
- Describe whether it's selfie / mirror selfie / tripod static / handheld / over-the-shoulder
- Describe setting in detail (location, surfaces, furniture, decor visible)
- Describe lighting (natural daylight, soft, even, harsh sunlight, indoor warm, etc.)
- Describe vibe (candid, social-media lifestyle, casual at-home, etc.)
- DO NOT describe the subject's physical features

negativePrompt rules:
- Comma-separated tokens, copy-paste ready
- Always include: cartoon, anime, illustration, painting, CGI, 3D render, plastic skin, airbrushed, beauty filter, cinematic lighting, studio lighting, blurry, low resolution, jpeg artifacts, watermark, text, logo, deformed face, asymmetric eyes, extra fingers, missing fingers, distorted hands, malformed hands, extra limbs, broken anatomy, mannequin, AI artifacts, uncanny valley, double face, multiple people, child, underage features, nudity, censor bars
- Add framing-specific blockers based on the shot type — e.g. if NOT a mirror selfie, add: mirror selfie, mirror reflection, phone in hand, holding a smartphone, selfie pose. If NOT a back shot, add: rear view, back to camera. Etc.
- If subject is holding a specific object (hairbrush, cup), add: multiple {object}s, two {object}s
- If clothing is specific (e.g. white t-shirt), add competing clothing: black shirt, dress, jacket, coat`

export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { frameUrl, frameDataUrl } = await request.json()
    if (!frameUrl && !frameDataUrl) {
      return NextResponse.json({ error: 'Missing frameUrl or frameDataUrl' }, { status: 400 })
    }

    // Build image content block — either from a URL or a data URL
    let imageBlock
    if (frameDataUrl) {
      // data:image/jpeg;base64,XXXX
      const match = frameDataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/)
      if (!match) return NextResponse.json({ error: 'Invalid frameDataUrl' }, { status: 400 })
      imageBlock = {
        type: 'image',
        source: { type: 'base64', media_type: match[1], data: match[2] },
      }
    } else {
      imageBlock = {
        type: 'image',
        source: { type: 'url', url: frameUrl },
      }
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const claudeResponse = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [
        {
          role: 'user',
          content: [
            imageBlock,
            { type: 'text', text: 'Extract the scene prompt for this frame. Respond with the JSON object only.' },
          ],
        },
        // Prefill the assistant's reply with the opening brace — forces Claude
        // to continue with valid JSON and skip any "Here is..." prose.
        { role: 'assistant', content: '{' },
      ],
    })

    const textBlock = claudeResponse.content.find(b => b.type === 'text')
    if (!textBlock?.text) {
      return NextResponse.json({ error: `Claude returned no text (stop: ${claudeResponse.stop_reason})` }, { status: 500 })
    }

    // Reattach the prefill brace and isolate JSON between first { and last }
    let raw = '{' + textBlock.text
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    const firstBrace = raw.indexOf('{')
    const lastBrace = raw.lastIndexOf('}')
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      raw = raw.slice(firstBrace, lastBrace + 1)
    }

    let parsed
    try { parsed = JSON.parse(raw) }
    catch (e) {
      console.error('[extract-scene-prompt] JSON parse failed. Raw:', raw)
      return NextResponse.json({ error: 'Claude returned invalid JSON', raw: raw.slice(0, 800) }, { status: 500 })
    }

    if (!parsed.positivePrompt || !parsed.negativePrompt || !parsed.shotType) {
      return NextResponse.json({ error: 'Claude response missing required fields', raw: parsed }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      shotType: parsed.shotType,
      positivePrompt: parsed.positivePrompt,
      negativePrompt: parsed.negativePrompt,
      tokensIn: claudeResponse.usage?.input_tokens,
      tokensOut: claudeResponse.usage?.output_tokens,
    })
  } catch (err) {
    console.error('[recreate/extract-scene-prompt] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
