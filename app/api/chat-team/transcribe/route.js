import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { resolveChatTeamScope } from '@/lib/chatTeamScope'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST — voice-note transcription for the flag-feedback mic. Takes a short
// audio blob (MediaRecorder webm/mp4) as FormData 'audio', returns { text }.
// Whisper handles both container formats, so no client-side conversion.
export async function POST(request) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const scope = await resolveChatTeamScope(request)
  if (!scope.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const form = await request.formData()
    const audio = form.get('audio')
    if (!audio || typeof audio.arrayBuffer !== 'function') {
      return NextResponse.json({ error: 'audio file required' }, { status: 400 })
    }
    if (audio.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'recording too long — keep it under a few minutes' }, { status: 400 })
    }
    const ext = /mp4|m4a|aac/.test(audio.type || '') ? 'mp4' : 'webm'
    const out = new FormData()
    out.append('file', new Blob([await audio.arrayBuffer()], { type: audio.type || 'audio/webm' }), `note.${ext}`)
    out.append('model', 'whisper-1')
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: out,
    })
    const body = await res.text()
    let j; try { j = JSON.parse(body) } catch { j = null }
    if (!res.ok) return NextResponse.json({ error: j?.error?.message || `transcription failed (${res.status})` }, { status: 502 })
    return NextResponse.json({ text: (j?.text || '').trim() })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
