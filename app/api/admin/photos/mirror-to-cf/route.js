import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, downloadFromDropbox } from '@/lib/dropbox'
import { uploadImageBytes, buildDeliveryUrl, isCloudflareImagesConfigured } from '@/lib/cloudflareImages'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST /api/admin/photos/mirror-to-cf?limit=10
//
// Backfill: takes Photos records that have a Dropbox Path but no
// CDN URL yet, downloads each one from Dropbox, uploads to Cloudflare
// Images, writes CDN URL + CDN Image ID back to the record.
//
// Bounded by ?limit= (max 20 per call) to stay inside Vercel's
// 60s function timeout — each photo is a Dropbox download + a CF
// upload + an Airtable patch (~3s end-to-end). Hit the endpoint
// repeatedly until { remaining: 0 } to clear the backlog.
export async function POST(request) {
  try {
    await requireAdmin()
    if (!isCloudflareImagesConfigured()) {
      return NextResponse.json({ error: 'Cloudflare Images not configured (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_IMAGES_HASH + CLOUDFLARE_IMAGES_TOKEN)' }, { status: 500 })
    }
    const limit = Math.min(20, Math.max(1, parseInt(new URL(request.url).searchParams.get('limit') || '10', 10)))

    // Pull every Photos row that still needs mirroring. Filter
    // client-side so the formula stays simple — {CDN URL}='' covers
    // both unset and explicit-empty.
    const all = await fetchAirtableRecords('Photos', {
      fields: ['Source Handle', 'Source Post URL', 'Carousel Index', 'Dropbox Path', 'CDN URL'],
      filterByFormula: `AND({CDN URL}='', NOT({Dropbox Path}=''))`,
    })
    const targets = all.slice(0, limit)
    if (targets.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, done: 0, failed: 0, remaining: 0 })
    }

    const tok = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(tok)

    let done = 0
    let failed = 0
    const results = []
    for (const row of targets) {
      const f = row.fields || {}
      const path = f['Dropbox Path']
      const handle = f['Source Handle'] || 'unknown'
      const postUrl = f['Source Post URL'] || ''
      const idx = f['Carousel Index'] || 1
      const code = postUrl.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/)?.[1] || row.id
      try {
        const buf = await downloadFromDropbox(tok, ns, path)
        if (!buf) throw new Error('Dropbox download returned no bytes')
        const cfId = `photos-${handle}-${code}-${String(idx).padStart(2, '0')}`.toLowerCase().replace(/[^a-z0-9-]/g, '-')
        const r = await uploadImageBytes(buf, cfId)
        const cdnUrl = buildDeliveryUrl(r.id, 'public')
        await patchAirtableRecord('Photos', row.id, {
          'CDN URL': cdnUrl,
          'CDN Image ID': r.id,
        }, { typecast: true })
        done++
        results.push({ id: row.id, cfId, alreadyExisted: r.alreadyExisted })
      } catch (e) {
        failed++
        results.push({ id: row.id, error: e.message })
        console.warn(`[photos/mirror-to-cf] ${row.id} failed:`, e.message)
      }
    }

    return NextResponse.json({
      ok: true,
      processed: targets.length,
      done,
      failed,
      remaining: Math.max(0, all.length - done),
      results,
    })
  } catch (err) {
    if (err instanceof Response) return err
    const msg = typeof err?.message === 'string' && err.message ? err.message : String(err)
    console.error('[photos/mirror-to-cf] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
