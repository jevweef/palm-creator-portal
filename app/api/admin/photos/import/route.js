import { NextResponse } from 'next/server'
import { requireAdmin, batchCreateRecords, fetchAirtableRecords } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// POST /api/admin/photos/import
// Body: {
//   handle: string,
//   images: [{ code, postUrl, carouselIndex, carouselTotal, fullResUrl, postedAt, caption }, ...]
// }
//
// For each selected image: download full-res from the RapidAPI URL,
// upload to Dropbox at /Palm Ops/Photos/{handle}/{code}_{index}.jpg,
// create a shared link, then batch-create the Airtable Photos record
// with the Dropbox shared link + an Image attachment that Airtable
// downloads itself (so the thumbnail survives even when the RapidAPI
// URL expires). Idempotent on (code, carouselIndex).
export async function POST(request) {
  try {
    await requireAdmin()
    const body = await request.json()
    const handle = String(body.handle || '').replace(/^@/, '').trim()
    const images = Array.isArray(body.images) ? body.images : []
    if (!handle) return NextResponse.json({ error: 'handle required' }, { status: 400 })
    if (images.length === 0) return NextResponse.json({ error: 'no images selected' }, { status: 400 })
    if (images.length > 50) return NextResponse.json({ error: 'max 50 images per import' }, { status: 400 })

    // Dup check against existing Photos rows for this handle.
    const existing = await fetchAirtableRecords('Photos', {
      fields: ['Source Post URL', 'Carousel Index'],
      filterByFormula: `{Source Handle} = "${handle}"`,
    })
    const existingKeys = new Set()
    for (const r of existing) {
      const url = r.fields?.['Source Post URL'] || ''
      const idx = r.fields?.['Carousel Index'] || 1
      const m = url.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/)
      if (m) existingKeys.add(`${m[1]}|${idx}`)
    }

    const tok = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(tok)
    const rawDbx = (u) => u ? String(u).replace('dl=0', 'raw=1').replace('dl=1', 'raw=1') : ''

    // Pull + upload each image. Sequential because Dropbox content
    // endpoint is rate-limited; for 50 images this is ~30-60s total.
    const records = []
    let dupes = 0
    let failed = 0
    for (const img of images) {
      const code = String(img.code || '').trim()
      const idx = Number(img.carouselIndex) || 1
      if (!code) { failed++; continue }
      if (existingKeys.has(`${code}|${idx}`)) { dupes++; continue }
      const srcUrl = img.fullResUrl || img.thumbnail
      if (!srcUrl) { failed++; continue }
      try {
        const ir = await fetch(srcUrl)
        if (!ir.ok) { console.warn(`[photos/import] fetch ${code}_${idx}: ${ir.status}`); failed++; continue }
        const buf = Buffer.from(await ir.arrayBuffer())
        const dbxPath = `/Palm Ops/Photos/${handle}/${code}_${String(idx).padStart(2, '0')}.jpg`
        await uploadToDropbox(tok, ns, dbxPath, buf, { overwrite: true })
        let dbxLink = ''
        try { dbxLink = await createDropboxSharedLink(tok, ns, dbxPath) } catch {}
        const rawLink = rawDbx(dbxLink)
        const fields = {
          Name: `@${handle}/${code}_${String(idx).padStart(2, '0')}`,
          'Source Handle': handle,
          'Source Post URL': img.postUrl || `https://www.instagram.com/p/${code}/`,
          'Carousel Index': idx,
          'Carousel Total': Number(img.carouselTotal) || 1,
          Caption: String(img.caption || '').trim().slice(0, 1000),
          Status: 'Pending',
        }
        if (img.postedAt) fields['Posted At'] = img.postedAt
        if (dbxPath) fields['Dropbox Path'] = dbxPath
        if (dbxLink) fields['Dropbox Link'] = dbxLink
        if (rawLink) fields.Image = [{ url: rawLink, filename: `${code}_${String(idx).padStart(2, '0')}.jpg` }]
        records.push({ fields })
      } catch (e) {
        console.warn(`[photos/import] ${code}_${idx} failed:`, e.message)
        failed++
      }
    }

    let created = []
    if (records.length > 0) {
      created = await batchCreateRecords('Photos', records, { typecast: true })
    }
    return NextResponse.json({
      ok: true,
      created: created.length,
      duplicates: dupes,
      failed,
      ids: created.map(r => r.id),
    })
  } catch (err) {
    if (err instanceof Response) return err
    const msg = typeof err?.message === 'string' && err.message ? err.message : String(err)
    console.error('[photos/import] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
