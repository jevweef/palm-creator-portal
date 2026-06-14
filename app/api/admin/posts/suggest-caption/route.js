import { NextResponse } from 'next/server'
import { requireAdminOrEditor } from '@/lib/adminAuth'
import { generateCaptions } from '@/lib/captionEngine'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST — body: { videoUrl, onScreenText?, creatorNotes? }
// Per-card "Suggest caption" button in Post Prep. Feeds the full reel to Gemini
// and returns 3 IG-safe caption options for the human to pick/edit. Does NOT
// write anything — the UI's "Use this" copies the chosen one into Caption.
export async function POST(request) {
  try { await requireAdminOrEditor() } catch (res) { return res }
  try {
    const { videoUrl, onScreenText = '', creatorNotes = '' } = await request.json()
    if (!videoUrl) return NextResponse.json({ error: 'videoUrl required' }, { status: 400 })
    const result = await generateCaptions({ videoUrl, onScreenText, creatorNotes })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[suggest-caption] error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
