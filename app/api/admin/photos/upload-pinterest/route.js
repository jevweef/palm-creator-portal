import { NextResponse } from 'next/server'
import { requireAdmin, batchCreateRecords } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'
import { uploadImageBytes, buildDeliveryUrl, isCloudflareImagesConfigured } from '@/lib/cloudflareImages'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// POST multipart/form-data with files[] — uploads a batch of outfit
// images (typically saved Pins or mood-board screenshots) directly
// into the Outfit Library.
//
// Each file:
//   1. Streams to Dropbox at /Palm Ops/Photos/Pinterest/{YYYY-MM-DD}/{uuid}.{ext}
//   2. Mirrors to Cloudflare Images for fast delivery
//   3. Creates a Photos row pre-flagged Is Outfit + Outfit Reviewed
//      so it lands directly in the curated outfit pool — no separate
//      curation step needed since the editor already cherry-picked
//      these on Pinterest.
//
// Source Type = Pinterest so the regular Library hides them (no IG
// post URL, no carousel grouping — they'd just clutter the carousel
// view). They surface only in the Outfit Library tab.
export async function POST(request) {
  try {
    await requireAdmin()
    const formData = await request.formData()
    const files = formData.getAll('files').filter(f => f && typeof f === 'object' && 'arrayBuffer' in f)
    if (files.length === 0) return NextResponse.json({ error: 'No files in upload' }, { status: 400 })
    if (files.length > 50) return NextResponse.json({ error: 'Max 50 files per upload' }, { status: 400 })

    const tok = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(tok)
    const today = new Date().toISOString().slice(0, 10)

    // Bounded concurrency keeps us under Dropbox's ~10 ops/sec write
    // ceiling. Same ceiling logic as the IG import path.
    const CONCURRENCY = 4
    const failures = []
    const records = []
    const uploadWithRetry = async (path, buf, maxAttempts = 3) => {
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

    const processOne = async (file, i) => {
      const originalName = (file.name || `pin-${i}.jpg`).slice(0, 100)
      try {
        const buf = Buffer.from(await file.arrayBuffer())
        if (!buf.length) { failures.push({ name: originalName, reason: 'empty file' }); return null }

        // Short collision-resistant id — Date.now is enough granularity
        // for batches of <50 files / sec, plus index suffix locks in
        // ordering within the batch.
        const ts = Date.now()
        const shortId = `${ts.toString(36)}${String(i).padStart(2, '0')}`
        // Carry forward the user's original extension when sensible.
        // Default to .jpg since CF Images encodes everything as JPEG
        // when served as the "public" variant anyway.
        const extMatch = originalName.match(/\.(jpg|jpeg|png|webp|gif)$/i)
        const ext = (extMatch?.[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg')
        const dbxPath = `/Palm Ops/Photos/Pinterest/${today}/${shortId}.${ext}`

        await uploadWithRetry(dbxPath, buf)
        let dbxLink = ''
        try { dbxLink = await createDropboxSharedLink(tok, ns, dbxPath) } catch {}

        let cdnUrl = null, cdnImageId = null
        if (isCloudflareImagesConfigured()) {
          const cfId = `pinterest-${shortId}`
          try {
            const r = await uploadImageBytes(buf, cfId)
            cdnImageId = r.id
            cdnUrl = buildDeliveryUrl(r.id, 'public')
          } catch (e) {
            console.warn(`[photos/upload-pinterest] CF upload ${cfId} failed:`, e.message)
          }
        }

        const fields = {
          // Friendly name — surface the user's original filename so
          // they can correlate uploads to their saved-Pins folder.
          Name: `Pinterest · ${today} · ${originalName}`,
          // No real handle for Pinterest uploads — use the marker
          // 'pinterest' so the existing handle-based filtering still
          // groups them. The Source Type field is what UI logic keys on.
          'Source Handle': 'pinterest',
          'Source Type': 'Pinterest',
          // No source URL or carousel — these are standalone outfit
          // refs. Carousel Index/Total default to 1 so the card UI
          // doesn't render a 🎞 badge.
          'Carousel Index': 1,
          'Carousel Total': 1,
          // Pre-curated: the editor already cherry-picked these, so
          // they go straight into the outfit pool without needing the
          // Outfit Picker flow. Outfit Reviewed=true keeps them out of
          // that picker queue.
          'Is Outfit': true,
          'Outfit Reviewed': true,
          Status: 'Approved',
          ...(dbxPath ? { 'Dropbox Path': dbxPath } : {}),
          ...(dbxLink ? { 'Dropbox Link': dbxLink } : {}),
          ...(cdnUrl ? { 'CDN URL': cdnUrl } : {}),
          ...(cdnImageId ? { 'CDN Image ID': cdnImageId } : {}),
        }
        return { fields }
      } catch (e) {
        const raw = e?.message || 'unknown error'
        const reason = /too_many_write_operations/i.test(raw) ? 'Dropbox rate limited — try Upload again'
          : /no_write_permission/i.test(raw) ? 'Dropbox: no write permission'
          : /insufficient_space/i.test(raw) ? 'Dropbox: out of space'
          : raw.length > 120 ? raw.slice(0, 120) + '…'
          : raw
        failures.push({ name: originalName, reason })
        return null
      }
    }

    for (let i = 0; i < files.length; i += CONCURRENCY) {
      const chunk = files.slice(i, i + CONCURRENCY)
      const batchResults = await Promise.all(chunk.map((f, j) => processOne(f, i + j)))
      for (const r of batchResults) if (r) records.push(r)
    }

    let created = []
    if (records.length > 0) {
      created = await batchCreateRecords('Photos', records, { typecast: true })
    }

    return NextResponse.json({
      ok: true,
      created: created.length,
      failed: failures.length,
      failures,
      ids: created.map(r => r.id),
    })
  } catch (err) {
    if (err instanceof Response) return err
    const msg = typeof err?.message === 'string' && err.message ? err.message : String(err)
    console.error('[photos/upload-pinterest] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
