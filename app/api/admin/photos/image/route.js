import { NextResponse } from 'next/server'
import sharp from 'sharp'
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
    let buf = await downloadFromDropbox(tok, ns, path)

    // Fallback: if Dropbox returns nothing (e.g. flatlay upload failed
    // silently but the path got written anyway, or the file was deleted
    // out from under us), and the caller passed a public ?fallback= URL
    // — fetch that and stream those bytes instead. Lets downloads keep
    // working even when Dropbox-side is broken; the editor gets the
    // CDN copy which is still 2K resolution.
    if (!buf || buf.length === 0) {
      const fallback = u.searchParams.get('fallback')
      if (fallback && /^https?:\/\//i.test(fallback)) {
        try {
          const r = await fetch(fallback)
          if (r.ok) buf = Buffer.from(await r.arrayBuffer())
        } catch (e) { console.warn('[photos/image] fallback fetch failed:', e.message) }
      }
    }
    if (!buf || buf.length === 0) {
      return NextResponse.json({ error: `Dropbox file not found at ${path} (and no working fallback)` }, { status: 404 })
    }

    // Guess MIME from the filename extension. Default jpeg since
    // every Photos record uses .jpg. The browser only needs a
    // reasonable image/* type to render — it doesn't sniff.
    const ext = path.toLowerCase().split('.').pop()
    const mime = ext === 'png' ? 'image/png'
      : ext === 'webp' ? 'image/webp'
      : ext === 'gif' ? 'image/gif'
      : 'image/jpeg'

    // Defensive coercion for legacy flatlays: some early generations
    // were saved as .jpg but contain PNG bytes (Wan/GPT default output
    // format), which macOS Finder flags as a corrupt JPEG. If the
    // filename promises JPEG but the magic bytes say PNG, re-encode
    // before serving so the file extension and content agree.
    if (mime === 'image/jpeg' && buf.length >= 8) {
      const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
      if (isPng) {
        try {
          buf = await sharp(buf).jpeg({ quality: 92, mozjpeg: true }).toBuffer()
        } catch (e) {
          console.warn(`[photos/image] jpeg re-encode for legacy PNG failed:`, e.message)
        }
      }
    }

    // Optional ?download=filename — when set, serve with
    // Content-Disposition: attachment so the browser saves the file
    // instead of rendering it inline. Lets us reuse this proxy for the
    // ⬇ buttons in the Library (sidesteps cross-origin download-attr
    // restrictions on Cloudflare Images URLs).
    const downloadName = u.searchParams.get('download')
    const dispositionHeader = downloadName
      ? { 'Content-Disposition': `attachment; filename="${downloadName.replace(/"/g, '')}"` }
      : {}

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': mime,
        // Long cache: photo bytes never change (Dropbox path is
        // unique per import). Private since the proxy is auth-gated.
        'Cache-Control': 'private, max-age=86400, immutable',
        ...dispositionHeader,
      },
    })
  } catch (err) {
    if (err instanceof Response) return err
    const msg = typeof err?.message === 'string' && err.message ? err.message : String(err)
    console.error('[photos/image] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
