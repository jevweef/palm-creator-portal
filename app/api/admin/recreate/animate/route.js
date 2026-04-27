import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { submitWaveSpeedTask } from '@/lib/wavespeed'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const KLING_MODEL = 'kwaivgi/kling-v3.0-pro/image-to-video'

// POST — body: {
//   creatorId, shortcode,
//   startUrl,           // start frame swap output (Kling image input)
//   endUrl?,            // end frame swap output (Kling tail_image input) — optional
//   motionPrompt,       // from Step 6 (Gemini)
//   motionNegative?,
//   duration?           // 5 or 10 (Kling V3.0 Pro caps at 10)
// }
// Returns: { ok, taskId, durationRequested }
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorId, shortcode, startUrl, endUrl, motionPrompt, motionNegative, duration } = await request.json()
    if (!creatorId) return NextResponse.json({ error: 'Missing creatorId' }, { status: 400 })
    if (!startUrl) return NextResponse.json({ error: 'Missing startUrl (start frame swap output)' }, { status: 400 })
    if (!motionPrompt) return NextResponse.json({ error: 'Missing motionPrompt (run Step 6 first)' }, { status: 400 })

    // Kling V3.0 Pro on WaveSpeed accepts 5, 10, or 15. Default to 10.
    const dur = [5, 10, 15].includes(Number(duration)) ? Number(duration) : 10
    const body = {
      image: startUrl,
      prompt: motionPrompt,
      negative_prompt: motionNegative || '',
      duration: dur,
      cfg_scale: 0.5,
      // We mux the original inspo audio in animate-status — Kling-generated
      // audio is unreliable for trending music / specific voices.
      sound: false,
    }
    if (endUrl) body.tail_image = endUrl

    const task = await submitWaveSpeedTask(KLING_MODEL, body)
    return NextResponse.json({
      ok: true,
      taskId: task.id,
      durationRequested: dur,
      hasEndFrame: !!endUrl,
    })
  } catch (err) {
    console.error('[recreate/animate] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
