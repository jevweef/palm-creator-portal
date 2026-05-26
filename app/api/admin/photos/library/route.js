import { NextResponse } from 'next/server'
import { requireAdmin, requireAdminOrAiEditor, fetchAirtableRecords, patchAirtableRecord, OPS_BASE } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, deleteDropboxFile } from '@/lib/dropbox'
import { deleteImage as deleteCfImage, isCloudflareImagesConfigured } from '@/lib/cloudflareImages'
import { quoteAirtableString } from '@/lib/airtableFormula'

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
      fields: ['Source Handle', 'Source Post URL', 'Carousel Index', 'Carousel Total', 'Image', 'Dropbox Link', 'Dropbox Path', 'Posted At', 'Caption', 'Status', 'Outfit Type', 'Creator', 'Is Outfit', 'Outfit Reviewed', 'CDN URL', 'Flatlay Status', 'Flatlay CDN URL', 'Flatlay Dropbox Path', 'Flatlay Model', 'Flatlay Locked', 'Source Type', 'Flatlay Variants', 'Used In Carousel', 'Review Status', 'Submission Batch ID'],
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
        dropboxPath, // needed by the download helpers in PhotoCard
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
        flatlayModel: f['Flatlay Model'] || '',
        flatlayLocked: !!f['Flatlay Locked'],
        // Parsed variant history — every flatlay generation, newest
        // first. Legacy rows without the field synthesize a single
        // entry from the active CDN/path fields so the UI shows what
        // exists rather than empty.
        flatlayVariants: (() => {
          try {
            const arr = JSON.parse(f['Flatlay Variants'] || '[]')
            if (Array.isArray(arr) && arr.length) return arr
          } catch {}
          // Legacy fallback: synthesize from the single-flatlay fields.
          if (f['Flatlay CDN URL'] || f['Flatlay Dropbox Path']) {
            return [{
              model: f['Flatlay Model'] || 'nano',
              cdnUrl: f['Flatlay CDN URL'] || '',
              dropboxPath: f['Flatlay Dropbox Path'] || '',
              predictionId: '',
              generatedAt: '',
            }]
          }
          return []
        })(),
        // Source Type defaults to "Instagram" semantically — legacy
        // rows lack the field but they all came from the IG scraper.
        sourceType: f['Source Type']?.name || f['Source Type'] || 'Instagram',
        // Marked true after the photo is submitted into a carousel post.
        // Carousels tab filters these out of the picker so the same image
        // isn't reused; un-marked when the carousel is discarded.
        usedInCarousel: !!f['Used In Carousel'],
        // AI carousel submissions land as Pending and only become picker-
        // eligible after an admin approves them in the For Review tab.
        // Legacy AI gens that pre-date this field have no Review Status
        // and pass the filter unchanged.
        reviewStatus: f['Review Status']?.name || f['Review Status'] || null,
        submissionBatchId: f['Submission Batch ID'] || null,
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

// DELETE ?id=rec... — removes the Airtable record AND the underlying
// Dropbox files (original + flatlay) AND the Cloudflare Images
// variants (original + flatlay). Photos rows are 1:1 with bytes —
// nothing else references them — so full cleanup is safe and keeps
// storage from leaking. Pinterest uploads especially benefit since
// the editor uploaded those bytes themselves and expects "delete"
// to actually delete.
//
// Cleanup failures (Dropbox 409 / CF 404 etc.) are logged but
// non-fatal: the Airtable record always gets removed so the photo
// disappears from the UI even when the storage cleanup misses.
export async function DELETE(request) {
  try {
    await requireAdmin()
    const id = new URL(request.url).searchParams.get('id')
    if (!id || !/^rec[A-Za-z0-9]{14}$/.test(id)) {
      return NextResponse.json({ error: 'Valid id required' }, { status: 400 })
    }

    // Look up the row first so we know which files to clean up.
    const rows = await fetchAirtableRecords(TABLE, {
      fields: ['Dropbox Path', 'CDN Image ID', 'Flatlay Dropbox Path', 'CDN URL', 'Flatlay CDN URL'],
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(id)}`,
    })
    const f = rows[0]?.fields || {}
    const dropboxPath = f['Dropbox Path'] || ''
    const flatlayDropboxPath = f['Flatlay Dropbox Path'] || ''
    const cdnImageId = f['CDN Image ID'] || ''
    // Flatlay CF ids follow the pattern `flatlay-{model?}-{handle}-{code}-{idx}`
    // but we don't store the id field — extract from the URL.
    const flatlayCdnId = (() => {
      const u = f['Flatlay CDN URL'] || ''
      const m = u.match(/imagedelivery\.net\/[^/]+\/([^/]+)\//)
      return m?.[1] || ''
    })()

    // Kick off storage cleanup in parallel. None of these are fatal —
    // worst case bytes leak, the user can run a cleanup pass later.
    const cleanupTasks = []
    if (dropboxPath || flatlayDropboxPath) {
      cleanupTasks.push((async () => {
        try {
          const tok = await getDropboxAccessToken()
          const ns = await getDropboxRootNamespaceId(tok)
          if (dropboxPath) await deleteDropboxFile(tok, ns, dropboxPath).catch(e =>
            console.warn(`[photos/library DELETE] Dropbox original ${dropboxPath}:`, e.message))
          if (flatlayDropboxPath) await deleteDropboxFile(tok, ns, flatlayDropboxPath).catch(e =>
            console.warn(`[photos/library DELETE] Dropbox flatlay ${flatlayDropboxPath}:`, e.message))
        } catch (e) { console.warn(`[photos/library DELETE] Dropbox setup:`, e.message) }
      })())
    }
    if (isCloudflareImagesConfigured()) {
      if (cdnImageId) cleanupTasks.push(deleteCfImage(cdnImageId).catch(e =>
        console.warn(`[photos/library DELETE] CF original ${cdnImageId}:`, e.message)))
      if (flatlayCdnId) cleanupTasks.push(deleteCfImage(flatlayCdnId).catch(e =>
        console.warn(`[photos/library DELETE] CF flatlay ${flatlayCdnId}:`, e.message)))
    }

    // Drop the Airtable record. This is the "user-visible" delete —
    // even if storage cleanup fails the photo disappears from the UI.
    const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(TABLE)}/${id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
    })
    if (!res.ok) return NextResponse.json({ error: `airtable ${res.status}` }, { status: 500 })

    // Let storage tasks finish so we surface failures in logs, but
    // we already returned the user-visible result so no waiting cost.
    await Promise.allSettled(cleanupTasks)

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
