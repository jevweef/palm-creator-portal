export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdminOrEditor, fetchAirtableRecords, batchUpdateRecords } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'

// GET — fetch unreviewed library assets (clips dumped into 00_INCOMING_FILE_REQUEST)
// These are Assets with Source Type != 'Inspo Upload' and Pipeline Status = 'Uploaded'
export async function GET() {
  try {
    await requireAdminOrEditor()
  } catch (e) { return e }

  try {
    // Fetch assets that are NOT from the inspo upload flow — these come from
    // the Make automation that watches 00_INCOMING_FILE_REQUEST and moves to 10_UNREVIEWED_LIBRARY
    // Includes 'In Editing' (additive) so the library can offer an Unused vs
    // In-editing status filter; the client defaults to Unused, preserving the
    // original "only unused" view.
    // 'Discarded' is additive so the library can offer a "Deleted" filter +
    // restore. The client defaults to Unused, so discarded assets stay hidden
    // unless the admin explicitly switches to the Deleted view.
    const assets = await fetchAirtableRecords('Assets', {
      filterByFormula: "AND(OR({Pipeline Status}='Uploaded', {Pipeline Status}=BLANK(), {Pipeline Status}='In Editing', {Pipeline Status}='Discarded'), {Source Type}!='Inspo Upload')",
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
        filterByFormula: `OR(${creatorIds.map(id => `RECORD_ID() = ${quoteAirtableString(id)}`).join(',')})`,
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
        // Derived lifecycle status for the library filter (Used/Posted deferred).
        status: f['Pipeline Status'] === 'In Editing' ? 'In editing'
          : f['Pipeline Status'] === 'Discarded' ? 'Discarded'
          : 'Unused',
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

// POST — soft-delete (hide) or restore library assets in bulk.
// Body: { assetIds: string[], action?: 'discard' | 'restore' }
//   action 'discard' (default) → Pipeline Status = 'Discarded' (the canonical
//     hidden state, already excluded from every library/picker query). The
//     Dropbox file + Cloudflare CDN copy are untouched, so this is reversible
//     and never breaks linked Posts — they just stop surfacing in the library.
//   action 'restore' → Pipeline Status = 'Uploaded' (back into the Unused view).
// Supports single (one ID) and bulk (many IDs) from the same call.
export async function POST(request) {
  try {
    await requireAdminOrEditor()
  } catch (e) { return e }

  try {
    const { assetIds, action } = await request.json()
    if (!Array.isArray(assetIds) || assetIds.length === 0) {
      return NextResponse.json({ error: 'assetIds (non-empty array) required' }, { status: 400 })
    }
    if (assetIds.length > 200) {
      return NextResponse.json({ error: 'Too many assets in one request (max 200)' }, { status: 400 })
    }
    const ids = [...new Set(assetIds.filter(id => typeof id === 'string' && /^rec[A-Za-z0-9]{14}$/.test(id)))]
    if (!ids.length) {
      return NextResponse.json({ error: 'No valid asset IDs' }, { status: 400 })
    }

    const status = action === 'restore' ? 'Uploaded' : 'Discarded'
    const updates = ids.map(id => ({ id, fields: { 'Pipeline Status': status } }))
    await batchUpdateRecords('Assets', updates)

    console.log(`[Unreviewed] ${action === 'restore' ? 'Restored' : 'Soft-deleted'} ${ids.length} asset(s) → ${status}`)
    return NextResponse.json({ ok: true, updated: ids.length, status })
  } catch (err) {
    console.error('[Unreviewed] POST error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
