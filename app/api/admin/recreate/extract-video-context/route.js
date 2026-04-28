import { NextResponse } from 'next/server'
import { requireAdmin, patchAirtableRecord } from '@/lib/adminAuth'
import Anthropic from '@anthropic-ai/sdk'
import ffmpegStatic from 'ffmpeg-static'
import ffmpeg from 'fluent-ffmpeg'
import { writeFile, unlink, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'

ffmpeg.setFfmpegPath(ffmpegStatic)

const INSPIRATION_TABLE = 'tblnQhATaMtpoYErb'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const GEMINI_MODEL = 'gemini-2.5-flash'
const SONNET_MODEL = 'claude-sonnet-4-6'

// Extract a frame at a specific timestamp via ffmpeg. Returns a buffer.
async function extractFrame(videoPath, timestamp, outPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .inputOptions([`-ss ${timestamp}`])
      .outputOptions(['-frames:v 1', '-q:v 2'])
      .save(outPath)
      .on('end', () => resolve())
      .on('error', err => reject(new Error(`ffmpeg frame extract failed: ${err.message}`)))
  })
}

// Sonnet pass: compare two stills, return cameraMotion enum.
// Triggered AFTER Gemini's video analysis to verify camera-motion detection
// since Gemini's video sampling can miss subtle continuous dolly motion.
async function detectCameraMotionFromStills(firstFrameB64, lastFrameB64, mediaType) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const tool = {
    name: 'submit_camera_motion',
    description: 'Submit the detected camera motion from comparing the first and last frame of a video clip.',
    input_schema: {
      type: 'object',
      properties: {
        cameraMotion: {
          type: 'string',
          enum: ['locked', 'dolly_back', 'dolly_forward', 'pan_left', 'pan_right', 'slider', 'handheld_drift'],
        },
        reasoning: {
          type: 'string',
          description: 'One sentence explaining the comparison: subject scale change, framing shift, etc.',
        },
        subjectScaleChange: {
          type: 'string',
          enum: ['smaller', 'larger', 'same'],
          description: 'Did the subject get smaller (further away), larger (closer), or stay the same size between the two frames?',
        },
      },
      required: ['cameraMotion', 'reasoning', 'subjectScaleChange'],
    },
  }
  const sys = `You are comparing the FIRST frame and LAST frame of a short video clip to determine camera motion. The two images are labeled "FIRST" and "LAST" in the order presented.

Procedure:
1. Look at the subject in both frames. Estimate what % of the frame's height the subject occupies in each.
2. If the subject is clearly SMALLER in the LAST frame than the FIRST → camera dollied AWAY from the subject (dolly_back).
3. If the subject is clearly LARGER in the LAST frame → camera dollied TOWARD the subject (dolly_forward).
4. If subject scale is essentially the same, check horizontal position drift → pan_left / pan_right / slider / handheld_drift / locked.

Even subtle scale differences count. A subject occupying 60% in FIRST and 50% in LAST is dolly_back. Use the submit_camera_motion tool.`

  const res = await anthropic.messages.create({
    model: SONNET_MODEL,
    max_tokens: 500,
    system: sys,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'submit_camera_motion' },
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'FIRST frame:' },
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: firstFrameB64 } },
        { type: 'text', text: 'LAST frame:' },
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: lastFrameB64 } },
        { type: 'text', text: 'Compare the two frames and submit the cameraMotion via the tool.' },
      ],
    }],
  })
  const toolUse = res.content.find(b => b.type === 'tool_use')
  return toolUse?.input || null
}

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
motionPrompt format (one paragraph, copy-paste ready for Kling V3.0 4K):
- Start with camera framing: "Selfie shot of...", "Mirror selfie of...", "Static shot of...", "Tripod static shot of...", "Handheld shot of...", etc.
- Describe the subject as "an american girl" (or other accent if clearly different) — keep generic.
- Describe the literal action / motion beat by beat (walks into frame from left, brushes hair, glances at camera, mouths along to audio, body weight shifts onto right hip, etc.). Keep it leaner when start AND end frame anchors are present (text should describe the TRANSITION, not re-imagine the bookends).
- If she speaks audibly, include the EXACT spoken quote: she said "..."
- The motionPrompt's last segment will be set automatically based on your separate cameraMotion enum (see below). Do NOT include "Static camera, no movement" in the motionPrompt — leave camera direction out, just describe action and audio constraints; the server will append the camera descriptor from your cameraMotion choice.

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

motionNegative format — comma-separated tokens preventing common Kling failure modes plus framing-specific blockers based on the video. Always include: cartoon, anime, illustration, painting, CGI, 3D render, plastic skin, airbrushed, beauty filter, cinematic lighting, studio lighting, blurry, low resolution, jpeg artifacts, watermark, text, logo, deformed face, asymmetric eyes, extra fingers, missing fingers, distorted hands, malformed hands, extra limbs, broken anatomy, mannequin, AI artifacts, uncanny valley, double face, multiple people, child, underage features, nudity, censor bars, scene cut, jump cut, transition, multiple shots. If video is tripod-static, also add: mirror selfie, mirror reflection, phone in hand, holding a smartphone, selfie pose.

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
          { inlineData: { mimeType, data: base64Video } },
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
    let { cameraMotion } = fnCall.args || {}
    if (!videoContext || !motionPrompt || !motionNegative) {
      return NextResponse.json({ error: 'Tool input missing required fields', raw: fnCall.args }, { status: 500 })
    }

    // Sonnet camera-motion verification: extract first + last frame, compare
    // them as stills with explicit subject-scale comparison. Gemini watching
    // the full video samples frames at intervals and misses subtle continuous
    // dolly motion. Two-frame comparison is far more reliable for this.
    let cameraMotionVerification = null
    try {
      const tmp = tmpdir()
      const stamp = Date.now()
      const rand = randomBytes(4).toString('hex')
      const videoPath = join(tmp, `vctx-${stamp}-${rand}.mp4`)
      const firstPath = join(tmp, `first-${stamp}-${rand}.jpg`)
      const lastPath = join(tmp, `last-${stamp}-${rand}.jpg`)
      await writeFile(videoPath, buf)

      // Probe duration via ffmpeg metadata; fallback to sampling at known offsets
      const duration = await new Promise((resolve) => {
        ffmpeg.ffprobe(videoPath, (err, data) => {
          if (err || !data?.format?.duration) return resolve(null)
          resolve(data.format.duration)
        })
      })
      const firstTs = 0.3
      const lastTs = duration ? Math.max(firstTs + 1, duration - 0.5) : 8

      await extractFrame(videoPath, firstTs, firstPath)
      await extractFrame(videoPath, lastTs, lastPath)
      const [firstBuf, lastBuf] = await Promise.all([readFile(firstPath), readFile(lastPath)])

      const verification = await detectCameraMotionFromStills(
        firstBuf.toString('base64'),
        lastBuf.toString('base64'),
        'image/jpeg'
      )
      if (verification?.cameraMotion) {
        cameraMotionVerification = verification
        // Sonnet's two-frame comparison wins over Gemini's video sample
        cameraMotion = verification.cameraMotion
      }

      await Promise.all([
        unlink(videoPath).catch(() => {}),
        unlink(firstPath).catch(() => {}),
        unlink(lastPath).catch(() => {}),
      ])
    } catch (e) {
      console.warn('[extract-video-context] camera motion verification failed:', e.message)
      // Fall back to Gemini's pick if verification fails
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

    // If the subject is silent in the inspo, prepend aggressive "no talking"
    // blockers — Kling otherwise defaults to lip-syncing creators.
    const TALKING_BLOCKERS = 'talking, lip sync, lip syncing, mouth open, mouth opening, singing, vocalizing, speaking, mouth movement, lip movement, screaming, yelling, performing, exaggerated facial expressions'
    const finalNegative = hasSpokenDialogue === false
      ? `${TALKING_BLOCKERS}, ${motionNegative}`
      : motionNegative

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
      cameraMotionVerification,
    })
  } catch (err) {
    console.error('[recreate/extract-video-context] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
