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
// Sonnet on 8 frames is much faster than Gemini on full video. 60s buffer.
export const maxDuration = 120

const SONNET_MODEL = 'claude-sonnet-4-6'
const FRAMES_TO_SAMPLE = 8

const SYSTEM_INSTRUCTION = `You are analyzing a short Instagram reel by examining ${FRAMES_TO_SAMPLE} evenly-spaced frames from it (in chronological order). Produce all fields via the submit_video_context tool.

Outputs:

1. videoContext — 6-10 short bullet lines starting with "- " covering beat-by-beat action and cross-frame details a per-frame analyzer would miss. Cover:
- Beat-by-beat action (frame 1 → frame 8). Brief.
- Cross-frame props/wardrobe/object continuity (e.g. "she removes her white underwear and uses it to tie her hair around frame 5").
- Things that change across the video (clothing changes, hair styling changes, prop introductions, prop removals).
- Setting reveals only visible at certain moments.

Do NOT include physical character traits (hair color, body type, age, ethnicity, makeup) — those come from reference images.

2. motionPrompt — one paragraph, copy-paste ready for Kling V3.0 4K image-to-video. Structure:

[Shot type] of [subject + action], [real lens cue], [named light source], [specific skin/realism vocab], [mood/film vibe].

Camera and style cues belong at the END, not buried mid-prompt. Real lens names ("50mm prime f/1.8", "iPhone 15 Pro 26mm equivalent") outperform abstract terms ("cinematic", "raw photo"). Real light source names ("natural window daylight diffused through sheer curtains", "overhead fluorescent", "dim bedside lamp") outperform "studio lighting" / "soft light".

Specific structure:
- Shot type: "Tripod static shot of...", "Selfie shot of...", "Handheld shot of...". Camera-direction phrase will be auto-inserted by the server based on your cameraMotion enum (DO NOT include any camera direction).
- Subject: "an american girl" (or other accent if obvious) — keep generic, no body/hair/face descriptors.
- Action: literal beat-by-beat (walks into frame from left, brushes hair, glances at camera, weight shifts onto right hip). Keep concise.
- If she speaks audibly: include EXACT spoken quote: she said "...".
- Real lens cue: "50mm prime lens at f/1.8", "iPhone 15 Pro, 26mm equivalent, f/1.78", "vertical 9:16 raw video".
- Named light source: pull from the actual reel.
- Skin/realism vocab: "visible pores, fine peach-fuzz, slight freckles, unretouched skin, subtle skin imperfections" — pick 3-4. Do NOT use "no smoothing" / "no beauty filter" — Kling reads "no X" as content tokens.
- Mood/vibe: "documentary candid lifestyle vibe", "Tuesday afternoon at home". One short phrase.

3. motionNegative — comma-separated tokens. ~18-22 tokens. Pick from:
- Anatomy errors: extra fingers, fused fingers, missing limbs, extra limbs, broken limbs, deformed body, distorted face, asymmetrical eyes, bad anatomy, bad proportions, long neck
- Motion errors: motion freeze, stiff pose, unnatural stillness
- Hard quality fails: low quality, jpeg artifacts, blurry, cloning artifacts, duplicated body parts
- Hard content fails: watermark, text, logo
- Plastic-skin blockers (PICK MAX 3): plastic skin, waxy skin, doll-like, mannequin

EXCLUDE these (waste budget or fight realism): cartoon, anime, illustration, 3D render, CGI, chromatic aberration, lens distortion, soft focus, harsh shadows, flat lighting, overexposed, underexposed, oversaturated, oversharpen, glitch, noisy image, exaggerated curves, fake muscles, beauty filter, glamour skin, magazine skin.

Framing-specific (add only when applicable):
- If NOT a mirror selfie: add "mirror selfie, mirror reflection, phone in hand"
- If subject doesn't speak: add "talking mouth, lip sync"
- If single-clip continuous: add "scene cut, jump cut"

4. hasSpokenDialogue — boolean. true ONLY if mouth movements across frames clearly show speaking/lip-syncing. False if her mouth stays mostly closed or only minor expression changes.

5. cameraMotion — REQUIRED enum. Compare subject scale across frames:
- "locked" — subject occupies same % of frame across all 8 frames
- "dolly_back" — subject is smaller in later frames (camera pulled away)
- "dolly_forward" — subject is larger in later frames (camera pushed in)
- "pan_left" — background scrolls left to right (camera panned right)
- "pan_right" — background scrolls right to left (camera panned left)
- "slider" — smooth lateral motion with parallax depth
- "handheld_drift" — subtle wobble that doesn't feel deliberate

Default to subject-scale comparison first. Even SUBTLE scale change counts as dolly. Only return "locked" if you're confident framing didn't change at all.`

async function fetchVideoBuffer(videoUrl) {
  const res = await fetch(videoUrl, { redirect: 'follow' })
  if (!res.ok) throw new Error(`Video fetch failed: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

async function extractFrame(videoPath, timestamp, outPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .inputOptions([`-ss ${timestamp}`])
      .outputOptions(['-frames:v 1', '-q:v 3', '-vf', 'scale=720:-2'])
      .save(outPath)
      .on('end', () => resolve())
      .on('error', err => reject(new Error(`ffmpeg frame extract failed: ${err.message}`)))
  })
}

// POST — body: { videoUrl, inspoRecordId? }
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  const tmp = tmpdir()
  const stamp = Date.now()
  const rand = randomBytes(4).toString('hex')
  const videoPath = join(tmp, `vctx-${stamp}-${rand}.mp4`)
  const framePaths = []

  try {
    const { videoUrl, inspoRecordId } = await request.json()
    if (!videoUrl) return NextResponse.json({ error: 'Missing videoUrl' }, { status: 400 })

    // Download video, extract frames at fixed offsets (no ffprobe needed —
    // ffmpeg-static doesn't include ffprobe, and adding it requires extra
    // build config). Fixed offsets cover typical 5-15s reels well; ffmpeg
    // gracefully handles requests past video end (returns last frame).
    const buf = await fetchVideoBuffer(videoUrl)
    await writeFile(videoPath, buf)

    // 8 offsets distributed across 0.3s → 14s. Covers reels up to ~15s.
    // Shorter reels get clustered samples toward end (last frame repeats).
    const FIXED_OFFSETS = [0.3, 1.5, 3.0, 4.5, 6.0, 8.0, 11.0, 14.0]
    const frames = []
    for (let i = 0; i < FRAMES_TO_SAMPLE; i++) {
      const ts = FIXED_OFFSETS[i]
      const fp = join(tmp, `frame-${stamp}-${rand}-${i}.jpg`)
      framePaths.push(fp)
      try {
        await extractFrame(videoPath, ts, fp)
        const data = await readFile(fp)
        frames.push({ timestamp: ts, data: data.toString('base64') })
      } catch (e) {
        // If a timestamp is past video end, ffmpeg may fail — skip that frame
        console.warn(`[extract-video-context] frame ${i} at ${ts}s skipped:`, e.message)
      }
    }
    if (frames.length < 3) {
      throw new Error('Failed to extract enough frames from video')
    }

    // Build content array — text labels interleaved with frames
    const content = [
      { type: 'text', text: `Analyzing ${FRAMES_TO_SAMPLE} evenly-spaced frames from a ${duration.toFixed(1)}s reel. Frames are in chronological order:` },
    ]
    for (let i = 0; i < frames.length; i++) {
      content.push({ type: 'text', text: `Frame ${i + 1}/${FRAMES_TO_SAMPLE} (≈${frames[i].timestamp.toFixed(1)}s):` })
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: frames[i].data },
      })
    }
    content.push({ type: 'text', text: 'Now produce all fields via the submit_video_context tool.' })

    // Sonnet structured output via tool use
    const tool = {
      name: 'submit_video_context',
      description: 'Submit cross-frame video context, motion prompt, negative, dialogue flag, camera motion.',
      input_schema: {
        type: 'object',
        properties: {
          videoContext: { type: 'string' },
          motionPrompt: { type: 'string' },
          motionNegative: { type: 'string' },
          hasSpokenDialogue: { type: 'boolean' },
          cameraMotion: {
            type: 'string',
            enum: ['locked', 'dolly_back', 'dolly_forward', 'pan_left', 'pan_right', 'slider', 'handheld_drift'],
          },
        },
        required: ['videoContext', 'motionPrompt', 'motionNegative', 'hasSpokenDialogue', 'cameraMotion'],
      },
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const claudeRes = await anthropic.messages.create({
      model: SONNET_MODEL,
      max_tokens: 2000,
      system: SYSTEM_INSTRUCTION,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'submit_video_context' },
      messages: [{ role: 'user', content }],
    })

    const toolUse = claudeRes.content.find(b => b.type === 'tool_use')
    if (!toolUse?.input) {
      return NextResponse.json({
        error: `Sonnet did not call the tool (stop: ${claudeRes.stop_reason})`,
        raw: claudeRes.content,
      }, { status: 500 })
    }

    const { videoContext, motionPrompt, motionNegative, hasSpokenDialogue, cameraMotion } = toolUse.input

    // Server-side override: force the canonical camera-motion phrase into the
    // motion prompt body based on the structured cameraMotion enum.
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
      finalMotionPrompt = finalMotionPrompt.replace(/,\s*,/g, ',').replace(/\s+/g, ' ').trim()
      if (/no phone visible|no cuts/i.test(finalMotionPrompt)) {
        finalMotionPrompt = finalMotionPrompt.replace(/(no phone visible|no cuts)/i, `${cameraPhrase}, $1`)
      } else {
        finalMotionPrompt = `${finalMotionPrompt} ${cameraPhrase}.`
      }
    }

    // Negative cleanup + auto-blockers
    const TALKING_BLOCKERS = 'talking mouth, lip sync, mouth opening, speaking'
    const SKIN_BLOCKERS = 'plastic skin, waxy skin, beauty filter, airbrushed'
    let finalNegative = motionNegative
    if (!/plastic skin/i.test(finalNegative)) finalNegative = `${SKIN_BLOCKERS}, ${finalNegative}`
    if (hasSpokenDialogue === false && !/talking mouth/i.test(finalNegative)) {
      finalNegative = `${TALKING_BLOCKERS}, ${finalNegative}`
    }
    const seen = new Set()
    finalNegative = finalNegative.split(',').map(s => s.trim()).filter(t => {
      if (!t) return false
      const k = t.toLowerCase()
      if (seen.has(k)) return false
      seen.add(k)
      return true
    }).slice(0, 28).join(', ')

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
    return NextResponse.json({ error: err.message || 'Unknown error' }, { status: 500 })
  } finally {
    // Cleanup temp files
    await unlink(videoPath).catch(() => {})
    await Promise.all(framePaths.map(p => unlink(p).catch(() => {})))
  }
}
