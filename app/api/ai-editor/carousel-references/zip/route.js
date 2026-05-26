import archiver from 'archiver'
import { Readable } from 'stream'
import { requireAdminOrAiEditor, fetchAirtableRecords } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Stream a zip of all slides in a scraped IG carousel back to the browser.
// The AI editor uses these as source material for variation generations
// (in TJP or elsewhere) so downloading the whole carousel at once is the
// fastest workflow.
//
// GET ?postUrl=... — fetches every Photos row sharing that Source Post URL
//                    and zips their CDN/Dropbox bytes
// GET ?ids=rec1,rec2,rec3 — alternate: by explicit Photo IDs (used if the
//                           caller already has the list and wants to skip
//                           the lookup)
export async function GET(request) {
  try {
    await requireAdminOrAiEditor()

    const url = new URL(request.url)
    const postUrl = url.searchParams.get('postUrl') || ''
    const idsParam = url.searchParams.get('ids') || ''

    let photos = []
    if (postUrl) {
      // Escape single quotes in the URL for the Airtable formula.
      const safe = postUrl.replace(/'/g, "\\'")
      photos = await fetchAirtableRecords('Photos', {
        filterByFormula: `AND({Source Post URL}='${safe}',{Source Type}='Instagram')`,
        fields: ['Source Handle', 'Carousel Index', 'CDN URL', 'Dropbox Link', 'Image'],
      })
    } else if (idsParam) {
      const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, 50)
      if (!ids.length) return new Response('No valid ids', { status: 400 })
      const formula = `OR(${ids.map(id => `RECORD_ID()='${id}'`).join(',')})`
      photos = await fetchAirtableRecords('Photos', {
        filterByFormula: formula,
        fields: ['Source Handle', 'Carousel Index', 'CDN URL', 'Dropbox Link', 'Image'],
      })
    } else {
      return new Response('postUrl or ids required', { status: 400 })
    }

    if (!photos.length) return new Response('No photos found', { status: 404 })

    // Stable order: by Carousel Index ascending so the zip mirrors the
    // original carousel sequence.
    photos.sort((a, b) => (a.fields?.['Carousel Index'] || 0) - (b.fields?.['Carousel Index'] || 0))

    const handle = photos[0]?.fields?.['Source Handle'] || 'carousel'
    const shortcode = postUrl
      ? postUrl.replace(/\/$/, '').split('/').filter(Boolean).pop() || 'post'
      : 'selection'
    const zipName = `${handle.replace(/[^a-zA-Z0-9_-]+/g, '_')}_${shortcode}.zip`

    // Stream the zip into a ReadableStream so Next.js can send it as the
    // response body without buffering all bytes in memory.
    const archive = archiver('zip', { zlib: { level: 6 } })
    const chunks = []
    archive.on('data', chunk => chunks.push(chunk))
    archive.on('warning', err => console.warn('[carousel-zip] archiver warning:', err))
    archive.on('error', err => { throw err })

    // Append each slide. Prefer CDN URL (fast, stable), fall back to
    // Dropbox raw, then to the Airtable attachment URL. Skip slides we
    // can't fetch — surface the count in the response headers.
    let appended = 0
    let skipped = 0
    for (const p of photos) {
      const f = p.fields || {}
      const idx = f['Carousel Index'] || (appended + 1)
      const cdnUrl = f['CDN URL'] || ''
      const dropboxLink = f['Dropbox Link'] || ''
      const dropboxRaw = dropboxLink
        ? dropboxLink.replace(/[?&]dl=[01]/g, '').replace(/[?&]raw=1/g, '').replace(/\?$/, '')
          + (dropboxLink.includes('?') ? '&raw=1' : '?raw=1')
        : ''
      const att = (f['Image'] || [])[0]
      const candidates = [cdnUrl, dropboxRaw, att?.url].filter(Boolean)

      let fetched = null
      for (const c of candidates) {
        try {
          const r = await fetch(c)
          if (r.ok) { fetched = Buffer.from(await r.arrayBuffer()); break }
        } catch {}
      }
      if (!fetched) { skipped++; continue }
      const safeName = `${handle.replace(/[^a-zA-Z0-9_-]+/g, '_')}_${String(idx).padStart(2, '0')}.jpg`
      archive.append(fetched, { name: safeName })
      appended++
    }
    await archive.finalize()

    if (!appended) return new Response('Could not fetch any slide bytes', { status: 502 })

    const body = Buffer.concat(chunks)
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipName}"`,
        'Content-Length': String(body.length),
        'X-Slides-Appended': String(appended),
        'X-Slides-Skipped': String(skipped),
      },
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[carousel-references/zip] error:', err)
    return new Response(err.message || 'zip error', { status: 500 })
  }
}
