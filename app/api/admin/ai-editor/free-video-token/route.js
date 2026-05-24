import { NextResponse } from 'next/server'
import { requireAdminOrAiEditor } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId } from '@/lib/dropbox'

// Mint a short-lived Dropbox upload token for a free-form video upload
// (not tied to a Stage B scene). Client uses the token to upload the
// video bytes DIRECTLY to Dropbox, bypassing Vercel's 4.5MB body limit
// — same pattern as /api/ai-editor/upload-token but without the
// reelRecordId/slug constraint.
//
// Path layout: /Palm Ops/AI Editor Uploads/{YYYY-MM-DD}/{shortid}_{name}
//
// Returns: { accessToken, rootNamespaceId, path }
export async function POST(request) {
  try {
    await requireAdminOrAiEditor()
    const { filename } = await request.json().catch(() => ({}))
    const safeName = String(filename || 'video.mp4')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(-80) || 'video.mp4'

    const accessToken = await getDropboxAccessToken()
    const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)

    const date = new Date().toISOString().slice(0, 10)
    const shortid = Math.random().toString(36).slice(2, 10)
    const path = `/Palm Ops/AI Editor Uploads/${date}/${shortid}_${safeName}`

    return NextResponse.json({ accessToken, rootNamespaceId, path })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
