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
export const maxDuration = 120

const SONNET_MODEL = 'claude-sonnet-4-6'
const FRAMES_TO_SAMPLE = 8

// TEXT-to-video dissection. Unlike the recreate motion prompt (which assumes a
// start IMAGE carries the scene and only describes action), a T2V prompt must
// PAINT THE WHOLE VIDEO IN WORDS — the model sees nothing but this text plus
// the creator's identity reference photos.
const SYSTEM_INSTRUCTION = `You are analyzing ${FRAMES_TO_SAMPLE} evenly-spaced chronological frames from a short Instagram reel. Write ONE text-to-video generation prompt that would recreate this video from scratch — the video model will see ONLY your prompt (plus separate identity reference photos of the subject), so the prompt must carry the entire scene.

Output via the submit_t2v_prompt tool.

t2vPrompt — one flowing paragraph (150-250 words), copy-paste ready, covering IN THIS ORDER:
1. Shot framing: "Vertical 9:16 selfie video of...", "Vertical mirror selfie of...", "Handheld vertical video of...", "Static tripod vertical video of..." — whatever the reel actually is.
2. Subject: "a young woman" — NO physical identity traits (no hair color/length, eye color, face, body type, ethnicity, age). Identity comes from reference photos. Wardrobe IS yours to describe precisely: exact garments, colors, fit, state (e.g. "an oversized cream knit sweater slipping off one shoulder and black bike shorts").
3. Setting, fully painted: room type, furniture, wall/floor details, visible props, depth, what's in the background — specific and literal, from the frames.
4. Lighting, named: "soft afternoon window light from the left", "warm bedside lamp glow", "bright bathroom vanity light" — real sources, not "cinematic lighting".
5. Action beats in order (frame 1 → 8): what she does, concisely, present tense. If she visibly speaks or lip-syncs, say so; if there's an obvious audio vibe (dancing to a beat, talking to camera), include it.
6. Camera behavior: static / subtle handheld sway / slow push-in — from comparing subject scale across frames.
7. Close with realism vocabulary: "shot on a phone, true-to-life skin texture with visible pores, unretouched, casual amateur framing" — 3-4 picks, natural phrasing.

Rules:
- Literal and specific beats stylish and vague. Name real objects, real colors, real light.
- NO identity traits, NO "cinematic"/"masterpiece"/"8k" filler, NO camera jargon beyond plain words.
- If the reel has on-screen text overlays, IGNORE them (the generated video should not have text).

Also output:
notes — 1-3 short lines on anything a human should tweak (e.g. "wardrobe is distinctive — swap if it doesn't fit the creator's brand").`

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
  const videoPath = join(tmp, `t2v-${stamp}-${rand}.mp4`)
  const framePaths = []

  try {
    const { videoUrl, inspoRecordId } = await request.json()
    if (!videoUrl) return NextResponse.json({ error: 'Missing videoUrl' }, { status: 400 })

    const buf = await fetchVideoBuffer(videoUrl)
    await writeFile(videoPath, buf)

    const FIXED_OFFSETS = [0.3, 1.5, 3.0, 4.5, 6.0, 8.0, 11.0, 14.0]
    const frames = []
    for (let i = 0; i < FRAMES_TO_SAMPLE; i++) {
      const ts = FIXED_OFFSETS[i]
      const fp = join(tmp, `t2vframe-${stamp}-${rand}-${i}.jpg`)
      framePaths.push(fp)
      try {
        await extractFrame(videoPath, ts, fp)
        const data = await readFile(fp)
        frames.push({ timestamp: ts, data: data.toString('base64') })
      } catch (e) {
        console.warn(`[extract-t2v-prompt] frame ${i} at ${ts}s skipped:`, e.message)
      }
    }
    if (frames.length < 3) throw new Error('Failed to extract enough frames from video')

    const content = [
      { type: 'text', text: `Analyzing ${frames.length} frames from an Instagram reel, in chronological order:` },
    ]
    for (let i = 0; i < frames.length; i++) {
      content.push({ type: 'text', text: `Frame ${i + 1}/${frames.length} (≈${frames[i].timestamp.toFixed(1)}s):` })
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: frames[i].data } })
    }
    content.push({ type: 'text', text: 'Now produce the fields via the submit_t2v_prompt tool.' })

    const tool = {
      name: 'submit_t2v_prompt',
      description: 'Submit the text-to-video prompt and notes.',
      input_schema: {
        type: 'object',
        properties: {
          t2vPrompt: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['t2vPrompt'],
      },
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const claudeRes = await anthropic.messages.create({
      model: SONNET_MODEL,
      max_tokens: 1500,
      system: SYSTEM_INSTRUCTION,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'submit_t2v_prompt' },
      messages: [{ role: 'user', content }],
    })

    const toolUse = claudeRes.content.find(b => b.type === 'tool_use')
    if (!toolUse?.input?.t2vPrompt) {
      return NextResponse.json({ error: `Sonnet did not produce a prompt (stop: ${claudeRes.stop_reason})` }, { status: 500 })
    }
    const { t2vPrompt, notes } = toolUse.input

    // Cache on the reel so the next use is instant.
    if (inspoRecordId) {
      await patchAirtableRecord(INSPIRATION_TABLE, inspoRecordId, { 'T2V Prompt': t2vPrompt }).catch((e) =>
        console.warn('[extract-t2v-prompt] cache write failed:', e.message))
    }

    return NextResponse.json({ ok: true, t2vPrompt, notes: notes || '' })
  } catch (err) {
    console.error('[extract-t2v-prompt] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  } finally {
    await unlink(videoPath).catch(() => {})
    for (const fp of framePaths) await unlink(fp).catch(() => {})
  }
}
