import { NextResponse } from 'next/server'
import { requireAdmin, batchCreateRecords, fetchAirtableRecords, patchAirtableRecord, OPS_BASE } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'
import { uploadImageBytes, buildDeliveryUrl, isCloudflareImagesConfigured } from '@/lib/cloudflareImages'
import { fetchPostHdUrls } from '@/lib/instagramHd'

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
    const rawImages = Array.isArray(body.images) ? body.images : []
    if (!handle) return NextResponse.json({ error: 'handle required' }, { status: 400 })
    if (rawImages.length === 0) return NextResponse.json({ error: 'no images selected' }, { status: 400 })
    if (rawImages.length > 50) return NextResponse.json({ error: 'max 50 images per import' }, { status: 400 })
    // Server-side dedupe in case the client sent the same (code,
    // carouselIndex) twice (older scrape cache could've contained
    // duplicates and the modal's filter expanded each one).
    const seenServerKey = new Set()
    const images = []
    for (const img of rawImages) {
      const k = `${img.code}|${img.carouselIndex || 1}`
      if (seenServerKey.has(k)) continue
      seenServerKey.add(k)
      images.push(img)
    }

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
    // staying inside Dropbox's per-second write rate limit (around
    // 10-12 ops/sec/app). Concurrency 4 + retry-with-backoff on 429
    // handles the burst case where a fast network briefly pushes
    // writes/sec above the cap.
    let dupes = 0
    const failures = [] // detailed per-image: { code, carouselIndex, reason }
    const CONCURRENCY = 4

    // Wrap uploadToDropbox with retry on 429 (too_many_write_operations).
    // Dropbox tells us how long to wait via retry_after; we honour it
    // with a small jitter so concurrent retries don't perfectly align
    // and slam the API again at the exact same instant.
    const uploadWithRetry = async (tok, ns, path, buf, maxAttempts = 3) => {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          return await uploadToDropbox(tok, ns, path, buf, { overwrite: true })
        } catch (e) {
          const msg = e?.message || ''
          const m429 = msg.match(/429.*retry_after"\s*:\s*(\d+)/)
          if (m429 && attempt < maxAttempts - 1) {
            const waitMs = (parseInt(m429[1], 10) || 1) * 1000 + Math.floor(Math.random() * 500)
            await new Promise(r => setTimeout(r, waitMs))
            continue
          }
          throw e
        }
      }
      throw new Error('uploadToDropbox: retries exhausted')
    }
    // Per-post HD URL cache. The feed endpoint only ships ~480px-wide
    // candidates; get_media_data.php?type=post returns up to 1080w which
    // is 2-4× the bytes. One call per unique post code yields URLs for
    // every carousel position, so we batch resolve up front and let
    // processOne look up by (code, carouselIndex).
    const distinctCodes = [...new Set(images.map(i => String(i.code || '').trim()).filter(Boolean))]
    const hdByCode = new Map()
    await Promise.all(distinctCodes.map(async (code) => {
      try {
        const map = await fetchPostHdUrls(code)
        if (map) hdByCode.set(code, map)
      } catch (e) { console.warn(`[photos/import] HD lookup ${code} failed:`, e.message) }
    }))

    const processOne = async (img) => {
      const code = String(img.code || '').trim()
      const idx = Number(img.carouselIndex) || 1
      if (!code) { failures.push({ code: '?', carouselIndex: idx, reason: 'missing code' }); return null }
      if (existingKeys.has(`${code}|${idx}`)) { dupes++; return null }
      // Prefer the freshly-fetched HD URL from get_media_data; fall back
      // to the cached feed URL if the post-detail call missed (rate
      // limited, deleted post, etc.). Either way the file ends up in
      // Dropbox + CF Images.
      const hdUrl = hdByCode.get(code)?.get(idx)
      const srcUrl = hdUrl || img.fullResUrl || img.thumbnail
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
        await uploadWithRetry(tok, ns, dbxPath, buf)
        let dbxLink = ''
        try { dbxLink = await createDropboxSharedLink(tok, ns, dbxPath) } catch {}
        // Also mirror to Cloudflare Images so the UI can load thumbnails
        // from imagedelivery.net (~50ms global CDN) instead of streaming
        // through our Dropbox proxy. Stable CF id keyed by (handle,
        // code, idx) so re-uploads are idempotent — CF 5409 = already
        // exists, returns the same id.
        let cdnUrl = null, cdnImageId = null
        if (isCloudflareImagesConfigured()) {
          const cfId = `photos-${handle}-${code}-${String(idx).padStart(2, '0')}`.toLowerCase().replace(/[^a-z0-9-]/g, '-')
          try {
            const r = await uploadImageBytes(buf, cfId)
            cdnImageId = r.id
            cdnUrl = buildDeliveryUrl(r.id, 'public')
          } catch (e) {
            console.warn(`[photos/import] CF Images upload ${cfId} failed:`, e.message)
          }
        }
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
        if (cdnUrl) fields['CDN URL'] = cdnUrl
        if (cdnImageId) fields['CDN Image ID'] = cdnImageId
        // Airtable Image attachment intentionally NOT set — Dropbox is
        // source of truth for bytes, CF Images for fast delivery,
        // Airtable for metadata only.
        return { fields }
      } catch (e) {
        // Normalize known Dropbox error messages into something the
        // editor can act on. Raw Dropbox JSON is huge and unhelpful
        // in the UI footer.
        const raw = e?.message || 'unknown error'
        const reason = /too_many_write_operations/i.test(raw) ? 'Dropbox rate limited (retries exhausted) — try Import again'
          : /no_write_permission/i.test(raw) ? 'Dropbox: no write permission'
          : /insufficient_space/i.test(raw) ? 'Dropbox: out of space'
          : raw.length > 120 ? raw.slice(0, 120) + '…'
          : raw
        failures.push({ code, carouselIndex: idx, reason })
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
