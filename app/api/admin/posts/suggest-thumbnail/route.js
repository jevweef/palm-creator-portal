import { NextResponse } from 'next/server'
import { requireAdminOrEditor } from '@/lib/adminAuth'
import { suggestThumbnail } from '@/lib/captionEngine'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST — body: { videoUrl }
// Penny watches the reel and returns the best IG-safe thumbnail timestamp (or
// flags the whole reel too risqué → leave blank). The client then grabs that
// frame via the existing /thumbnail/frame + /thumbnail upload path.
export async function POST(request) {
  try { await requireAdminOrEditor() } catch (res) { return res }
  try {
    const { videoUrl } = await request.json()
    if (!videoUrl) return NextResponse.json({ error: 'videoUrl required' }, { status: 400 })
    const result = await suggestThumbnail({ videoUrl })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[suggest-thumbnail] error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
