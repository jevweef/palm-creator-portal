import { NextResponse } from 'next/server'
import { requireAdminOrAiEditor } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, createDropboxSharedLink } from '@/lib/dropbox'

// Step 2 of the free-form video upload: after the browser has direct-
// uploaded the bytes to Dropbox using the token from
// /api/admin/ai-editor/free-video-token, this route mints a public
// shared link so the editor can share/preview the file. Returns the
// share link + the raw streamable URL.
export async function POST(request) {
  try {
    await requireAdminOrAiEditor()
    const { dropboxPath } = await request.json()
    if (!dropboxPath || typeof dropboxPath !== 'string') {
      return NextResponse.json({ error: 'dropboxPath required' }, { status: 400 })
    }

    const tok = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(tok)
    let sharedLink = ''
    try { sharedLink = await createDropboxSharedLink(tok, ns, dropboxPath) }
    catch (e) { console.warn('[free-video-finalize] shared link failed:', e.message) }

    if (!sharedLink) {
      return NextResponse.json({ error: 'Uploaded to Dropbox but could not mint shared link' }, { status: 502 })
    }

    // Convert to raw streamable URL so the client can preview inline.
    const cleaned = sharedLink.replace(/[?&]dl=[01]/g, '').replace(/[?&]raw=1/g, '').replace(/\?$/, '')
    const rawUrl = cleaned + (cleaned.includes('?') ? '&raw=1' : '?raw=1')

    return NextResponse.json({
      ok: true,
      dropboxPath,
      sharedLink,
      rawUrl,
    })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
