export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'

function recordIdFormula(ids) {
  if (!ids.length) return 'FALSE()'
  return `OR(${ids.map(id => `RECORD_ID()='${id}'`).join(',')})`
}

// GET — fetch tasks awaiting admin review (Done + Pending Review)
export async function GET() {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const tasks = await fetchAirtableRecords('Tasks', {
      filterByFormula: "AND({Status}='Done',{Admin Review Status}='Pending Review')",
      fields: [
        'Name', 'Status', 'Creator', 'Asset', 'Inspiration',
        'Creator Notes', 'Editor Notes', 'Completed At', 'Admin Review Status',
        'Revision History',
      ],
    })

    if (!tasks.length) return NextResponse.json({ tasks: [], total: 0 })

    const assetIds = [...new Set(tasks.flatMap(t => t.fields?.Asset || []))]
    const creatorIds = [...new Set(tasks.flatMap(t => t.fields?.Creator || []))]
    const inspoIds = [...new Set(tasks.flatMap(t => t.fields?.Inspiration || []))]

    const [assetRecords, creatorRecords, inspoRecords] = await Promise.all([
      assetIds.length ? fetchAirtableRecords('Assets', {
        filterByFormula: recordIdFormula(assetIds),
        fields: ['Asset Name', 'Pipeline Status', 'Dropbox Shared Link', 'Edited File Link', 'Thumbnail', 'CDN URL', 'Palm Creators'],
      }) : [],
      creatorIds.length ? fetchAirtableRecords('Palm Creators', {
        filterByFormula: recordIdFormula(creatorIds),
        fields: ['Creator', 'AKA'],
      }) : [],
      inspoIds.length ? fetchAirtableRecords('Inspiration', {
        filterByFormula: recordIdFormula(inspoIds),
        fields: ['Title', 'Notes', 'Tags', 'Film Format', 'Content link', 'Thumbnail', 'CDN URL', 'Username', 'DB Share Link', 'On-Screen Text'],
      }) : [],
    ])

    const assetMap = Object.fromEntries(assetRecords.map(r => [r.id, r.fields]))
    const creatorMap = Object.fromEntries(creatorRecords.map(r => [r.id, r.fields]))
    const inspoMap = Object.fromEntries(inspoRecords.map(r => [r.id, r.fields]))

    const result = tasks.map(t => {
      const f = t.fields || {}
      const assetId = (f.Asset || [])[0] || null
      const creatorId = (f.Creator || [])[0] || null
      const inspoId = (f.Inspiration || [])[0] || null
      const asset = assetId ? (assetMap[assetId] || {}) : {}
      const creator = creatorId ? (creatorMap[creatorId] || {}) : {}
      const inspo = inspoId ? (inspoMap[inspoId] || {}) : {}

      // Parse Revision History — JSON array of {date, feedback, screenshots}
      // entries, oldest first. Empty array if first submission. Keep most
      // recent last so the UI can render reverse-chronologically and have the
      // latest request on top.
      let revisionHistory = []
      const histRaw = (f['Revision History'] || '').trim()
      if (histRaw) {
        try { revisionHistory = JSON.parse(histRaw) } catch {}
      }

      return {
        id: t.id,
        name: f.Name || '',
        editorNotes: f['Editor Notes'] || '',
        creatorNotes: f['Creator Notes'] || '',
        completedAt: f['Completed At'] || null,
        revisionHistory,
        creator: { id: creatorId, name: creator.AKA || creator.Creator || '' },
        asset: {
          id: assetId,
          name: asset['Asset Name'] || '',
          editedFileLink: asset['Edited File Link'] || '',
          dropboxLink: asset['Dropbox Shared Link'] || '',
          thumbnail: asset.Thumbnail?.[0]?.thumbnails?.large?.url || asset.Thumbnail?.[0]?.url || '',
          cdnUrl: asset['CDN URL'] || null,
        },
        inspo: {
          id: inspoId,
          title: inspo.Title || '',
          notes: inspo.Notes || '',
          tags: inspo.Tags || [],
          contentLink: inspo['Content link'] || '',
          thumbnail: inspo.Thumbnail?.[0]?.thumbnails?.large?.url || inspo.Thumbnail?.[0]?.url || '',
          cdnUrl: inspo['CDN URL'] || null,
          username: inspo.Username || '',
          onScreenText: inspo['On-Screen Text'] || '',
          dbShareLink: inspo['DB Share Link'] || '',
        },
      }
    })

    // Sort newest first
    result.sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0))

    return NextResponse.json({ tasks: result, total: result.length })
  } catch (err) {
    console.error('[Review] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
