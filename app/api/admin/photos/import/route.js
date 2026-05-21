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

    // Parallelize image downloads + Dropbox uploads at a concurrency
    // ceiling that keeps us under Vercel's 120s function timeout while
    // staying inside Dropbox's per-second rate limits. Sequential at
    // 50 images = ~150s (timeouts). Concurrency 6 brings the same 50
    // down to ~25-40s.
    let dupes = 0
    const failures = [] // detailed per-image: { code, carouselIndex, reason }
    const CONCURRENCY = 6
    const processOne = async (img) => {
      const code = String(img.code || '').trim()
      const idx = Number(img.carouselIndex) || 1
      if (!code) { failures.push({ code: '?', carouselIndex: idx, reason: 'missing code' }); return null }
      if (existingKeys.has(`${code}|${idx}`)) { dupes++; return null }
      const srcUrl = img.fullResUrl || img.thumbnail
      if (!srcUrl) { failures.push({ code, carouselIndex: idx, reason: 'no source URL in cache' }); return null }
      try {
        const ir = await fetch(srcUrl)
        if (!ir.ok) {
          // Instagram CDN URLs expire after ~24-48h. 410 / 403 here
          // usually means the cached URL is stale — the editor needs
          // to Refresh the scrape to get fresh URLs.
          const expired = ir.status === 410 || ir.status === 403 || ir.status === 404
          failures.push({ code, carouselIndex: idx, reason: expired ? `URL expired (HTTP ${ir.status}) — Refresh the scrape` : `image fetch failed (HTTP ${ir.status})` })
          return null
        }
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
        return { fields }
      } catch (e) {
        failures.push({ code, carouselIndex: idx, reason: e.message || 'unknown error' })
        return null
      }
    }
    const records = []
    for (let i = 0; i < images.length; i += CONCURRENCY) {
      const chunk = images.slice(i, i + CONCURRENCY)
      const batchResults = await Promise.all(chunk.map(processOne))
      for (const r of batchResults) if (r) records.push(r)
    }
    const failed = failures.length
    if (failed > 0) console.warn(`[photos/import] ${failed} failures:`, failures.slice(0, 5))

    let created = []
    if (records.length > 0) {
      created = await batchCreateRecords('Photos', records, { typecast: true })
    }
    return NextResponse.json({
      ok: true,
      created: created.length,
      duplicates: dupes,
      failed,
      failures, // per-image detail so the UI can surface reasons + retry just the bad ones
      ids: created.map(r => r.id),
    })
  } catch (err) {
    if (err instanceof Response) return err
    const msg = typeof err?.message === 'string' && err.message ? err.message : String(err)
    console.error('[photos/import] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
