import { NextResponse } from 'next/server'
import { requireAdmin, patchAirtableRecord } from '@/lib/adminAuth'
import Anthropic from '@anthropic-ai/sdk'

const INSPIRATION_TABLE = 'tblnQhATaMtpoYErb'

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
- MUST start with this exact phrase: "Exact same woman as in the reference images,"
  This is the identity anchor that tells Wan 2.7 to use the reference photos for face/hair/body/skin. Without it the model defaults to a generic woman.
- One paragraph, copy-paste ready
- Hyper-realistic raw iPhone photo, shot on iPhone camera, ultra detailed, professional, sharp focus, natural skin texture, minimal editing, no cinematic look, 9:16, 4K
- Describe clothing precisely (garment type, color, fit, brand if visible on tag/waistband only, NOT printed graphics)
- Describe action / pose / hand position / what subject is holding
- Describe whether it's selfie / mirror selfie / tripod static / handheld / over-the-shoulder
- Describe setting in detail (location, surfaces, furniture, decor visible)
- Describe lighting (natural daylight, soft, even, harsh sunlight, indoor warm, etc.)
- Describe vibe (candid, social-media lifestyle, casual at-home, etc.)
- DO NOT describe the subject's physical features (hair, face, body, skin, age, ethnicity, makeup) — those come from the reference photos via the anchor phrase

negativePrompt rules:
- Comma-separated tokens, copy-paste ready
- Always include: cartoon, anime, illustration, painting, CGI, 3D render, plastic skin, airbrushed, beauty filter, cinematic lighting, studio lighting, blurry, low resolution, jpeg artifacts, watermark, text, logo, deformed face, asymmetric eyes, extra fingers, missing fingers, distorted hands, malformed hands, extra limbs, broken anatomy, mannequin, AI artifacts, uncanny valley, double face, multiple people, child, underage features, nudity, censor bars
- Add framing-specific blockers based on the shot type — e.g. if NOT a mirror selfie, add: mirror selfie, mirror reflection, phone in hand, holding a smartphone, selfie pose. If NOT a back shot, add: rear view, back to camera. Etc.
- If subject is holding a specific object (hairbrush, cup), add: multiple {object}s, two {object}s
- If clothing is specific (e.g. white t-shirt), add competing clothing: black shirt, dress, jacket, coat`

export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { frameUrl, frameDataUrl, inspoRecordId } = await request.json()
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

    // Use tool use for guaranteed structured output. Anthropic forces the
    // model to call this tool with input matching the schema — no JSON
    // parsing of free-form text required.
    const extractTool = {
      name: 'submit_scene_prompt',
      description: 'Submit the extracted scene prompt details for this frame.',
      input_schema: {
        type: 'object',
        properties: {
          shotType: {
            type: 'string',
            enum: ['close-up', 'front', 'back'],
            description: 'close-up = face fills >40% of frame or only head/shoulders/upper chest visible. front = three-quarter or full body view from the front. back = subject\'s back is to the camera.',
          },
          positivePrompt: {
            type: 'string',
            description: 'One-paragraph hyper-realistic image-edit prompt describing scene/clothing/action/framing/lighting/vibe ONLY. Never describe physical character traits (hair, face, body, skin, age, ethnicity, makeup).',
          },
          negativePrompt: {
            type: 'string',
            description: 'Comma-separated negative prompt tokens with framing-specific blockers based on shot type and scene.',
          },
        },
        required: ['shotType', 'positivePrompt', 'negativePrompt'],
      },
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const claudeResponse = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      tools: [extractTool],
      tool_choice: { type: 'tool', name: 'submit_scene_prompt' },
      messages: [
        {
          role: 'user',
          content: [
            imageBlock,
            { type: 'text', text: 'Extract the scene prompt for this frame using the submit_scene_prompt tool.' },
          ],
        },
      ],
    })

    const toolUse = claudeResponse.content.find(b => b.type === 'tool_use')
    if (!toolUse?.input) {
      return NextResponse.json({
        error: `Claude did not call the tool (stop: ${claudeResponse.stop_reason})`,
        raw: claudeResponse.content,
      }, { status: 500 })
    }

    const { shotType, negativePrompt } = toolUse.input
    let { positivePrompt } = toolUse.input
    if (!shotType || !positivePrompt || !negativePrompt) {
      return NextResponse.json({ error: 'Tool input missing required fields', raw: toolUse.input }, { status: 500 })
    }

    // Enforce the "Exact same woman..." identity anchor prefix. Without
    // this phrase, Wan 2.7 ignores the reference photos for face/hair/body
    // and produces a generic woman in the scene.
    const ANCHOR = 'Exact same woman as in the reference images,'
    if (!positivePrompt.toLowerCase().startsWith(ANCHOR.toLowerCase())) {
      // Drop any leading "A young woman..." style intro that Sonnet may have
      // led with, then prepend the anchor.
      const trimmed = positivePrompt.replace(/^(?:a |the )?(young\s+)?woman[^,.]*[,.]\s*/i, '').trim()
      positivePrompt = `${ANCHOR} ${trimmed.charAt(0).toLowerCase() + trimmed.slice(1)}`
    }

    // Persist to Airtable so refreshes don't trigger another paid call.
    if (inspoRecordId) {
      try {
        await patchAirtableRecord(INSPIRATION_TABLE, inspoRecordId, {
          'Recreate Scene Prompt': positivePrompt,
          'Recreate Scene Negative': negativePrompt,
          'Recreate Shot Type': shotType,
        })
      } catch (e) {
        console.warn('[extract-scene-prompt] Airtable cache write failed:', e.message)
      }
    }

    return NextResponse.json({
      ok: true,
      shotType,
      positivePrompt,
      negativePrompt,
      tokensIn: claudeResponse.usage?.input_tokens,
      tokensOut: claudeResponse.usage?.output_tokens,
    })
  } catch (err) {
    console.error('[recreate/extract-scene-prompt] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
