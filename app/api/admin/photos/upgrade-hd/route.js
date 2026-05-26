import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'
import { uploadImageBytes, buildDeliveryUrl, isCloudflareImagesConfigured } from '@/lib/cloudflareImages'
import { fetchPostHdUrls } from '@/lib/instagramHd'
import { quoteAirtableString } from '@/lib/airtableFormula'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PHOTOS = 'Photos'

// POST { photoId } — re-fetch the HD version of one Photos row.
//
// Why this exists: the feed scraper only returned ~480px candidates,
// so a Photos backlog imported before the HD-on-import fix is sitting
// at 38–79KB. This route hits the per-post detail endpoint
// (get_media_data.php?type=post → 1080w display_resources), pulls the
// HD bytes, overwrites the Dropbox file at the same path, and replaces
// the Cloudflare Images variant. Editor clicks ↑ HD on the card and
// the row gets a fresh, sharper master without re-importing.
export async function POST(request) {
  try {
    await requireAdmin()
    const body = await request.json()
    const photoId = String(body.photoId || '')
    if (!/^rec[A-Za-z0-9]{14}$/.test(photoId)) {
      return NextResponse.json({ error: 'Valid photoId required' }, { status: 400 })
    }

    const rows = await fetchAirtableRecords(PHOTOS, {
      fields: ['Source Handle', 'Source Post URL', 'Carousel Index', 'Dropbox Path', 'CDN URL', 'CDN Image ID'],
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(photoId)}`,
    })
    if (!rows.length) return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
    const f = rows[0].fields || {}
    const handle = (f['Source Handle'] || 'unknown').toLowerCase()
    const postUrl = f['Source Post URL'] || ''
    const idx = f['Carousel Index'] || 1
    const code = postUrl.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/)?.[1]
    if (!code) return NextResponse.json({ error: 'Could not parse post code from Source Post URL' }, { status: 400 })

    const hdMap = await fetchPostHdUrls(code)
    if (!hdMap) {
      return NextResponse.json({ error: 'RapidAPI returned no HD URLs (post may be deleted, private, or the API is rate-limited)' }, { status: 502 })
    }
    const hdUrl = hdMap.get(idx)
    if (!hdUrl) {
      return NextResponse.json({ error: `No HD URL for carousel index ${idx} (post only has ${hdMap.size} items)` }, { status: 404 })
    }

    const ir = await fetch(hdUrl)
    if (!ir.ok) {
      return NextResponse.json({ error: `IG CDN returned HTTP ${ir.status} for the HD URL` }, { status: 502 })
    }
    const buf = Buffer.from(await ir.arrayBuffer())
    const bytesBefore = buf.length

    // Overwrite Dropbox at the same path so existing references stay
    // valid. If the row never had a Dropbox path (rare — old test data),
    // mint one from the canonical convention.
    const dbxPath = f['Dropbox Path'] || `/Palm Ops/Photos/${handle}/${code}_${String(idx).padStart(2, '0')}.jpg`
    const tok = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(tok)
    try {
      await uploadToDropbox(tok, ns, dbxPath, buf, { overwrite: true })
    } catch (e) {
      return NextResponse.json({ error: `Dropbox upload failed: ${e.message}` }, { status: 502 })
    }
    let dbxLink = ''
    try { dbxLink = await createDropboxSharedLink(tok, ns, dbxPath) } catch {}

    // CF Images: re-upload bytes. The id is stable per (handle, code,
    // idx) so we either overwrite the existing variant (5409) or get a
    // new ID. Either way buildDeliveryUrl resolves to the new content.
    let cdnUrl = f['CDN URL'] || null
    let cdnImageId = f['CDN Image ID'] || null
    if (isCloudflareImagesConfigured()) {
      const cfId = `photos-${handle}-${code}-${String(idx).padStart(2, '0')}`.toLowerCase().replace(/[^a-z0-9-]/g, '-')
      try {
        const r = await uploadImageBytes(buf, cfId)
        cdnImageId = r.id
        cdnUrl = buildDeliveryUrl(r.id, 'public')
      } catch (e) {
        console.warn(`[photos/upgrade-hd] CF Images upload failed:`, e.message)
      }
    }

    const patch = {
      'Dropbox Path': dbxPath,
      ...(dbxLink ? { 'Dropbox Link': dbxLink } : {}),
      ...(cdnUrl ? { 'CDN URL': cdnUrl } : {}),
      ...(cdnImageId ? { 'CDN Image ID': cdnImageId } : {}),
    }
    await patchAirtableRecord(PHOTOS, photoId, patch, { typecast: true })

    return NextResponse.json({
      ok: true,
      photoId,
      bytes: bytesBefore,
      cdnUrl,
      cdnImageId,
      dropboxPath: dbxPath,
    })
  } catch (err) {
    if (err instanceof Response) return err
    const msg = typeof err?.message === 'string' && err.message ? err.message : String(err)
    console.error('[photos/upgrade-hd] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
