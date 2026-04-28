import { NextResponse } from 'next/server'
import { requireAdmin, patchAirtableRecord } from '@/lib/adminAuth'

const INSPIRATION_TABLE = 'tblnQhATaMtpoYErb'

export const dynamic = 'force-dynamic'
// Gemini 3.1 Pro analyzing a video can run 60-180s. Bumped from 60s to
// 300s (Vercel Pro plan max) to avoid FUNCTION_INVOCATION_TIMEOUT.
export const maxDuration = 300

const GEMINI_MODEL = 'gemini-3.1-pro-preview'
// Gemini default is 1 FPS — too coarse to detect subtle dolly motion.
// 4 FPS was working but doubled latency on longer reels. 2 FPS is the
// middle ground: still catches gradual scale changes across 20-30 frames
// while keeping latency manageable.
const VIDEO_FPS = 2

const SYSTEM_INSTRUCTION = `You watch a short Instagram reel and produce TWO outputs in a single tool call:

1. videoContext — a compact bullet-list summary that will be injected into a separate per-frame analysis pass (Claude Sonnet). Sonnet sees ONE still image at a time and can't tell what's happening across the timeline. Give it the cross-frame context it can't derive from a single frame.

2. motionPrompt + motionNegative — a Kling V3.0 4K image-to-video prompt that will be used to animate a still image into a video matching this reel's motion.

—————————————————————————
videoContext format:

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

Example videoContext output:
- 0:00–0:01: subject walks into frame from the right, full body framing.
- 0:01–0:03: stops in front of a desk, hair flips back as she turns.
- 0:03–0:04: removes white cotton underwear from under her oversized blue shirt.
- 0:04–0:06: uses the underwear as a hair tie, ties hair into a low ponytail.
- 0:06–end: turns toward camera, glances back over shoulder. Camera stays static on tripod.
- Wardrobe is constant: oversized light blue button-up shirt, fully buttoned, worn as dress.
- iPhone + ring light tripod stays in same position bottom-right entire time.

—————————————————————————
motionPrompt format — CRITICAL STRUCTURE for Kling realism. Multiple Kling-specific prompt guides converge on this exact structure:

[Shot type] of [subject + action], [real lens cue], [named light source], [specific skin/realism vocab], [mood/film vibe].

Camera and style cues belong at the END, not buried mid-prompt. Real lens names ("50mm prime f/1.8", "iPhone 15 Pro 26mm equivalent") outperform abstract terms ("cinematic", "raw photo"). Real light source names ("natural window daylight diffused through sheer curtains", "overhead fluorescent", "dim bedside lamp") outperform "studio lighting" / "soft light".

Specific structure:
1. Shot type: "Tripod static shot of...", "Selfie shot of...", "Handheld shot of...". Camera-direction/motion phrase will be auto-inserted by the server based on your cameraMotion enum (DO NOT include any camera direction in the prompt body).
2. Subject: "an american girl" (or other accent if obvious) — keep generic, no body/hair/face descriptors (those come from reference images).
3. Action: literal beat-by-beat (walks into frame from left, brushes hair, glances at camera, weight shifts onto right hip). Keep concise.
4. If she speaks audibly: include EXACT spoken quote: she said "...".
5. Real lens cue: ONE of "50mm prime lens at f/1.8", "Shot on Canon 5D Mark IV, 50mm f/1.4", "iPhone 15 Pro, 26mm equivalent, f/1.78", "vertical 9:16 raw video". Pick based on whether the inspo looks pro-camera or phone-shot.
6. Named light source: pull from the actual inspo (e.g. "natural window daylight diffused through sheer curtains", "warm bedside lamp on her right", "afternoon golden hour light through blinds", "overhead fluorescent kitchen light"). Avoid "studio lighting", "cinematic lighting", "soft lighting".
7. Skin/realism vocab: "visible pores, fine peach-fuzz, slight freckles, unretouched skin, subtle skin imperfections" — pick 3-4 of these. Do NOT use "no smoothing", "no beauty filter", "no retouching" in the positive — Kling reads "no X" as content tokens, not negation.
8. Mood/vibe: "documentary candid lifestyle vibe", "Tuesday afternoon at home", "off-the-cuff moment". One short phrase.

Camera direction line: do NOT include — server appends from cameraMotion enum.

cameraMotion field — REQUIRED, single enum value. CRITICAL: do not default to "locked" just because you see a tripod. Tripod-mounted cameras can dolly, pan, slide. Use this exact procedure:

STEP 1 — Watch the FIRST 0.5 seconds and the LAST 0.5 seconds of the video.
STEP 2 — Compare the SUBJECT SCALE (how much of the frame the subject occupies):
    - Subject occupies the SAME % of frame at start and end → likely "locked"
    - Subject is SMALLER at the end (further away) → "dolly_back" (camera pulled away from subject)
    - Subject is LARGER at the end (closer) → "dolly_forward" (camera pushed in toward subject)
STEP 3 — If subject scale is identical, check horizontal background drift:
    - Background scrolls right-to-left across timeline → "pan_right" (camera panned right, world moved left)
    - Background scrolls left-to-right → "pan_left"
    - Smooth lateral motion with parallax depth → "slider"
STEP 4 — If none of the above clearly apply but the framing has subtle wobble → "handheld_drift"
STEP 5 — Only return "locked" if you are confident the framing did not change at all.

Subject scale is the most reliable signal. Even subtle pull-backs (subject 60% of frame at start → 50% at end) count as "dolly_back" — write it down. Tripod-on-wheels content is common in OF reels; assume motion is possible until you've checked subject scale specifically.
- Add constraints when relevant: "no phone visible" if it's a tripod shot, "no cuts" for single-clip, etc.
- Add voice direction at the end: "american accent" (or other)
- No cinematic language. No fantasy words. No camera-direction jargon. No body-shape descriptors.

motionNegative format — comma-separated tokens. Goal is HIGH-SIGNAL tokens only. Each token competes for model attention; junk tokens dilute. Output ~18-22 tokens total.

INCLUDE these (real failure modes the model actively avoids when prompted):
- Anatomy errors: extra fingers, fused fingers, missing limbs, extra limbs, broken limbs, deformed body, distorted face, asymmetrical eyes, bad anatomy, bad proportions, long neck
- Motion errors: motion freeze, stiff pose, unnatural stillness
- Hard quality fails: low quality, jpeg artifacts, blurry, cloning artifacts, duplicated body parts
- Hard content fails: watermark, text, logo
- Plastic-skin blockers (PICK MAX 3 — more dilutes): plastic skin, waxy skin, doll-like, mannequin

EXCLUDE these (waste budget or fight realism):
- Don't include: cartoon, anime, illustration, painting, 3D render, CGI render — won't happen with our pipeline
- Don't include: chromatic aberration, lens distortion, soft focus — real iPhone footage has these, fighting them suppresses authentic camera look
- Don't include: harsh shadows, flat lighting, bad lighting, overexposed, underexposed, oversaturated, oversharpen, overprocessed — too vague, suppress dramatic lighting we may want
- Don't include: floating objects, depth errors, incorrect perspective, background blur errors, glitch, artifacts, noisy image — too vague
- Don't include: beauty filter, glamour skin, soft-focus skin, magazine skin, retouched skin — pick ONE plastic-skin term, multiple variations dilute
- Don't include: exaggerated curves, fake muscles, unrealistic flexibility — anatomy errors above already cover

FRAMING-SPECIFIC (add only when applicable, 3-5 tokens):
- If NOT a mirror selfie: add "mirror selfie, mirror reflection, phone in hand"
- If subject doesn't speak: add "talking mouth, lip sync"
- If single-clip continuous: add "scene cut, jump cut"

hasSpokenDialogue — boolean. true ONLY if the subject is clearly speaking, mouthing words, or lip-syncing audibly in the video. false if the audio is just music with no spoken vocals from the subject (her mouth is closed or making non-speech expressions). This drives whether we add aggressive "no talking" negatives downstream — Kling defaults to making subjects talk, so silent reels need explicit blockers.`

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
          {
            inlineData: { mimeType, data: base64Video },
            videoMetadata: { fps: VIDEO_FPS },
          },
          { text: 'Analyze this reel and produce the cross-frame video context summary. Use the submit_video_context tool.' },
        ],
      }],
      tools: [{
        functionDeclarations: [{
          name: 'submit_video_context',
          description: 'Submit BOTH the cross-frame video context summary AND the Kling V3.0 motion prompt for this reel in a single call.',
          parameters: {
            type: 'object',
            properties: {
              videoContext: {
                type: 'string',
                description: '6-10 bullet lines starting with "- " covering beat-by-beat action and cross-frame details a per-frame analyzer would miss.',
              },
              motionPrompt: {
                type: 'string',
                description: 'One-paragraph Kling V3.0 motion prompt describing the action / motion / camera behavior. Generic subject ("an american girl"), exact spoken quote if any, motion descriptors at the end.',
              },
              motionNegative: {
                type: 'string',
                description: 'Comma-separated negative prompt tokens for Kling V3.0 with framing-specific blockers based on the video.',
              },
              hasSpokenDialogue: {
                type: 'boolean',
                description: 'True if subject is speaking/mouthing words audibly. False if audio is just music with no vocals from the subject. Drives auto-blockers for talking when false.',
              },
              cameraMotion: {
                type: 'string',
                enum: ['locked', 'dolly_back', 'dolly_forward', 'pan_left', 'pan_right', 'slider', 'handheld_drift'],
                description: 'REQUIRED. Determined by comparing subject scale at start vs end of video. Do NOT default to locked — tripods can dolly. See system prompt for the step-by-step procedure.',
              },
            },
            required: ['videoContext', 'motionPrompt', 'motionNegative', 'hasSpokenDialogue', 'cameraMotion'],
          },
        }],
      }],
      toolConfig: {
        functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['submit_video_context'] },
      },
    }

    // Retry on transient 429/503 (Gemini "high demand" / quota spikes).
    // Exponential backoff with jitter; 3 attempts total.
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
      const delay = (2 ** attempt) * 1000 + Math.random() * 500
      await new Promise(r => setTimeout(r, delay))
    }
    if (!res.ok) {
      console.error('[extract-video-context] Gemini error:', data)
      const msg = data?.error?.message || `Gemini ${res.status}`
      const friendly = /UNAVAILABLE|overload|high demand/i.test(msg)
        ? `Gemini overloaded after ${MAX_ATTEMPTS} retries — try the Run now button again in a minute.`
        : msg
      return NextResponse.json({ error: friendly }, { status: 500 })
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

    const { videoContext, motionPrompt, motionNegative, hasSpokenDialogue } = fnCall.args || {}
    const { cameraMotion } = fnCall.args || {}
    if (!videoContext || !motionPrompt || !motionNegative) {
      return NextResponse.json({ error: 'Tool input missing required fields', raw: fnCall.args }, { status: 500 })
    }


    // Force the camera-motion phrase in the motion prompt to match Gemini's
    // structured cameraMotion enum. Without this, Gemini sometimes commits to
    // "dolly_back" in the enum but still writes "Static camera" in the prompt
    // body — Kling reads the prompt text, not our structured field.
    const CAMERA_PHRASES = {
      locked: 'Static camera, no movement',
      dolly_back: 'Camera slowly dollies backward, smooth pull-back motion',
      dolly_forward: 'Camera slowly dollies forward, smooth push-in motion',
      pan_left: 'Slow pan left, smooth horizontal camera move',
      pan_right: 'Slow pan right, smooth horizontal camera move',
      slider: 'Smooth slider move with gentle parallax',
      handheld_drift: 'Subtle hand-held drift, natural micro-movements',
    }
    const cameraPhrase = CAMERA_PHRASES[cameraMotion] || ''
    let finalMotionPrompt = motionPrompt
    if (cameraPhrase) {
      // Strip any existing camera-motion phrase Gemini may have included
      // (case-insensitive, common variants), then append the canonical one.
      const stripPatterns = [
        /static camera,\s*no movement/gi,
        /static shot/gi,
        /tripod static shot/gi,
        /camera (slowly )?dollies (backward|forward|in|out|back)/gi,
        /slow pan (left|right)/gi,
        /smooth slider move[^.]*/gi,
        /(subtle )?hand-?held (drift|movement)[^,.]*/gi,
        /camera fixed on tripod[^,.]*/gi,
      ]
      for (const re of stripPatterns) finalMotionPrompt = finalMotionPrompt.replace(re, '')
      // Clean up doubled commas/spaces from the strips
      finalMotionPrompt = finalMotionPrompt.replace(/,\s*,/g, ',').replace(/\s+/g, ' ').trim()
      // Insert the canonical camera phrase before "no phone visible" / "no cuts"
      // / final segments if present, otherwise append to the end.
      if (/no phone visible|no cuts/i.test(finalMotionPrompt)) {
        finalMotionPrompt = finalMotionPrompt.replace(
          /(no phone visible|no cuts)/i,
          `${cameraPhrase}, $1`
        )
      } else {
        finalMotionPrompt = `${finalMotionPrompt} ${cameraPhrase}.`
      }
    }

    // Per Kling-specific prompt guides: do NOT inject "no smoothing/no
    // beauty filter" into the positive (Kling reads "no X" as content
    // tokens). Skin realism comes from positive vocabulary (pores, peach-
    // fuzz, freckles) which Gemini handles in its prompt structure, plus
    // a short, focused negative.
    //
    // Keep the negative under ~10 tokens. Long lists flatten output and
    // increase plasticity per multiple Kling guides. Server adds only the
    // most-impactful blockers.
    const TALKING_BLOCKERS = 'talking mouth, lip sync, mouth opening, speaking'
    const SKIN_BLOCKERS = 'plastic skin, waxy skin, beauty filter, airbrushed'
    let finalNegative = motionNegative
    // Prepend skin blockers if not already present
    if (!/plastic skin/i.test(finalNegative)) {
      finalNegative = `${SKIN_BLOCKERS}, ${finalNegative}`
    }
    // Prepend talking blockers when subject is silent
    if (hasSpokenDialogue === false && !/talking mouth/i.test(finalNegative)) {
      finalNegative = `${TALKING_BLOCKERS}, ${finalNegative}`
    }
    // Final cleanup: dedupe tokens, cap to ~28 unique tokens.
    // Targets ~18-22 from Gemini + 4-6 framing-specific + skin/talking
    // blockers from server. Beyond ~28 we're back into the dilution zone.
    const seen = new Set()
    const trimmed = finalNegative.split(',').map(s => s.trim()).filter(t => {
      if (!t) return false
      const key = t.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, 28)
    finalNegative = trimmed.join(', ')

    if (inspoRecordId) {
      try {
        await patchAirtableRecord(INSPIRATION_TABLE, inspoRecordId, {
          'Recreate Video Context': videoContext,
          'Recreate Motion Prompt': finalMotionPrompt,
          'Recreate Motion Negative': finalNegative,
        })
      } catch (e) {
        console.warn('[extract-video-context] Airtable cache write failed:', e.message)
      }
    }

    return NextResponse.json({
      ok: true,
      videoContext,
      motionPrompt: finalMotionPrompt,
      motionNegative: finalNegative,
      hasSpokenDialogue: hasSpokenDialogue ?? null,
      cameraMotion: cameraMotion || null,
    })
  } catch (err) {
    console.error('[recreate/extract-video-context] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
