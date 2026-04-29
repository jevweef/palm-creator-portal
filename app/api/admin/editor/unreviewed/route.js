export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdminOrEditor, fetchAirtableRecords } from '@/lib/adminAuth'

// GET — fetch unreviewed library assets (clips dumped into 00_INCOMING_FILE_REQUEST)
// These are Assets with Source Type != 'Inspo Upload' and Pipeline Status = 'Uploaded'
export async function GET() {
  try {
    await requireAdminOrEditor()
  } catch (e) { return e }

  try {
    // Fetch assets that are NOT from the inspo upload flow — these come from
    // the Make automation that watches 00_INCOMING_FILE_REQUEST and moves to 10_UNREVIEWED_LIBRARY
    const assets = await fetchAirtableRecords('Assets', {
      filterByFormula: "AND(OR({Pipeline Status}='Uploaded', {Pipeline Status}=BLANK()), {Source Type}!='Inspo Upload')",
      fields: [
        'Asset Name', 'Pipeline Status', 'Source Type', 'Asset Type', 'Dropbox Shared Link',
        'Dropbox Path (Current)', 'Creator Notes', 'Thumbnail', 'CDN URL', 'Palm Creators',
        'Upload Week', 'Created Time',
      ],
    })

    if (!assets.length) {
      return NextResponse.json({ assets: [], total: 0 })
    }

    // Collect creator IDs
    const creatorIds = [...new Set(
      assets.flatMap(a => a.fields?.['Palm Creators'] || []).filter(Boolean)
    )]

    // Batch-fetch creator names
    let creatorMap = {}
    if (creatorIds.length) {
      const creatorRecords = await fetchAirtableRecords('Palm Creators', {
        filterByFormula: `OR(${creatorIds.map(id => `RECORD_ID()='${id}'`).join(',')})`,
        fields: ['Creator', 'AKA'],
      })
      creatorMap = Object.fromEntries(creatorRecords.map(r => [r.id, r.fields]))
    }

    const result = assets.map(a => {
      const f = a.fields || {}
      const creatorId = (f['Palm Creators'] || [])[0] || null
      const creator = creatorId ? (creatorMap[creatorId] || {}) : {}
      const dropboxLinks = (f['Dropbox Shared Link'] || '').split('\n').filter(Boolean)

      return {
        id: a.id,
        name: f['Asset Name'] || '',
        pipelineStatus: f['Pipeline Status'] || '',
        sourceType: f['Source Type'] || '',
        assetType: f['Asset Type'] || '',
        dropboxLink: dropboxLinks[0] || '',
        dropboxLinks,
        dropboxPath: f['Dropbox Path (Current)'] || '',
        creatorNotes: f['Creator Notes'] || '',
        thumbnail: f.Thumbnail?.[0]?.thumbnails?.large?.url || f.Thumbnail?.[0]?.url || '',
        cdnUrl: f['CDN URL'] || null,
        uploadWeek: f['Upload Week'] || '',
        createdTime: a.createdTime || '',
        creator: {
          id: creatorId,
          name: creator.AKA || creator.Creator || '',
        },
      }
    })

    // Sort newest first
    result.sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime))

    return NextResponse.json({ assets: result, total: result.length })
  } catch (err) {
    console.error('[Unreviewed] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
