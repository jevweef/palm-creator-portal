import { NextResponse } from 'next/server'
import { requireAdminOrAiEditor } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId } from '@/lib/dropbox'

// Mints a short-lived Dropbox token + target path so the browser
// uploads a Stage B input (pose screenshot / extra identity ref)
// straight to Dropbox. Mirrors recreate-rooms/upload-token.
export async function POST(request) {
  try {
    await requireAdminOrAiEditor()
    const { kind } = await request.json()
    const k = String(kind || 'input').replace(/[^a-zA-Z0-9-_]/g, '') || 'input'
    const accessToken = await getDropboxAccessToken()
    const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)
    const path = `/Palm Ops/Recreate Rooms/_stageB_inputs/${k}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`
    return NextResponse.json({ accessToken, rootNamespaceId, path })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
