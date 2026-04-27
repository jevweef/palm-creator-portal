export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'

// Submission feed for the admin Editor view.
// Each entry = "an editor pressed submit at this moment in time" — one per Task
// (since we only persist the latest Completed At). For each task we infer
// whether the LATEST submission was an Initial review submission or a
// Revision based on whether Admin Feedback exists on the task:
//   - Admin Feedback empty → no revision was ever requested → latest submit
//     is the Initial submission.
//   - Admin Feedback set    → admin already requested a revision at some
//     point → latest submit is a Revision (either resubmitting the revision,
//     or sitting in Needs Revision state with the prior submission being the
//     one that got bounced).
//
// Sorted by submittedAt desc so the freshest activity is at the top. The
// admin UI groups by ET date.

export async function GET() {
  try { await requireAdmin() } catch (e) { return e }

  try {
    // Pull only tasks that have been submitted at least once.
    const tasks = await fetchAirtableRecords('Tasks', {
      filterByFormula: `NOT({Completed At}='')`,
      fields: [
        'Name', 'Status', 'Creator', 'Asset', 'Inspiration',
        'Completed At', 'Started At',
        'Admin Review Status', 'Admin Feedback',
        'Editor Notes',
        'Submitted By ID', 'Submitted By Name', 'Submitted By Avatar',
      ],
    })

    // Bulk-fetch linked records so we can render context without per-row roundtrips
    const creatorIds = [...new Set(tasks.flatMap(t => t.fields?.Creator || []))]
    const assetIds = [...new Set(tasks.flatMap(t => t.fields?.Asset || []))]
    const inspoIds = [...new Set(tasks.flatMap(t => t.fields?.Inspiration || []))]

    const recordIdFormula = ids => ids.length
      ? `OR(${ids.map(id => `RECORD_ID()='${id}'`).join(',')})`
      : 'FALSE()'
    const fetchByIds = async (table, ids, fields) => {
      if (!ids.length) return []
      const CHUNK = 30
      const out = []
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK)
        const recs = await fetchAirtableRecords(table, { filterByFormula: recordIdFormula(slice), fields })
        out.push(...recs)
      }
      return out
    }

    const [creators, assets, inspos] = await Promise.all([
      fetchByIds('Palm Creators', creatorIds, ['Creator', 'AKA']),
      fetchByIds('Assets', assetIds, ['Asset Name', 'Edited File Link', 'Dropbox Shared Link', 'Thumbnail']),
      fetchByIds('Inspiration', inspoIds, ['Title', 'Thumbnail']),
    ])

    const creatorMap = Object.fromEntries(creators.map(r => [r.id, r.fields]))
    const assetMap = Object.fromEntries(assets.map(r => [r.id, r.fields]))
    const inspoMap = Object.fromEntries(inspos.map(r => [r.id, r.fields]))

    const submissions = tasks
      .map(t => {
        const f = t.fields || {}
        const submittedAt = f['Completed At'] || null
        if (!submittedAt) return null
        const creatorId = (f.Creator || [])[0] || null
        const assetId = (f.Asset || [])[0] || null
        const inspoId = (f.Inspiration || [])[0] || null
        const creator = creatorId ? creatorMap[creatorId] : null
        const asset = assetId ? assetMap[assetId] : null
        const inspo = inspoId ? inspoMap[inspoId] : null
        const adminFeedback = (f['Admin Feedback'] || '').trim()
        const reviewStatus = f['Admin Review Status'] || ''
        // Inference rule above. Treat "no feedback yet" as Initial.
        const type = adminFeedback ? 'Revision' : 'Initial'
        return {
          id: t.id,
          taskName: f.Name || '',
          submittedAt,
          startedAt: f['Started At'] || null,
          type,
          adminReviewStatus: reviewStatus,
          adminFeedback,
          editorNotes: f['Editor Notes'] || '',
          creator: creatorId ? { id: creatorId, name: creator?.AKA || creator?.Creator || '' } : null,
          asset: assetId ? {
            id: assetId,
            name: asset?.['Asset Name'] || '',
            editedFileLink: asset?.['Edited File Link'] || '',
            dropboxLink: asset?.['Dropbox Shared Link'] || '',
            thumbnail: asset?.Thumbnail?.[0]?.thumbnails?.large?.url || asset?.Thumbnail?.[0]?.url || '',
          } : null,
          inspo: inspoId ? {
            id: inspoId,
            title: inspo?.Title || '',
            thumbnail: inspo?.Thumbnail?.[0]?.thumbnails?.large?.url || inspo?.Thumbnail?.[0]?.url || '',
          } : null,
        }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))

    return NextResponse.json({ submissions })
  } catch (err) {
    console.error('[Editor Submissions] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
