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
    // source=ai (default) → AI Generated carousels; source=real → human-made
    // carousels (any non-AI source) through the same batch-review flow.
    const source = url.searchParams.get('source') === 'real' ? 'real' : 'ai'
    const sourceClause = source === 'real' ? "{Source Type}!='AI Generated'" : "{Source Type}='AI Generated'"

    const rows = await fetchAirtableRecords('Photos', {
      filterByFormula: `AND(${sourceClause},{Review Status}='${validStatus}',NOT({Submission Batch ID}=''))`,
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

    // Look up linked Carousel Projects (one per batch, if any) so admin
    // can "Show source" without a second fetch. Source photo URLs are
    // resolved here so the modal renders immediately.
    const batchIds = Object.keys(byBatch)
    let projectByBatch = {}
    if (batchIds.length) {
      const projects = await fetchAirtableRecords('Carousel Projects', {
        filterByFormula: `OR(${batchIds.map(b => `{Submission Batch ID}='${b.replace(/'/g, "\\'")}'`).join(',')})`,
        fields: ['Submission Batch ID', 'Source Post URL', 'Source Handle', 'Source Photos'],
      })
      // Collect every Source Photo ID across all projects, fetch in one round
      // trip, then re-attach per project so each submission card knows its
      // source slide URLs.
      const allSourceIds = [...new Set(projects.flatMap(p => p.fields?.['Source Photos'] || []))]
      let sourcePhotos = {}
      if (allSourceIds.length) {
        const photos = await fetchAirtableRecords('Photos', {
          filterByFormula: `OR(${allSourceIds.map(id => `RECORD_ID()='${id}'`).join(',')})`,
          fields: ['Carousel Index', 'Source Handle', 'CDN URL', 'Image', 'Dropbox Link'],
        })
        sourcePhotos = Object.fromEntries(photos.map(p => {
          const pf = p.fields || {}
          const cdn = pf['CDN URL'] || ''
          const att = (pf['Image'] || [])[0]
          const fallback = att?.thumbnails?.large?.url || att?.url || pf['Dropbox Link'] || ''
          return [p.id, {
            id: p.id,
            carouselIndex: pf['Carousel Index'] || 0,
            handle: pf['Source Handle'] || '',
            image: cdn || fallback,
            imageFallback: fallback,
          }]
        }))
      }
      for (const proj of projects) {
        const pf = proj.fields || {}
        const bid = pf['Submission Batch ID']
        if (!bid || !byBatch[bid]) continue
        const sourceIds = pf['Source Photos'] || []
        projectByBatch[bid] = {
          projectId: proj.id,
          sourcePostUrl: pf['Source Post URL'] || '',
          sourceHandle: pf['Source Handle'] || '',
          sourcePhotos: sourceIds
            .map(id => sourcePhotos[id])
            .filter(Boolean)
            .sort((a, b) => (a.carouselIndex || 0) - (b.carouselIndex || 0)),
        }
      }
    }

    const submissions = Object.values(byBatch)
      .map(b => ({
        ...b,
        creatorName: (b.creatorIds[0] && creatorNames[b.creatorIds[0]]) || '(unknown)',
        photos: b.photos.sort((a, b) => (a.carouselIndex || 0) - (b.carouselIndex || 0)),
        project: projectByBatch[b.batchId] || null,
      }))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))

    return NextResponse.json({ submissions, status: validStatus })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[carousel-submissions] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH — approve/reject a submission batch, OR reject a single slide
// (SMM Batch 5, Phase 2.5 carousel per-slide rejection).
//
// Body modes:
//   { batchId, action: 'approve' }
//     → Flip every Pending photo in the batch to Approved.
//
//   { batchId, action: 'reject' }
//     → Flip every Pending photo to Rejected + project Status → Rejected.
//
//   { batchId, action: 'reject-slide', photoId, mode: 'remove' | 'bounce', reason? }
//     → mode='remove': flip JUST that photo to Rejected. Sibling slides stay
//       Pending. Operator can re-approve the batch with one fewer slide.
//     → mode='bounce': equivalent to a full reject (every slide → Rejected,
//       project Status → Rejected). The 'reason' is appended to the project's
//       Rejection Reason field (additive single-line-text, created on demand
//       via typecast — or it'll surface as a write error if Airtable strict-
//       mode complains).
export async function PATCH(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { batchId, action, photoId, mode, reason } = await request.json()
    if (!batchId || typeof batchId !== 'string') {
      return NextResponse.json({ error: 'batchId required' }, { status: 400 })
    }
    if (!['approve', 'reject', 'reject-slide'].includes(action)) {
      return NextResponse.json({ error: 'action must be approve, reject, or reject-slide' }, { status: 400 })
    }

    // Per-slide rejection branch.
    if (action === 'reject-slide') {
      if (!photoId || !/^rec[A-Za-z0-9]{14}$/.test(photoId)) {
        return NextResponse.json({ error: 'photoId required (valid Airtable rec id)' }, { status: 400 })
      }
      if (!['remove', 'bounce'].includes(mode)) {
        return NextResponse.json({ error: "mode must be 'remove' or 'bounce'" }, { status: 400 })
      }

      if (mode === 'remove') {
        // Single-photo reject — siblings untouched.
        try {
          await patchAirtableRecord('Photos', photoId, { 'Review Status': 'Rejected' }, { typecast: true })
        } catch (e) {
          return NextResponse.json({ error: 'Failed to reject slide', detail: e.message }, { status: 500 })
        }
        return NextResponse.json({
          ok: true,
          batchId,
          action: 'reject-slide',
          mode: 'remove',
          photoId,
          updated: 1,
        })
      }

      // mode === 'bounce' → falls through to full-batch reject logic below
      // with the additional Rejection Reason stamping on the project.
      // (Implemented inline rather than fall-through to keep response shape
      //  parallel.)
      const photos = await fetchAirtableRecords('Photos', {
        filterByFormula: `AND({Submission Batch ID}='${batchId.replace(/'/g, "\\'")}',{Review Status}='Pending')`,
        fields: ['Submission Batch ID', 'Review Status'],
      })
      const results = await Promise.allSettled(
        photos.map(p => patchAirtableRecord('Photos', p.id, { 'Review Status': 'Rejected' }, { typecast: true }))
      )
      const failed = results.filter(r => r.status === 'rejected').length

      let projectUpdated = null
      try {
        const projects = await fetchAirtableRecords('Carousel Projects', {
          filterByFormula: `{Submission Batch ID}='${batchId.replace(/'/g, "\\'")}'`,
          fields: ['Status'],
          maxRecords: 1,
        })
        if (projects.length) {
          const proj = projects[0]
          const projectFields = {
            'Status': 'Rejected',
            'Reviewed At': new Date().toISOString(),
          }
          if (reason && typeof reason === 'string') {
            projectFields['Rejection Reason'] = reason.slice(0, 1000) // cap; field is additive single-line
          }
          await patchAirtableRecord('Carousel Projects', proj.id, projectFields, { typecast: true })
          projectUpdated = { id: proj.id, status: 'Rejected' }
        }
      } catch (e) {
        console.warn(`[carousel-submissions] bounce: project update failed for batch ${batchId}:`, e.message)
      }

      return NextResponse.json({
        ok: true,
        batchId,
        action: 'reject-slide',
        mode: 'bounce',
        photoId,
        reason: reason || null,
        updated: photos.length - failed,
        failed,
        projectUpdated,
      })
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

    // If this submission was linked to a Carousel Project (editor picked
    // a project at upload time), flip the project's Status + stamp
    // Reviewed At so the Reference Library's ✓ Done badge updates and
    // the project moves out of the in-progress dropdown.
    //   Approve → Status=Approved (auto-archived per creator)
    //   Reject  → Status=Rejected
    let projectUpdated = null
    try {
      const projects = await fetchAirtableRecords('Carousel Projects', {
        filterByFormula: `{Submission Batch ID}='${batchId.replace(/'/g, "\\'")}'`,
        fields: ['Status'],
        maxRecords: 1,
      })
      if (projects.length) {
        const proj = projects[0]
        const projectStatus = action === 'approve' ? 'Approved' : 'Rejected'
        await patchAirtableRecord('Carousel Projects', proj.id, {
          'Status': projectStatus,
          'Reviewed At': new Date().toISOString(),
        }, { typecast: true })
        projectUpdated = { id: proj.id, status: projectStatus }
      }
    } catch (e) {
      console.warn(`[carousel-submissions] Could not update linked project for batch ${batchId}:`, e.message)
    }

    return NextResponse.json({
      ok: true,
      batchId,
      action,
      newStatus,
      updated: photos.length - failed,
      failed,
      projectUpdated,
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[carousel-submissions] PATCH error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
