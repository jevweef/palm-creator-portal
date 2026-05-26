import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

// GET — list AI Carousel submissions awaiting review.
//   Returns rows grouped by Submission Batch ID. Each group has the creator
//   AKA + uploader + slide count + per-slide thumbnails so the admin can
//   eyeball the batch before approving / rejecting.
//
// Default returns only Status='Pending'. ?status=approved or ?status=rejected
// to view history (no UI for that yet, kept for future use).
export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const url = new URL(request.url)
    const status = url.searchParams.get('status') || 'Pending'
    const validStatus = ['Pending', 'Approved', 'Rejected'].includes(status) ? status : 'Pending'

    const rows = await fetchAirtableRecords('Photos', {
      filterByFormula: `AND({Source Type}='AI Generated',{Review Status}='${validStatus}',NOT({Submission Batch ID}=''))`,
      fields: ['Source Type', 'Creator', 'Review Status', 'Submission Batch ID', 'Submission Title', 'Uploaded By', 'CDN URL', 'Image', 'Carousel Index', 'Dropbox Link'],
    })

    // Group by Submission Batch ID. Each batch = one submission.
    const byBatch = {}
    for (const r of rows) {
      const f = r.fields || {}
      const bid = f['Submission Batch ID']
      if (!bid) continue
      if (!byBatch[bid]) {
        byBatch[bid] = {
          batchId: bid,
          title: f['Submission Title'] || '',
          uploadedBy: f['Uploaded By'] || '',
          creatorIds: f['Creator'] || [],
          createdAt: r.createdTime,
          photos: [],
        }
      }
      const cdnUrl = f['CDN URL'] || ''
      const att = (f['Image'] || [])[0]
      const fallback = att?.thumbnails?.large?.url || att?.url || f['Dropbox Link'] || ''
      byBatch[bid].photos.push({
        id: r.id,
        carouselIndex: f['Carousel Index'] || 0,
        image: cdnUrl || fallback,
        imageFallback: fallback,
      })
      // Track earliest createdAt for sort.
      if (r.createdTime < byBatch[bid].createdAt) byBatch[bid].createdAt = r.createdTime
    }

    // Resolve creator names so the For Review card shows "@Amelia" not a rec ID.
    const allCreatorIds = [...new Set(Object.values(byBatch).flatMap(b => b.creatorIds))]
    let creatorNames = {}
    if (allCreatorIds.length) {
      const creatorRecs = await fetchAirtableRecords('Palm Creators', {
        filterByFormula: `OR(${allCreatorIds.map(id => `RECORD_ID()='${id}'`).join(',')})`,
        fields: ['AKA', 'Creator'],
      })
      creatorNames = Object.fromEntries(
        creatorRecs.map(c => [c.id, c.fields?.AKA || c.fields?.Creator || c.id])
      )
    }

    const submissions = Object.values(byBatch)
      .map(b => ({
        ...b,
        creatorName: (b.creatorIds[0] && creatorNames[b.creatorIds[0]]) || '(unknown)',
        photos: b.photos.sort((a, b) => (a.carouselIndex || 0) - (b.carouselIndex || 0)),
      }))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))

    return NextResponse.json({ submissions, status: validStatus })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[carousel-submissions] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH — bulk approve/reject every photo in a submission batch.
//   Body: { batchId, action: 'approve' | 'reject' }
//   Flips Review Status across all photos sharing the batchId. Approved
//   photos surface in the Carousels picker under AI Generated. Rejected
//   ones stay in Airtable but the picker filter hides them.
export async function PATCH(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { batchId, action } = await request.json()
    if (!batchId || typeof batchId !== 'string') {
      return NextResponse.json({ error: 'batchId required' }, { status: 400 })
    }
    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 })
    }
    const newStatus = action === 'approve' ? 'Approved' : 'Rejected'

    const photos = await fetchAirtableRecords('Photos', {
      filterByFormula: `AND({Submission Batch ID}='${batchId.replace(/'/g, "\\'")}',{Review Status}='Pending')`,
      fields: ['Submission Batch ID', 'Review Status'],
    })
    if (!photos.length) {
      return NextResponse.json({ error: 'No pending photos for this batch' }, { status: 404 })
    }

    const results = await Promise.allSettled(
      photos.map(p => patchAirtableRecord('Photos', p.id, { 'Review Status': newStatus }, { typecast: true }))
    )
    const failed = results.filter(r => r.status === 'rejected').length
    if (failed > 0) {
      console.warn(`[carousel-submissions] ${failed}/${photos.length} patches failed for batch ${batchId}`)
    }

    return NextResponse.json({
      ok: true,
      batchId,
      action,
      newStatus,
      updated: photos.length - failed,
      failed,
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[carousel-submissions] PATCH error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
