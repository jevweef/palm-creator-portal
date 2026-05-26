import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import {
  requireAdmin,
  requireAdminOrAiEditor,
  fetchAirtableRecords,
  createAirtableRecord,
  patchAirtableRecord,
} from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'

export const dynamic = 'force-dynamic'

const TABLE = 'Carousel Projects'
const PHOTOS = 'Photos'
const CREATORS = 'Palm Creators'

// POST — start a project from a scraped IG carousel for a specific creator.
//   Body: { sourcePostUrl, creatorId }
//   Server-side: looks up every Photos row with that Source Post URL (the
//   slides of the IG carousel) and the creator's AKA, generates a project
//   name, creates a Carousel Projects row with Status='Planning', and
//   returns the new project.
//   Multi-creator: same sourcePostUrl can have multiple project rows
//   (one per creator) — no uniqueness constraint, archived independently.
export async function POST(request) {
  try {
    await requireAdminOrAiEditor()
    const { sourcePostUrl, creatorId, notes } = await request.json()
    if (!sourcePostUrl || typeof sourcePostUrl !== 'string') {
      return NextResponse.json({ error: 'sourcePostUrl required' }, { status: 400 })
    }
    if (!creatorId || !/^rec[A-Za-z0-9]{14}$/.test(creatorId)) {
      return NextResponse.json({ error: 'valid creatorId required' }, { status: 400 })
    }

    // Resolve creator AKA for the project name.
    const creators = await fetchAirtableRecords(CREATORS, {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(creatorId)}`,
      fields: ['AKA', 'Creator'],
      maxRecords: 1,
    })
    if (!creators.length) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
    const aka = creators[0].fields?.AKA || creators[0].fields?.Creator || 'unknown'

    // Pull source carousel slides. Match by Source Post URL only — that
    // field is reliably set by the IG scraper, and post-URL-having photos
    // are by definition scraped IG (Pinterest/AI/Creator uploads don't
    // have one). Allowing blank Source Type covers legacy rows from
    // before the field existed; non-Instagram Source Types are excluded
    // explicitly so AI-gen photos that accidentally carry a Source Post
    // URL don't sneak in as a project source.
    // Match URL with OR without trailing slash — Airtable's `=` is exact
    // and the scraper can store either form depending on the source.
    const trimmed = sourcePostUrl.replace(/\/+$/, '')
    const withSlash = `${trimmed}/`
    const safeTrimmed = trimmed.replace(/'/g, "\\'")
    const safeWithSlash = withSlash.replace(/'/g, "\\'")
    const slides = await fetchAirtableRecords(PHOTOS, {
      filterByFormula: `AND(OR({Source Post URL}='${safeTrimmed}',{Source Post URL}='${safeWithSlash}'),OR({Source Type}='Instagram',{Source Type}=BLANK()))`,
      fields: ['Source Handle', 'Carousel Index', 'Source Type'],
    })
    if (!slides.length) {
      console.warn(`[carousel-projects] No slides for URL: ${sourcePostUrl} (tried ${safeTrimmed} and ${safeWithSlash})`)
      return NextResponse.json({
        error: `No scraped slides found for "${sourcePostUrl}". Check Airtable Photos table — slides may need Source Type set to Instagram.`,
      }, { status: 404 })
    }
    const sourceHandle = slides[0].fields?.['Source Handle'] || ''
    const sourcePhotoIds = slides.map(s => s.id)

    // Project name: "@{handle} → {aka} · {date}". Date helps when the
    // same source gets re-projected later (e.g., redo after archiving).
    const date = new Date().toISOString().slice(0, 10)
    const projectName = `@${sourceHandle || 'source'} → ${aka} · ${date}`

    // Stamp uploader for audit.
    let createdBy = ''
    try { const { userId } = auth(); if (userId) createdBy = userId } catch {}

    const fields = {
      'Project Name': projectName,
      'Source Post URL': sourcePostUrl,
      'Source Handle': sourceHandle,
      'Source Photos': sourcePhotoIds,
      'Creator': [creatorId],
      'Status': 'Planning',
      'Created At': new Date().toISOString(),
    }
    if (createdBy) fields['Created By'] = createdBy
    if (notes) fields['Notes'] = String(notes).slice(0, 1000)

    const rec = await createAirtableRecord(TABLE, fields, { typecast: true })
    return NextResponse.json({
      ok: true,
      project: {
        id: rec.id,
        name: projectName,
        sourcePostUrl,
        sourceHandle,
        sourcePhotoCount: sourcePhotoIds.length,
        creatorId,
        creatorAka: aka,
        status: 'Planning',
      },
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[carousel-projects] POST error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// GET — list projects. Used by the Reference Library (✓ done badges for
// the selected creator) AND by the Carousel Upload section (in-progress
// project dropdown).
//   ?creatorId=X — required
//   ?status=Planning,Submitted (CSV) — optional filter; default = all
//   ?sourcePostUrl=X — optional, narrow to a specific source
//
// Returns: { projects: [{ id, name, sourcePostUrl, sourceHandle, status,
//                         submissionBatchId, sourcePhotoCount, uploadedPhotoCount,
//                         createdAt, submittedAt, reviewedAt }] }
export async function GET(request) {
  try {
    await requireAdminOrAiEditor()
    const url = new URL(request.url)
    const creatorId = url.searchParams.get('creatorId')
    if (!creatorId) return NextResponse.json({ error: 'creatorId required' }, { status: 400 })

    const statusCsv = url.searchParams.get('status') || ''
    const validStatuses = ['Planning', 'Submitted', 'Approved', 'Rejected', 'Archived']
    const wantedStatuses = statusCsv
      ? statusCsv.split(',').map(s => s.trim()).filter(s => validStatuses.includes(s))
      : null
    const sourcePostUrl = url.searchParams.get('sourcePostUrl') || ''

    // ARRAYJOIN on Creator returns the AKA text, not record IDs, so we
    // can't use FIND with the rec ID. Fetch by status (if any) + post URL
    // (if any) and filter client-side by creator. Same pattern the rest
    // of the codebase already uses for linked-record creator filters.
    const filters = []
    if (wantedStatuses?.length) {
      filters.push(`OR(${wantedStatuses.map(s => `{Status}='${s}'`).join(',')})`)
    }
    if (sourcePostUrl) {
      filters.push(`{Source Post URL}='${sourcePostUrl.replace(/'/g, "\\'")}'`)
    }
    const filterByFormula = filters.length
      ? (filters.length === 1 ? filters[0] : `AND(${filters.join(',')})`)
      : ''

    const rows = await fetchAirtableRecords(TABLE, {
      ...(filterByFormula ? { filterByFormula } : {}),
      fields: [
        'Project Name', 'Source Post URL', 'Source Handle', 'Source Photos',
        'Creator', 'Status', 'Submission Batch ID', 'Uploaded Photos',
        'Created By', 'Created At', 'Submitted At', 'Reviewed At', 'Notes',
      ],
    })

    const matched = rows.filter(r => (r.fields?.Creator || []).includes(creatorId))

    // Resolve source photo URLs in a single batched fetch so the Upload
    // section's Active Projects panel can render source thumbnails
    // inline (editor sees what they're recreating right next to where
    // they're uploading). Skips empty projects.
    const allSourceIds = [...new Set(matched.flatMap(r => r.fields?.['Source Photos'] || []))]
    let sourcePhotosById = {}
    if (allSourceIds.length) {
      const photos = await fetchAirtableRecords('Photos', {
        filterByFormula: `OR(${allSourceIds.map(id => `RECORD_ID()='${id}'`).join(',')})`,
        fields: ['Carousel Index', 'CDN URL', 'Image', 'Dropbox Link'],
      })
      sourcePhotosById = Object.fromEntries(photos.map(p => {
        const pf = p.fields || {}
        const cdn = pf['CDN URL'] || ''
        const att = (pf['Image'] || [])[0]
        const fallback = att?.thumbnails?.large?.url || att?.url || pf['Dropbox Link'] || ''
        return [p.id, {
          id: p.id,
          carouselIndex: pf['Carousel Index'] || 0,
          image: cdn || fallback,
          imageFallback: fallback,
        }]
      }))
    }

    const projects = matched
      .map(r => {
        const f = r.fields || {}
        const sourceIds = f['Source Photos'] || []
        const sourcePhotos = sourceIds
          .map(id => sourcePhotosById[id])
          .filter(Boolean)
          .sort((a, b) => (a.carouselIndex || 0) - (b.carouselIndex || 0))
        return {
          id: r.id,
          name: f['Project Name'] || '',
          sourcePostUrl: f['Source Post URL'] || '',
          sourceHandle: f['Source Handle'] || '',
          status: f['Status']?.name || f['Status'] || 'Planning',
          submissionBatchId: f['Submission Batch ID'] || '',
          sourcePhotoCount: sourceIds.length,
          sourcePhotos,
          uploadedPhotoCount: (f['Uploaded Photos'] || []).length,
          createdBy: f['Created By'] || '',
          createdAt: f['Created At'] || null,
          submittedAt: f['Submitted At'] || null,
          reviewedAt: f['Reviewed At'] || null,
          notes: f['Notes'] || '',
        }
      })
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))

    return NextResponse.json({ projects })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[carousel-projects] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH — update a project. Used by:
//   - the carousel-upload route to set Submission Batch ID + Uploaded Photos
//     when an editor links their submission to a project
//   - the carousel-submissions PATCH (admin approve/reject) to flip
//     Status to Approved/Rejected and stamp Reviewed At
//
// Body: { projectId, fields: { ... } }
// Allowed field updates (whitelist — anything else ignored):
//   Status, Submission Batch ID, Uploaded Photos, Submitted At, Reviewed At, Notes
export async function PATCH(request) {
  try {
    await requireAdminOrAiEditor()
    const { projectId, fields } = await request.json()
    if (!projectId || !/^rec[A-Za-z0-9]{14}$/.test(projectId)) {
      return NextResponse.json({ error: 'valid projectId required' }, { status: 400 })
    }
    if (!fields || typeof fields !== 'object') {
      return NextResponse.json({ error: 'fields object required' }, { status: 400 })
    }

    const ALLOWED = new Set([
      'Status', 'Submission Batch ID', 'Uploaded Photos',
      'Submitted At', 'Reviewed At', 'Notes',
    ])
    const patch = {}
    for (const [k, v] of Object.entries(fields)) {
      if (ALLOWED.has(k)) patch[k] = v
    }
    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: 'No allowed fields in patch' }, { status: 400 })
    }
    await patchAirtableRecord(TABLE, projectId, patch, { typecast: true })
    return NextResponse.json({ ok: true, projectId, updated: Object.keys(patch) })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[carousel-projects] PATCH error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
