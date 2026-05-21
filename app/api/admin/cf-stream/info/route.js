export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const TOKEN = process.env.CLOUDFLARE_IMAGES_TOKEN

// Lightweight CF Stream metadata fetch — duration + readyToStream — keyed by
// UID. Used by the thumbnail picker to size the scrubber slider so the
// picker doesn't have to load any video bytes from Dropbox just to learn how
// long the clip is.
export async function GET(request) {
  try {
    const { userId } = auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const user = await currentUser()
    const role = user?.publicMetadata?.role
    if (!['admin', 'super_admin', 'editor', 'ai_editor'].includes(role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { searchParams } = new URL(request.url)
  const uid = searchParams.get('uid')
  if (!uid) {
    return NextResponse.json({ error: 'uid required' }, { status: 400 })
  }
  if (!ACCOUNT_ID || !TOKEN) {
    return NextResponse.json({ error: 'Cloudflare Stream not configured' }, { status: 500 })
  }

  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/stream/${uid}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      // CF returns the same metadata until the video is re-uploaded — safe to
      // cache aggressively at the edge.
      next: { revalidate: 300 },
    })
    const j = await res.json()
    if (!res.ok || !j.success) {
      return NextResponse.json({ error: j.errors?.[0]?.message || `CF ${res.status}` }, { status: 502 })
    }
    return NextResponse.json({
      uid,
      duration: j.result?.duration ?? null,
      readyToStream: j.result?.readyToStream ?? false,
      thumbnail: j.result?.thumbnail || null,
    }, {
      headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' },
    })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
