export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdminOrEditor } from '@/lib/adminAuth'

const CREATOMATE_API = 'https://api.creatomate.com/v1/renders'

export async function POST(req) {
  try { await requireAdminOrEditor() } catch (e) { return e }

  const { clipUrl, caption, yPosition } = await req.json()

  if (!clipUrl || !caption) {
    return NextResponse.json({ error: 'clipUrl and caption are required' }, { status: 400 })
  }

  const apiKey = process.env.CREATOMATE_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'CREATOMATE_API_KEY not configured' }, { status: 500 })

  // y: 0 = top, 100 = bottom. Default 75 (lower third area).
  const y = Math.max(5, Math.min(95, yPosition ?? 75))

  const source = {
    output_format: 'mp4',
    width: 1080,
    height: 1920,
    frame_rate: 30,
    elements: [
      {
        type: 'video',
        track: 1,
        source: clipUrl,
        fit: 'cover',
        volume: '100%',
      },
      {
        type: 'text',
        track: 2,
        text: caption,
        y: `${y}%`,
        width: '84%',       // safe zone: ~8% margin each side
        x_alignment: '50%',
        font_size: '6.5 vw',
        font_weight: '700',
        color: '#ffffff',
        background_color: 'rgba(0,0,0,0.68)',
        x_padding: '4%',
        y_padding: '2.5%',
        x_anchor: '50%',    // center horizontally
      },
    ],
  }

  const res = await fetch(CREATOMATE_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ source }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error('[Render] Creatomate error:', text)
    return NextResponse.json({ error: `Render failed: ${text}` }, { status: 500 })
  }

  const data = await res.json()
  // Creatomate returns an array
  const render = Array.isArray(data) ? data[0] : data
  return NextResponse.json({ renderId: render.id, status: render.status })
}
