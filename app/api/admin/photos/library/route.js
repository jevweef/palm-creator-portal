import { NextResponse } from 'next/server'
import { requireAdmin, requireAdminOrAiEditor, fetchAirtableRecords, patchAirtableRecord, OPS_BASE } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'
const TABLE = 'Photos'
const AIRTABLE_PAT = process.env.AIRTABLE_PAT

// GET ?outfitsOnly=1 — list every Photo (default) or only outfit-flagged
// ones (used by the workflow's outfit picker so editors see just the
// curated pool, not every imported image).
export async function GET(request) {
  try {
    // AI editors need read access too — the outfit picker in the Stage B
    // workflow runs under their session. Mutations stay admin-only via
    // the PATCH/DELETE handlers below.
    await requireAdminOrAiEditor()
    const outfitsOnly = new URL(request.url).searchParams.get('outfitsOnly') === '1'
    const rows = await fetchAirtableRecords(TABLE, {
      fields: ['Source Handle', 'Source Post URL', 'Carousel Index', 'Carousel Total', 'Image', 'Dropbox Link', 'Dropbox Path', 'Posted At', 'Caption', 'Status', 'Outfit Type', 'Creator', 'Is Outfit', 'Outfit Reviewed', 'CDN URL', 'Flatlay Status', 'Flatlay CDN URL', 'Flatlay Dropbox Path'],
      ...(outfitsOnly ? { filterByFormula: `{Is Outfit} = TRUE()` } : {}),
    })
    const photos = rows.map(r => {
      const f = r.fields || {}
      // Display priority: Cloudflare Images CDN (fastest, permanent) →
      // Dropbox-proxy endpoint (works but pulls bytes through our server)
      // → legacy Airtable attachment URL (only for old rows). The img
      // tag uses `image`, falls back via onError to `imageFallback`.
      const cdnUrl = f['CDN URL'] || ''
      const dropboxPath = f['Dropbox Path'] || ''
      const dropboxLink = f['Dropbox Link'] || ''
      const proxyUrl = dropboxPath ? `/api/admin/photos/image?path=${encodeURIComponent(dropboxPath)}` : ''
      const att = f.Image
      const attThumb = (Array.isArray(att) && att[0]) ? (att[0].thumbnails?.large?.url || att[0].url) : null
      const bestImage = cdnUrl || proxyUrl || attThumb
      return {
        id: r.id,
        handle: f['Source Handle'] || '',
        postUrl: f['Source Post URL'] || '',
        carouselIndex: f['Carousel Index'] || 1,
        carouselTotal: f['Carousel Total'] || 1,
        image: bestImage,
        imageFull: bestImage,
        // Fallback chain for onError: proxy first (if we tried CDN),
        // then Airtable attachment. Skips the URL already in use.
        imageFallback: bestImage === cdnUrl ? (proxyUrl || attThumb) : attThumb,
        cdnUrl,
        dropbox: dropboxLink,
        postedAt: f['Posted At'] || null,
        caption: f.Caption || '',
        status: f.Status?.name || f.Status || 'Pending',
        outfitType: f['Outfit Type']?.name || f['Outfit Type'] || null,
        creatorIds: f.Creator || [],
        isOutfit: !!f['Is Outfit'],
        outfitReviewed: !!f['Outfit Reviewed'],
        flatlayStatus: f['Flatlay Status']?.name || f['Flatlay Status'] || 'None',
        flatlayCdnUrl: f['Flatlay CDN URL'] || '',
        flatlayDropboxPath: f['Flatlay Dropbox Path'] || '',
        createdTime: r.createdTime,
      }
    }).sort((a, b) => (b.createdTime || '').localeCompare(a.createdTime || ''))
    return NextResponse.json({ ok: true, photos })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH { id, fields }  —  Approve/Reject, tag Outfit Type, link Creator, etc.
export async function PATCH(request) {
  try {
    await requireAdmin()
    const { id, fields } = await request.json()
    if (!id || !/^rec[A-Za-z0-9]{14}$/.test(id)) {
      return NextResponse.json({ error: 'Valid id required' }, { status: 400 })
    }
    if (!fields || typeof fields !== 'object') {
      return NextResponse.json({ error: 'fields object required' }, { status: 400 })
    }
    await patchAirtableRecord(TABLE, id, fields, { typecast: true })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE ?id=rec... — removes the Airtable record (Dropbox file stays
// in place; harmless and recoverable.)
export async function DELETE(request) {
  try {
    await requireAdmin()
    const id = new URL(request.url).searchParams.get('id')
    if (!id || !/^rec[A-Za-z0-9]{14}$/.test(id)) {
      return NextResponse.json({ error: 'Valid id required' }, { status: 400 })
    }
    const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(TABLE)}/${id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
    })
    if (!res.ok) return NextResponse.json({ error: `airtable ${res.status}` }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
