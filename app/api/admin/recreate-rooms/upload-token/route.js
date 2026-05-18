import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId } from '@/lib/dropbox'

// Mints a short-lived Dropbox token + target path so the browser uploads
// the FULL-RES base room image straight to Dropbox — no downscale, no
// serverless body limit. Mirrors /api/ai-editor/upload-token.
export async function POST(request) {
  try {
    await requireAdmin()
    const { roomName } = await request.json()
    const safe = String(roomName || 'room').replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'room'
    const accessToken = await getDropboxAccessToken()
    const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)
    const path = `/Palm Ops/Recreate Rooms/${safe}/_base/${safe}-${Date.now()}.jpg`
    return NextResponse.json({ accessToken, rootNamespaceId, path })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
