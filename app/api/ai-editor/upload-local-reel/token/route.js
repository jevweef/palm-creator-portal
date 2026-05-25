import { NextResponse } from 'next/server'
import { requireAdminOrAiEditor } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId } from '@/lib/dropbox'

// Step 1 of the editor's local-reel upload flow. Mints a short-lived
// Dropbox access token + a target path so the browser uploads the (often
// large) video bytes DIRECTLY to Dropbox — bypassing Vercel's ~4.5MB
// serverless request limit.
//
// Same pattern as /api/ai-editor/upload-token, but for a fresh "local
// inspo" reel that isn't tied to an existing Recreate Reel record yet.
// The finalize route creates the record after the upload succeeds.
//
// Path: /Palm Ops/Recreate Staging/_editor-uploads/{YYYY-MM-DD}/
//       {shortid}_{sanitized-filename}
//
// Returns: { accessToken, rootNamespaceId, path, shortid }
export async function POST(request) {
  try {
    await requireAdminOrAiEditor()
    const { filename } = await request.json().catch(() => ({}))
    const safeName = String(filename || 'reel.mp4')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(-80) || 'reel.mp4'

    const accessToken = await getDropboxAccessToken()
    const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)

    const date = new Date().toISOString().slice(0, 10)
    const shortid = Math.random().toString(36).slice(2, 10)
    const path = `/Palm Ops/Recreate Staging/_editor-uploads/${date}/${shortid}_${safeName}`

    return NextResponse.json({ accessToken, rootNamespaceId, path, shortid })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
