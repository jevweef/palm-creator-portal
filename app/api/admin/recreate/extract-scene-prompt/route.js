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
  This is the identity anchor that tells Wan 2.7 to use the reference photos for face/hair/body/skin.
- One paragraph, copy-paste ready.
- Hyper-realistic raw iPhone photo, shot on iPhone camera, ultra detailed, sharp focus, natural skin texture, minimal editing, no cinematic look, 9:16, 4K.

GOAL: describe the inspo so faithfully that everything except the woman's identity is reproduced. Outfit, pose, gaze, expression, hair direction (even mid-motion), framing, lighting, room, and the room's REALISM LEVEL must all match what's actually in the inspo. Don't add details the inspo doesn't show. Don't remove details that are clearly there.

CLOTHING — exact garment type, color, fit, length, how it's worn (buttoned/unbuttoned and how much, sleeves rolled up or down, shirt tucked or untucked, etc.). Brand only if visible on a tag or waistband. NEVER describe printed graphics on the garment.

POSE / MOTION STATE — be precise about whether the subject is in a STATIC pose or captured MID-MOTION:
  * Static example: "standing relaxed, weight on right hip, left hand at side"
  * Mid-motion examples: "captured mid-step, left foot lifted off the floor", "hair caught mid-whip from left to right with motion blur trailing on the tips", "hand frozen mid-wave", "torso twisted from a turning motion"
  * Capture body weight distribution, hip angle, shoulder rotation, head turn angle, hand positions explicitly.

GAZE / FACIAL EXPRESSION — CRITICAL: do NOT default to "looking at camera" / "direct eye contact". Default eye-contact is an AI giveaway when the original wasn't actually looking at the camera.
  * Describe exactly where the eyes are pointing: "looking directly at the camera lens with steady eye contact" (ONLY if she actually is), "looking down at the floor", "looking off-camera to her right toward the window", "looking past the camera at the wall behind it", "eyes closed mid-blink", "looking down at her phone".
  * Describe exact mouth/lip state: "soft closed-mouth smile", "lips slightly parted mid-speech", "neutral lips, no expression", "mouth open in a laugh", "lips pressed together".
  * If you can't tell exactly where she's looking, err on the side of "looking off-camera" — never invent eye contact.

FRAMING / COMPOSITION — exactly as the inspo shows:
  * Camera distance: close-up | medium-shot | medium-full | full-body | wide
  * Subject scale ("middle 60% of frame height", "head at upper third, feet at bottom edge")
  * Subject horizontal position: centered | left-of-center | right-of-center
  * Camera angle: low (waist-height) | eye-level | high | slightly upward tilt | downward tilt
  * What's visible at each frame edge ("bed visible on left edge", "TV on right wall behind subject", "rug filling lower third")

CAMERA SETUP — selfie | mirror selfie | tripod static | handheld | over-the-shoulder | someone else filming.

LIGHTING — natural daylight, soft, even, harsh sunlight, indoor warm, golden hour, ring light visible, etc. — match the inspo.

ROOM REALISM — describe the actual realism level of the inspo. DO NOT default to either "polished/staged" OR "messy/lived-in". Describe what's actually visible:
  * If the room is genuinely tidy → "ordinary tidy bedroom, modern minimal decor, nothing on surfaces"
  * If it's lived-in/messy → call out specific visible mess: "unmade pink gingham sheets, fitted sheet partially exposed, ring light + tripod with phone visible on right, scattered clothing on the bed"
  * If hotel-style → say so
  * Match the inspo. Don't invent mess. Don't remove mess that's there.

VIBE — plain language matching the inspo. "Candid lifestyle", "casual at-home", "lived-in", "hotel-room", "modern apartment", "Tuesday afternoon", "evening warm-light". Avoid "elegant", "luxurious", "magazine", "editorial" unless the inspo really is that.

DO NOT describe the subject's physical features (hair length, hair color, eye color, face shape, body type, skin tone, ethnicity, age, makeup style). Those come from the reference photos via the identity anchor. EXCEPTION: hair POSITION / direction / motion state IS required when present ("hair falling forward over her left shoulder", "hair caught mid-whip toward the right side of frame") — that's pose data, not identity.

negativePrompt rules:
- Comma-separated tokens, copy-paste ready.
- Always include: cartoon, anime, illustration, painting, CGI, 3D render, plastic skin, airbrushed, beauty filter, cinematic lighting, studio lighting, blurry, low resolution, jpeg artifacts, watermark, text, logo, deformed face, asymmetric eyes, extra fingers, missing fingers, distorted hands, malformed hands, extra limbs, broken anatomy, mannequin, AI artifacts, uncanny valley, double face, multiple people, child, underage features, nudity, censor bars.
- IF the inspo room is lived-in / messy / not professionally styled, ADD: magazine photo, magazine-style, staged, professionally styled, interior design photography, hotel suite, real estate listing, perfectly tidy, spotless, showroom, decorator-styled, glossy lifestyle photo, perfectly made bed. Otherwise SKIP these — they would fight the inspo if it's actually a clean modern space.
- IF the subject is NOT looking directly at the camera in the inspo, ADD: looking at camera, direct eye contact, staring at camera, eyes on camera, gaze at lens. (Default AI eye-contact is a major tell.)
- Add framing-specific blockers based on the shot type — e.g. if NOT a mirror selfie, add: mirror selfie, mirror reflection, phone in hand, holding a smartphone, selfie pose. If NOT a back shot, add: rear view, back to camera.
- If subject is holding a specific object (hairbrush, cup), add: multiple {object}s, two {object}s.
- If clothing is specific (e.g. white t-shirt), add competing clothing: black shirt, dress, jacket, coat.`

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

    const { shotType } = toolUse.input
    let { positivePrompt, negativePrompt } = toolUse.input
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
