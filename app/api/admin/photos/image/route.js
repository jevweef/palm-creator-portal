import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, downloadFromDropbox } from '@/lib/dropbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// GET /api/admin/photos/image?path=/Palm%20Ops/Photos/handle/code_01.jpg
//
// Server-side image proxy. Dropbox shared links return Content-Type
// "application/json" instead of "image/jpeg" — browsers refuse to
// render them in <img>. Airtable signed URLs work but expire after
// a few hours. This route pulls the raw bytes from Dropbox via the
// proper API and serves them with the correct image MIME, so <img>
// tags Just Work and the response is cacheable.
//
// Auth gated to admin. Path comes from the client — anyone who can
// authenticate can request any file under /Palm Ops/, which is the
// same surface as the rest of the admin Dropbox helpers.
export async function GET(request) {
  try {
    await requireAdmin()
    const u = new URL(request.url)
    const path = u.searchParams.get('path') || ''
    if (!path || !path.startsWith('/Palm Ops/')) {
      return NextResponse.json({ error: 'Valid Dropbox path required (must start with /Palm Ops/)' }, { status: 400 })
    }

    const tok = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(tok)
    const buf = await downloadFromDropbox(tok, ns, path)

    // Guess MIME from the filename extension. Default jpeg since
    // every Photos record uses .jpg. The browser only needs a
    // reasonable image/* type to render — it doesn't sniff.
    const ext = path.toLowerCase().split('.').pop()
    const mime = ext === 'png' ? 'image/png'
      : ext === 'webp' ? 'image/webp'
      : ext === 'gif' ? 'image/gif'
      : 'image/jpeg'

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': mime,
        // Long cache: photo bytes never change (Dropbox path is
        // unique per import). Private since the proxy is auth-gated.
        'Cache-Control': 'private, max-age=86400, immutable',
      },
    })
  } catch (err) {
    if (err instanceof Response) return err
    const msg = typeof err?.message === 'string' && err.message ? err.message : String(err)
    console.error('[photos/image] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
