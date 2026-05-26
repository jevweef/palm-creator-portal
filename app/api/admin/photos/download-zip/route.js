import { NextResponse } from 'next/server'
import archiver from 'archiver'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, downloadFromDropbox } from '@/lib/dropbox'
import { quoteAirtableString } from '@/lib/airtableFormula'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/admin/photos/download-zip?postUrl=https://www.instagram.com/p/CODE/
//
// Bundles every Photos row that shares the given Source Post URL into a
// single .zip and streams it back. Pulls bytes from Dropbox (the canonical
// store) — Airtable holds metadata only, so we can't shortcut here.
// Filenames inside the zip follow {handle}_{code}_NN.jpg so unzipping into
// any folder keeps things sortable by carousel index.
export async function GET(request) {
  try {
    await requireAdmin()
    const postUrl = new URL(request.url).searchParams.get('postUrl')
    if (!postUrl) return NextResponse.json({ error: 'postUrl required' }, { status: 400 })

    const rows = await fetchAirtableRecords('Photos', {
      fields: ['Source Handle', 'Source Post URL', 'Carousel Index', 'Dropbox Path', 'Flatlay Dropbox Path', 'Flatlay Model', 'Flatlay Status'],
      filterByFormula: `{Source Post URL} = ${quoteAirtableString(postUrl)}`,
    })
    if (rows.length === 0) return NextResponse.json({ error: 'no photos for that post' }, { status: 404 })

    const photos = rows
      .map(r => ({
        handle: r.fields?.['Source Handle'] || 'unknown',
        idx: r.fields?.['Carousel Index'] || 1,
        path: r.fields?.['Dropbox Path'] || '',
        // Flatlay metadata — pulled into the zip under a flatlays/
        // subfolder when present. Only Done status counts; in-flight
        // or failed runs don't have usable bytes.
        flatlayPath: (r.fields?.['Flatlay Status']?.name || r.fields?.['Flatlay Status']) === 'Done'
          ? (r.fields?.['Flatlay Dropbox Path'] || '')
          : '',
        flatlayModel: r.fields?.['Flatlay Model'] || '',
      }))
      .filter(p => p.path)
      .sort((a, b) => a.idx - b.idx)
    if (photos.length === 0) return NextResponse.json({ error: 'no Dropbox-backed photos' }, { status: 404 })

    const tok = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(tok)

    const code = postUrl.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/)?.[1] || 'post'
    const handle = photos[0]?.handle || 'creator'

    const archive = archiver('zip', { zlib: { level: 6 } })
    const chunks = []
    const done = new Promise((resolve, reject) => {
      archive.on('data', c => chunks.push(c))
      archive.on('end', resolve)
      archive.on('error', reject)
      archive.on('warning', reject)
    })

    // Preserve the actual file extension from the Dropbox path —
    // Pinterest uploads keep .png / .webp if that's what the editor
    // dropped in. Forcing .jpg silently mislabeled files and could
    // confuse downstream tools (TJP, validators, etc.). Defaults to
    // .jpg only when the path itself doesn't tell us.
    const extOf = (path) => {
      const m = String(path || '').toLowerCase().match(/\.([a-z0-9]+)$/)
      const e = m?.[1] || 'jpg'
      // Normalize legacy "jpeg" to "jpg" for consistency.
      return e === 'jpeg' ? 'jpg' : e
    }

    for (const p of photos) {
      const base = `${p.handle}_${code}_${String(p.idx).padStart(2, '0')}`
      // Original
      try {
        const buf = await downloadFromDropbox(tok, ns, p.path)
        if (buf) archive.append(buf, { name: `${base}.${extOf(p.path)}` })
      } catch (e) {
        console.warn(`[photos/download-zip] skip original ${p.path}:`, e.message)
      }
      // Flatlay (under flatlays/ subfolder so unzipping keeps the
      // categories clean — editors can grab just the originals or
      // just the flatlays by walking one folder).
      if (p.flatlayPath) {
        try {
          const fbuf = await downloadFromDropbox(tok, ns, p.flatlayPath)
          if (fbuf) {
            const suffix = p.flatlayModel ? `_${p.flatlayModel}` : ''
            archive.append(fbuf, { name: `flatlays/${base}_flatlay${suffix}.${extOf(p.flatlayPath)}` })
          }
        } catch (e) {
          console.warn(`[photos/download-zip] skip flatlay ${p.flatlayPath}:`, e.message)
        }
      }
    }
    archive.finalize()
    await done

    const zipBuf = Buffer.concat(chunks)
    return new NextResponse(zipBuf, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${handle}_${code}.zip"`,
        'Content-Length': String(zipBuf.length),
      },
    })
  } catch (err) {
    if (err instanceof Response) return err
    const msg = typeof err?.message === 'string' && err.message ? err.message : String(err)
    console.error('[photos/download-zip] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
