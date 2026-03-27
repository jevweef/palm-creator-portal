import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord, batchCreateRecords } from '@/lib/adminAuth'

const SHORTCODE_RE = /instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/

function extractShortcode(url) {
  const m = url?.match(SHORTCODE_RE)
  return m ? m[1] : null
}

// GET — fetch review queue from Source Reels + palm creators + existing source handles
export async function GET(request) {
  try {
    await requireAdmin()
  } catch (e) { return e }

  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')

    // Sub-routes for creators and sources (unchanged)
    if (action === 'creators') {
      const records = await fetchAirtableRecords('Palm Creators', {
        fields: ['Creator', 'AKA'],
        filterByFormula: "OR({Status}='Active',{Status}='Onboarding')",
        sort: [{ field: 'Creator', direction: 'asc' }],
      })
      const creators = records
        .map(r => ({ id: r.id, name: (r.fields.AKA || r.fields.Creator || '').trim() }))
        .filter(c => c.name)
      return NextResponse.json({ creators })
    }

    if (action === 'sources') {
      const records = await fetchAirtableRecords('Inspo Sources', { fields: ['Handle'] })
      const handles = records
        .map(r => (r.fields.Handle || '').trim().replace(/^@/, '').toLowerCase())
        .filter(Boolean)
      return NextResponse.json({ handles })
    }

    // Default: fetch review queue from Source Reels
    // Manual/IG Export reels that haven't been promoted to Inspiration yet
    const records = await fetchAirtableRecords('Source Reels', {
      filterByFormula: "AND(OR({Data Source}='Manual',{Data Source}='IG Export'),OR({Review Status}='Pending Review',{Review Status}=BLANK()),NOT({Imported to Inspiration}='Yes'))",
      fields: [
        'Reel URL', 'Source Handle', 'Username', 'Caption',
        'Views', 'Likes', 'Comments', 'Shares', 'Grade',
        'Data Source', 'Review Status', 'Rating', 'For Creator',
        'Reviewer Notes', 'Follower Count', 'Date Saved', 'Posted At',
      ],
      sort: [{ field: 'Date Saved', direction: 'desc' }],
    })

    const queue = records.map(r => ({
      id: r.id,
      url: r.fields['Reel URL'] || '',
      username: r.fields.Username || r.fields['Source Handle'] || '',
      caption: r.fields.Caption || '',
      views: r.fields.Views || null,
      likes: r.fields.Likes || null,
      comments: r.fields.Comments || null,
      shares: r.fields.Shares || null,
      grade: r.fields.Grade || null,
      dataSource: r.fields['Data Source'] || '',
      reviewStatus: r.fields['Review Status'] || '',
      rating: r.fields.Rating || null,
      forCreator: r.fields['For Creator'] || [],
      reviewerNotes: r.fields['Reviewer Notes'] || '',
      followerCount: r.fields['Follower Count'] || null,
      dateSaved: r.fields['Date Saved'] || null,
      postedAt: r.fields['Posted At'] || null,
    }))

    return NextResponse.json({ queue, total: queue.length })
  } catch (err) {
    console.error('[review] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH — approve: promote Source Reel → Inspiration record
export async function PATCH(request) {
  try {
    await requireAdmin()
  } catch (e) { return e }

  try {
    const { recordId, rating, creatorIds, reviewerNotes } = await request.json()
    if (!recordId) return NextResponse.json({ error: 'Missing recordId' }, { status: 400 })

    // 1. Read full Source Reel record
    const srRecords = await fetchAirtableRecords('Source Reels', {
      filterByFormula: `RECORD_ID()='${recordId}'`,
    })
    if (!srRecords.length) return NextResponse.json({ error: 'Record not found' }, { status: 404 })

    const sr = srRecords[0].fields
    const sc = extractShortcode(sr['Reel URL'])

    // 2. Create Inspiration record
    const inspoFields = {
      'Content link': sc ? `https://www.instagram.com/reel/${sc}/` : sr['Reel URL'],
      'Username': sr.Username || sr['Source Handle'] || '',
      'Status': 'Ready for Analysis',
      'Ingestion Source': sr['Data Source'] || 'Manual',
      'Data Source': sr['Data Source'] || 'Manual',
    }

    // Engagement fields
    if (sr.Views != null) inspoFields['Views'] = sr.Views
    if (sr.Likes != null) inspoFields['Likes'] = sr.Likes
    if (sr.Comments != null) inspoFields['Comments'] = sr.Comments
    if (sr.Shares != null) inspoFields['Shares'] = sr.Shares
    if (sr['Duration Seconds'] != null) inspoFields['Duration'] = sr['Duration Seconds']
    if (sr['Audio Type']) inspoFields['Audio Type'] = sr['Audio Type']
    if (sr['Follower Count'] != null) inspoFields['Follower Count'] = sr['Follower Count']
    if (sr.Caption) inspoFields['Captions'] = sr.Caption
    if (sr.Transcript) inspoFields['Transcript'] = sr.Transcript
    if (sr['Z Score'] != null) inspoFields['Z Score'] = sr['Z Score']
    if (sr.Grade) inspoFields['Grade'] = sr.Grade
    if (sr['Normalized Score'] != null) inspoFields['Normalized Score'] = sr['Normalized Score']

    // Date: prioritize Posted At, fall back to Date Saved
    const dateForInspo = sr['Posted At'] || sr['Date Saved']
    if (dateForInspo) inspoFields['Creator Posted Date'] = dateForInspo

    // Review data
    if (rating != null) inspoFields['Rating'] = rating
    if (creatorIds?.length) inspoFields['For Creator'] = creatorIds  // plain string array
    if (reviewerNotes) inspoFields['Reviewer Notes'] = reviewerNotes

    // Calculate engagement score if we have views
    if (sr.Views && sr.Views > 0) {
      const likes = Math.max(sr.Likes || 0, 0)
      const comments = sr.Comments || 0
      const shares = sr.Shares || 0
      const score = ((likes * 1 + comments * 3 + shares * 5) / sr.Views) * Math.log10(sr.Views)
      inspoFields['Engagement Score'] = Math.round(score * 1000000) / 1000000
    }

    // Normalized score
    if (sr.Views && sr['Follower Count'] && sr['Follower Count'] > 0) {
      inspoFields['Normalized Score'] = Math.round((sr.Views / sr['Follower Count']) * 1000000) / 1000000
    }

    const created = await batchCreateRecords('Inspiration', [{ fields: inspoFields }])
    const inspoRecordId = created[0]?.id

    // 3. Mark Source Reel as imported
    const srUpdateFields = {
      'Imported to Inspiration': 'Yes',
      'Review Status': 'Approved',
    }
    if (rating != null) srUpdateFields['Rating'] = rating
    if (creatorIds?.length) srUpdateFields['For Creator'] = creatorIds
    if (reviewerNotes) srUpdateFields['Reviewer Notes'] = reviewerNotes

    await patchAirtableRecord('Source Reels', recordId, srUpdateFields)

    return NextResponse.json({ ok: true, inspoRecordId })
  } catch (err) {
    console.error('[review] PATCH error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE — soft delete: mark as Rejected (don't actually delete)
export async function DELETE(request) {
  try {
    await requireAdmin()
  } catch (e) { return e }

  try {
    const { recordId } = await request.json()
    if (!recordId) return NextResponse.json({ error: 'Missing recordId' }, { status: 400 })

    await patchAirtableRecord('Source Reels', recordId, {
      'Review Status': 'Rejected',
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[review] DELETE error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
