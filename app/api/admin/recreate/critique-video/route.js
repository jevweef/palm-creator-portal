import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import Anthropic from '@anthropic-ai/sdk'
import ffmpegStatic from 'ffmpeg-static'
import ffmpeg from 'fluent-ffmpeg'
import { writeFile, unlink, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'

ffmpeg.setFfmpegPath(ffmpegStatic)

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const SONNET_MODEL = 'claude-sonnet-4-6'
const FRAMES_TO_SAMPLE = 8
// Same fixed offsets as extract-video-context — covers reels up to ~15s
const FIXED_OFFSETS = [0.3, 1.5, 3.0, 4.5, 6.0, 8.0, 11.0, 14.0]

const SYSTEM_INSTRUCTION = `You are reviewing a Kling V3.0 Pro image-to-video output for an OnlyFans creator reel recreation pipeline. You're examining ${FRAMES_TO_SAMPLE} evenly-spaced frames from the generated video. Your job is to identify what's wrong with the video so the operator can iterate on prompts/settings.

Focus on these failure modes (call out which frame numbers show each issue):
- IDENTITY DRIFT — does her face stay accurate frame to frame, and does it match the start identity?
- POSE BREAKS — extra limbs, hands phasing through body, body parts swapping, head detaching, hair clipping through skin/clothes.
- TRANSITION SMOOTHNESS — does the motion between frames look natural, or does it teleport / robot / jitter?
- MOTION FIDELITY — does the action match a real reel would show, or is it stiff / unnatural / repetitive?
- CAMERA BEHAVIOR — does it match a tripod-static reel, or does it add zoom/pan that wasn't asked for?
- LIGHTING / SCENE STABILITY — does the background morph or stay locked? Lighting shift across frames?
- HAIR PHYSICS — natural mid-motion behavior or AI-tell wig-flutter?
- LIP SYNC — if she's speaking, does the mouth match? (You can't hear audio but can flag obvious mouth issues.)
- AI ARTIFACTS — uncanny smoothing, plastic skin, glow halo, magazine-glossiness.

Output via the submit_critique tool with these sections:
- overall: one sentence summary — would this pass for a real reel?
- topIssues: array of 1-4 strings, each one specific issue with frame numbers and what to fix
- whatWorked: array of 1-3 strings — things that landed well
- recommendedFix: one concrete next-step suggestion`

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

// POST — body: { videoUrl }
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  const tmp = tmpdir()
  const stamp = Date.now()
  const rand = randomBytes(4).toString('hex')
  const videoPath = join(tmp, `crit-${stamp}-${rand}.mp4`)
  const framePaths = []

  try {
    const { videoUrl } = await request.json()
    if (!videoUrl) return NextResponse.json({ error: 'Missing videoUrl' }, { status: 400 })

    const buf = await fetchVideoBuffer(videoUrl)
    await writeFile(videoPath, buf)

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
        console.warn(`[critique-video] frame ${i} at ${ts}s skipped:`, e.message)
      }
    }
    if (frames.length < 3) {
      throw new Error('Failed to extract enough frames from video')
    }

    const content = [
      { type: 'text', text: `Reviewing ${frames.length} frames from the generated Kling output (chronological):` },
    ]
    for (let i = 0; i < frames.length; i++) {
      content.push({ type: 'text', text: `Frame ${i + 1}/${frames.length} (≈${frames[i].timestamp.toFixed(1)}s):` })
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: frames[i].data },
      })
    }
    content.push({ type: 'text', text: 'Submit your critique via the submit_critique tool.' })

    const tool = {
      name: 'submit_critique',
      description: 'Structured critique of the Kling animation output.',
      input_schema: {
        type: 'object',
        properties: {
          overall: { type: 'string' },
          topIssues: { type: 'array', items: { type: 'string' } },
          whatWorked: { type: 'array', items: { type: 'string' } },
          recommendedFix: { type: 'string' },
        },
        required: ['overall', 'topIssues', 'whatWorked', 'recommendedFix'],
      },
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const claudeRes = await anthropic.messages.create({
      model: SONNET_MODEL,
      max_tokens: 1500,
      system: SYSTEM_INSTRUCTION,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'submit_critique' },
      messages: [{ role: 'user', content }],
    })

    const toolUse = claudeRes.content.find(b => b.type === 'tool_use')
    if (!toolUse?.input) {
      return NextResponse.json({
        error: `Sonnet did not call the tool (stop: ${claudeRes.stop_reason})`,
        raw: claudeRes.content,
      }, { status: 500 })
    }

    return NextResponse.json({ ok: true, critique: toolUse.input })
  } catch (err) {
    console.error('[recreate/critique-video] error:', err)
    return NextResponse.json({ error: err.message || 'Unknown error' }, { status: 500 })
  } finally {
    await unlink(videoPath).catch(() => {})
    await Promise.all(framePaths.map(p => unlink(p).catch(() => {})))
  }
}
