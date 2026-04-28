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
- End with this exact tail structure: "[real lens cue], [named light source], [specific skin vocab], [vibe], 9:16."
  Examples:
  • "iPhone 15 Pro 26mm equivalent at f/1.78, natural window daylight diffused through sheer curtains, visible pores, fine peach-fuzz, slight freckles, unretouched skin, documentary candid lifestyle vibe, 9:16."
  • "50mm prime lens at f/1.8, warm bedside lamp on her right plus cool window backlight, visible pores, slight skin imperfections, off-the-cuff Tuesday afternoon vibe, 9:16."
  Real lens names ("50mm prime f/1.8", "iPhone 15 Pro 26mm equivalent") outperform generic "raw iPhone photo". Named light sources ("natural window daylight diffused through sheer curtains", "overhead fluorescent", "dim bedside lamp") outperform "studio lighting" / "soft light". Specific skin vocab (pores, peach-fuzz, freckles, unretouched) outperforms generic "natural skin texture".

GOAL: describe the inspo so faithfully that everything except the woman's identity is reproduced. Outfit, pose, gaze, expression, hair direction (even mid-motion), framing, lighting, room, and the room's REALISM LEVEL must all match what's actually in the inspo. Don't add details the inspo doesn't show. Don't remove details that are clearly there.

CLOTHING — exact garment type, color, fit, length, how it's worn (buttoned/unbuttoned and how much, sleeves rolled up or down, shirt tucked or untucked, etc.). Brand only if visible on a tag or waistband. NEVER describe printed graphics on the garment.

POSE / MOTION STATE — be precise about whether the subject is in a STATIC pose or captured MID-MOTION:
  * Static example: "standing relaxed, weight on right hip, left hand at side"
  * Mid-motion examples: "captured mid-step, left foot lifted off the floor", "hair caught mid-whip from left to right with motion blur trailing on the tips", "hand frozen mid-wave", "torso twisted from a turning motion"
  * Capture body weight distribution, hip angle, shoulder rotation, head turn angle, hand positions explicitly.
  * MOTION DIRECTION matters — explicitly state which way she's spinning, walking, turning, or whipping her hair. "Spinning counter-clockwise (her right shoulder rotating forward toward camera)", "walking toward camera, left foot forward and right foot still planted behind", "whipping head from right to left so hair trails toward the right side of frame". Wrong-direction body language reads instantly as fake.
  * FOOT PLACEMENT must match the motion: e.g. if mid-spin counter-clockwise, the back foot pivots on the ball, the front foot leads. Describe stance explicitly.

GAZE / FACIAL EXPRESSION — CRITICAL: do NOT default to "looking at camera" / "direct eye contact". Default eye-contact is an AI giveaway when the original wasn't actually looking at the camera.
  * Describe exactly where the eyes are pointing: "looking directly at the camera lens with steady eye contact" (ONLY if she actually is), "looking down at the floor", "looking off-camera to her right toward the window", "looking past the camera at the wall behind it", "eyes closed mid-blink", "looking down at her phone".
  * Describe exact mouth/lip state: "soft closed-mouth smile", "lips slightly parted mid-speech", "neutral lips, no expression", "mouth open in a laugh", "lips pressed together".
  * If you can't tell exactly where she's looking, err on the side of "looking off-camera" — never invent eye contact.

FRAMING / COMPOSITION — exactly as the inspo shows:
  * Camera distance: close-up | medium-shot | medium-full | full-body | wide. Be SPECIFIC about distance — "subject ~3 meters from camera, occupying middle 50% of frame height" beats "full-body".
  * Subject scale ("head at upper third, feet at bottom edge"; or "head at vertical center, feet not visible") — match actual scale, don't make her larger than she is.
  * Subject horizontal position: centered | left-of-center | right-of-center
  * Camera angle: low (waist-height) | eye-level | high | slightly upward tilt | downward tilt
  * CAMERA TILT (Dutch angle): if the inspo's horizon is not perfectly level — e.g. ceiling line tilts down to one side, floor tilts up — call out the tilt explicitly: "camera tilted ~5° clockwise (right edge sits lower than left edge)" or "slight Dutch angle, ceiling slopes downward to the right". Phone-on-tripod content often has this. Wan defaults to perfectly level, so silence here = perfectly level result.
  * What's visible at each frame edge ("bed visible on left edge", "TV on right wall behind subject", "rug filling lower third")

CAMERA SETUP — selfie | mirror selfie | tripod | handheld | over-the-shoulder | someone else filming. CRITICAL: do NOT make MOTION claims about the camera ("static", "no movement", "fully still", "tripod static throughout"). You are looking at ONE frame — you can't see whether the camera moves across the timeline. Camera motion belongs to the Gemini video pass (cameraMotion enum), not this per-frame analysis. Just describe the SETUP (tripod, handheld, selfie) without claiming whether it's static or moving.

LIGHTING — natural daylight, soft, even, harsh sunlight, indoor warm, golden hour, ring light visible, etc. — match the inspo.

ROOM REALISM — describe the actual realism level of the inspo. DO NOT default to either "polished/staged" OR "messy/lived-in". Describe what's actually visible:
  * If the room is genuinely tidy → "ordinary tidy bedroom, modern minimal decor, nothing on surfaces"
  * If it's lived-in/messy → call out specific visible mess: "unmade pink gingham sheets, fitted sheet partially exposed, ring light + tripod with phone visible on right, scattered clothing on the bed"
  * If hotel-style → say so
  * Match the inspo. Don't invent mess. Don't remove mess that's there.

VIBE — plain language matching the inspo. "Candid lifestyle", "casual at-home", "lived-in", "hotel-room", "modern apartment", "Tuesday afternoon", "evening warm-light". Avoid "elegant", "luxurious", "magazine", "editorial" unless the inspo really is that.

BANNED ADJECTIVES — Wan 2.7 reads these as "make it look like a magazine" no matter what's in the negatives. NEVER use any of these words anywhere in the positive prompt: "modern", "minimal", "minimally decorated", "minimalist", "clean", "tidy", "sleek", "pristine", "polished", "stylish", "chic", "elegant", "refined", "curated", "well-appointed", "luxurious", "sophisticated", "aesthetic", "designed", "decorator". Describe the room by what's actually in it (specific furniture, specific objects, specific surfaces) — not by how nice it looks. "White desk with a Bluetooth speaker on it, wall-mounted TV, bed with pink gingham sheets" beats "modern, clean, minimally decorated bedroom".

REALISM TAIL — see the positivePrompt rules above for the canonical tail structure (lens + light + skin vocab + vibe). Critical: do NOT include "no X" phrases in the positive prompt ("no smoothing", "no retouching", "no beauty filter", "no cinematic look", "minimal editing"). Models read "no X" as content tokens and end up evoking X. Use only POSITIVE descriptions ("visible pores", "unretouched skin", "documentary candid") — never negation.

DO NOT describe the subject's physical features (hair length, hair color, eye color, face shape, body type, skin tone, ethnicity, age, makeup style). Those come from the reference photos via the identity anchor. EXCEPTION: hair POSITION / direction / motion state IS required when present ("hair falling forward over her left shoulder", "hair caught mid-whip toward the right side of frame") — that's pose data, not identity.

negativePrompt rules:
- Comma-separated tokens, copy-paste ready.
- Always include: cartoon, anime, illustration, painting, CGI, 3D render, plastic skin, airbrushed, beauty filter, smooth skin, poreless skin, retouched skin, glamour photo, glamour lighting, beauty campaign, fashion photography, cinematic lighting, studio lighting, ring light glow on face, blurry, low resolution, jpeg artifacts, watermark, text, logo, deformed face, asymmetric eyes, extra fingers, missing fingers, distorted hands, malformed hands, extra limbs, broken anatomy, mannequin, AI artifacts, uncanny valley, double face, multiple people, child, underage features, nudity, censor bars, magazine photo, magazine-style, editorial photo, glossy lifestyle photo, perfectly made bed, showroom, decorator-styled, real estate listing, interior design photography, hotel suite, perfectly tidy, spotless, staged, professionally styled, sanitized scene.
- IF the subject is NOT looking directly at the camera in the inspo, ADD: looking at camera, direct eye contact, staring at camera, eyes on camera, gaze at lens. (Default AI eye-contact is a major tell.)
- Add framing-specific blockers based on the shot type — e.g. if NOT a mirror selfie, add: mirror selfie, mirror reflection, phone in hand, holding a smartphone, selfie pose. If NOT a back shot, add: rear view, back to camera.
- If subject is holding a specific object (hairbrush, cup), add: multiple {object}s, two {object}s.
- If clothing is specific (e.g. white t-shirt), add competing clothing: black shirt, dress, jacket, coat.

reelSpecificNotes rules — ALWAYS POPULATE THIS FIELD. IMPORTANT: do NOT include camera-motion claims ("static", "no movement", "fully still", "tripod static throughout") — you are looking at one frame, you cannot see whether the camera moves across the timeline. Camera motion is determined by the Gemini video pass and added to the motion prompt separately. Your notes should describe what's visible in THIS frame only (pose, hair state, wardrobe, gear placement, lighting characteristics, framing).

- A SHORT bullet list (4-8 lines starting with "- ") of frame-specific quirks an AI image generator is likely to miss or get wrong about THIS particular reel.
- These are constants of the reel: camera tilt, lighting characteristics, gear placement, pose specifics, hair direction, foot placement, wardrobe specifics.
- Examples:
    - "- Camera tilted ~5° clockwise — right edge of ceiling line sits lower than left."
    - "- Lighting split: cool window light from left, warm lamp light from right — visible color cast across her body."
    - "- iPhone+ring light tripod free-standing on FLOOR at right edge — TV is WALL-MOUNTED, NOT on desk."
    - "- Hair caught mid-whip right to left, individual strands separating with motion blur on tips."
    - "- Shirt fully buttoned, worn as a dress, hem mid-thigh — bare legs only."
    - "- Weight on right foot, left foot pivoting on toe mid-spin."
- If the admin already supplied notes via the user message, ECHO them back verbatim in this field — don't re-derive.
- Otherwise, generate them yourself from the frame.
- These notes drive the positive prompt content; both should agree.`

export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { frameUrl, frameDataUrl, inspoRecordId, userNotes, slot, videoContext } = await request.json()
    if (!frameUrl && !frameDataUrl) {
      return NextResponse.json({ error: 'Missing frameUrl or frameDataUrl' }, { status: 400 })
    }
    const slotKey = slot === 'end' ? 'end' : 'start'

    // Build image content block. We ALWAYS pass base64 to Anthropic — passing
    // frameUrl directly fails for Dropbox-hosted frames because Anthropic's
    // URL fetcher respects robots.txt and Dropbox disallows bots.
    let imageBlock
    if (frameDataUrl) {
      const match = frameDataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/)
      if (!match) return NextResponse.json({ error: 'Invalid frameDataUrl' }, { status: 400 })
      imageBlock = {
        type: 'image',
        source: { type: 'base64', media_type: match[1], data: match[2] },
      }
    } else {
      const fetchRes = await fetch(frameUrl)
      if (!fetchRes.ok) {
        return NextResponse.json({ error: `Frame fetch failed (${fetchRes.status})` }, { status: 400 })
      }
      const arrayBuf = await fetchRes.arrayBuffer()
      const base64 = Buffer.from(arrayBuf).toString('base64')
      const ct = fetchRes.headers.get('content-type') || ''
      const m = ct.match(/^(image\/[a-z]+)/i)
      const mediaType = m ? m[1].toLowerCase().replace('image/jpg', 'image/jpeg') : 'image/jpeg'
      imageBlock = {
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: base64 },
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
          reelSpecificNotes: {
            type: 'string',
            description: 'Bullet list (4-8 short lines starting with "- ") of frame-specific quirks an AI image gen is likely to miss: camera tilt, lighting split, gear placement, hair direction, foot placement, wardrobe specifics. Echo admin-supplied notes verbatim if provided.',
          },
        },
        required: ['shotType', 'positivePrompt', 'negativePrompt', 'reelSpecificNotes'],
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
            {
              type: 'text',
              text: [
                'Extract the scene prompt for this frame using the submit_scene_prompt tool.',
                videoContext?.trim()
                  ? `\n\nVIDEO CONTEXT (from a separate Gemini pass that watched the FULL reel — use to disambiguate things you can't tell from this single still, e.g. props, hair ties made from non-obvious objects, action timing). DO NOT add details from the context that aren't visible in THIS frame:\n${videoContext.trim()}`
                  : '',
                userNotes?.trim()
                  ? `\n\nADDITIONAL NOTES FROM THE ADMIN (specific to THIS reel — incorporate these into your prompt, don't paraphrase, follow them literally):\n${userNotes.trim()}`
                  : '',
              ].filter(Boolean).join(''),
            },
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

    const { shotType, reelSpecificNotes } = toolUse.input
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

    // The notes that "won": user-supplied if provided, otherwise Sonnet's draft.
    const finalNotes = userNotes?.trim() || (reelSpecificNotes || '')

    // Persist to Airtable so refreshes don't trigger another paid call.
    if (inspoRecordId) {
      try {
        const promptField = slotKey === 'end' ? 'Recreate End Scene Prompt' : 'Recreate Scene Prompt'
        const negativeField = slotKey === 'end' ? 'Recreate End Scene Negative' : 'Recreate Scene Negative'
        const shotField = slotKey === 'end' ? 'Recreate End Shot Type' : 'Recreate Shot Type'
        const notesField = slotKey === 'end' ? 'Recreate End Notes' : 'Recreate Notes'
        const patch = {
          [promptField]: positivePrompt,
          [negativeField]: negativePrompt,
          [shotField]: shotType,
          [notesField]: finalNotes,
        }
        await patchAirtableRecord(INSPIRATION_TABLE, inspoRecordId, patch)
      } catch (e) {
        console.warn('[extract-scene-prompt] Airtable cache write failed:', e.message)
      }
    }

    return NextResponse.json({
      ok: true,
      slot: slotKey,
      shotType,
      positivePrompt,
      negativePrompt,
      reelSpecificNotes: finalNotes,
      tokensIn: claudeResponse.usage?.input_tokens,
      tokensOut: claudeResponse.usage?.output_tokens,
    })
  } catch (err) {
    console.error('[recreate/extract-scene-prompt] error:', err?.stack || err?.message || err)
    // Defensive: ensure we ALWAYS return a JSON body. err.message can be
    // null/undefined for some thrown values (e.g. Anthropic SDK errors
    // without a message) and would silently produce an empty response.
    const message = err?.message || err?.toString?.() || 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
