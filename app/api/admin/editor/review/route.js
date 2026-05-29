export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'

function recordIdFormula(ids) {
  if (!ids.length) return 'FALSE()'
  return `OR(${ids.map(id => `RECORD_ID() = ${quoteAirtableString(id)}`).join(',')})`
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
        fields: ['Asset Name', 'Pipeline Status', 'Dropbox Shared Link', 'Edited File Link', 'Thumbnail', 'CDN URL', 'Stream Edit ID', 'Stream Raw ID', 'Palm Creators', 'Source Type', 'Reference Source URL', 'Recreate Reels'],
      }) : [],
      creatorIds.length ? fetchAirtableRecords('Palm Creators', {
        filterByFormula: recordIdFormula(creatorIds),
        fields: ['Creator', 'AKA'],
      }) : [],
      inspoIds.length ? fetchAirtableRecords('Inspiration', {
        filterByFormula: recordIdFormula(inspoIds),
        fields: ['Title', 'Notes', 'Tags', 'Film Format', 'Content link', 'Thumbnail', 'CDN URL', 'Username', 'DB Share Link', 'Stream UID', 'On-Screen Text'],
      }) : [],
    ])

    const assetMap = Object.fromEntries(assetRecords.map(r => [r.id, r.fields]))
    const creatorMap = Object.fromEntries(creatorRecords.map(r => [r.id, r.fields]))
    const inspoMap = Object.fromEntries(inspoRecords.map(r => [r.id, r.fields]))

    // AI Generated assets don't link to an Inspiration record — they carry
    // their source reel two ways: (1) the `Recreate Reels` linked-record
    // field (record-ID link, set at upload time) and (2) historically a
    // `Reference Source URL` text match against the reel's `Reel URL`.
    //
    // The record-ID link is the RELIABLE join: editor-uploaded reels have an
    // EMPTY `Reel URL` (and the asset's `Reference Source URL` is empty too),
    // so the URL match silently returns nothing and the ORIGINAL side renders
    // blank — even though the linked reel has a perfectly good Stream UID +
    // Dropbox Video Link. We join by record ID first and keep the URL match
    // as a fallback for any legacy asset that only has the URL.
    const reelFields = ['Reel URL', 'Stream UID', 'Thumbnail', 'Dropbox Video Link']

    const aiReelIds = [...new Set(assetRecords
      .filter(r => r.fields?.['Source Type'] === 'AI Generated' && r.fields?.['Recreate Reels']?.length)
      .flatMap(r => r.fields['Recreate Reels']))]
    let reelByRecordId = {}
    if (aiReelIds.length) {
      const reelRecords = await fetchAirtableRecords('Recreate Reels', {
        filterByFormula: recordIdFormula(aiReelIds),
        fields: reelFields,
      })
      reelByRecordId = Object.fromEntries(reelRecords.map(r => [r.id, r.fields]))
    }

    // Fallback URL join — only for AI assets that have a Reference Source URL
    // but no usable record-ID link (older rows predating the link field).
    const aiUrls = [...new Set(assetRecords
      .filter(r => r.fields?.['Source Type'] === 'AI Generated'
        && r.fields?.['Reference Source URL']
        && !r.fields?.['Recreate Reels']?.length)
      .map(r => r.fields['Reference Source URL']))]
    let reelByUrl = {}
    if (aiUrls.length) {
      const escape = u => String(u).replace(/'/g, "\\'")
      const reelFormula = `OR(${aiUrls.map(u => `{Reel URL} = ${quoteAirtableString(escape(u))}`).join(',')})`
      const reelRecords = await fetchAirtableRecords('Recreate Reels', {
        filterByFormula: reelFormula,
        fields: reelFields,
      })
      reelByUrl = Object.fromEntries(reelRecords.map(r => [r.fields?.['Reel URL'], r.fields]))
    }

    // Shape a reel's raw fields into the sourceReel object the ORIGINAL cell
    // consumes. Stream UID drives in-card playback (CF Stream serves its own
    // poster); Dropbox Video Link is the fallback while Stream mirrors.
    const toSourceReel = (rf) => rf ? {
      streamUid: rf['Stream UID'] || null,
      thumbnail: rf.Thumbnail?.[0]?.thumbnails?.large?.url || rf.Thumbnail?.[0]?.url || null,
      dropboxVideoLink: rf['Dropbox Video Link'] || null,
    } : null

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
          streamEditId: asset['Stream Edit ID'] || null,
          streamRawId: asset['Stream Raw ID'] || null,
          sourceType: asset['Source Type'] || '',
          referenceSourceUrl: asset['Reference Source URL'] || '',
          // Populated for AI Generated assets so the ORIGINAL side renders the
          // source reel as a playable reference (not a text-only link). Prefer
          // the record-ID link (works for editor-uploaded reels with no URL),
          // fall back to the legacy URL match for older rows.
          sourceReel: asset['Source Type'] === 'AI Generated'
            ? (toSourceReel(reelByRecordId[asset['Recreate Reels']?.[0]])
               || toSourceReel(reelByUrl[asset['Reference Source URL']]))
            : null,
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
          streamUid: inspo['Stream UID'] || null,
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
