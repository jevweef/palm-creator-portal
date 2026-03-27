import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'

const BASE_ID = 'applLIT2t83plMqNx'
const INSPIRATION_TABLE = 'tblnQhATaMtpoYErb'
const CREATORS_TABLE = 'tbls2so6pHGbU4Uhh'
const SOURCES_TABLE = 'tblH0K1xMsBonqmMx'

// GET — fetch review queue + palm creators + existing source handles
export async function GET(request) {
  try {
    await requireAdmin()
  } catch (e) { return e }

  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')

    // Fetch Palm Creators for pill assignment
    if (action === 'creators') {
      const records = await fetchAirtableRecords(BASE_ID, CREATORS_TABLE, {
        fields: ['Creator', 'AKA'],
        filterByFormula: "OR({Status}='Active',{Status}='Onboarding')",
        sort: [{ field: 'Creator', direction: 'asc' }],
      })
      const creators = records
        .map(r => ({
          id: r.id,
          name: (r.fields.AKA || r.fields.Creator || '').trim(),
        }))
        .filter(c => c.name)
      return NextResponse.json({ creators })
    }

    // Fetch existing source handles
    if (action === 'sources') {
      const records = await fetchAirtableRecords(BASE_ID, SOURCES_TABLE, {
        fields: ['Handle'],
      })
      const handles = records
        .map(r => (r.fields.Handle || '').trim().replace(/^@/, '').toLowerCase())
        .filter(Boolean)
      return NextResponse.json({ handles })
    }

    // Default: fetch review queue from "Manually Added/Unreviewed" view
    const records = await fetchAirtableRecords(BASE_ID, INSPIRATION_TABLE, {
      view: 'Manually Added/Unreviewed',
      fields: [
        'Title', 'Content link', 'Username', 'Captions',
        'Tags', 'Film Format', 'For Creator', 'Rating',
        'DB Embed Code', 'DB Raw = 1', 'Thumbnail',
        'Views', 'Likes', 'Comments', 'Grade',
      ],
    })

    const queue = records.map(r => ({
      id: r.id,
      title: r.fields.Title || '',
      url: r.fields['Content link'] || '',
      username: r.fields.Username || '',
      caption: r.fields.Captions || '',
      tags: r.fields.Tags || [],
      filmFormat: r.fields['Film Format'] || [],
      forCreator: r.fields['For Creator'] || [],
      rating: r.fields.Rating || null,
      embedCode: r.fields['DB Embed Code'] || '',
      dbRaw: r.fields['DB Raw = 1'] || 0,
      thumbnail: r.fields.Thumbnail?.[0]?.url || null,
      views: r.fields.Views || null,
      likes: r.fields.Likes || null,
      comments: r.fields.Comments || null,
      grade: r.fields.Grade || null,
    }))

    return NextResponse.json({ queue, total: queue.length })
  } catch (err) {
    console.error('[review] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH — approve record (rating + creators + notes + status)
export async function PATCH(request) {
  try {
    await requireAdmin()
  } catch (e) { return e }

  try {
    const { recordId, rating, creatorIds, reviewerNotes, statusOnly } = await request.json()
    if (!recordId) return NextResponse.json({ error: 'Missing recordId' }, { status: 400 })

    const fields = {}

    if (!statusOnly) {
      fields['Status'] = 'Ready for Analysis'
    }
    if (rating != null) fields['Rating'] = rating
    if (creatorIds?.length) fields['For Creator'] = creatorIds
    if (reviewerNotes) fields['Reviewer Notes'] = reviewerNotes

    await patchAirtableRecord(BASE_ID, INSPIRATION_TABLE, recordId, fields)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[review] PATCH error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE — delete a record from the queue
export async function DELETE(request) {
  try {
    await requireAdmin()
  } catch (e) { return e }

  try {
    const { recordId } = await request.json()
    if (!recordId) return NextResponse.json({ error: 'Missing recordId' }, { status: 400 })

    const res = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${INSPIRATION_TABLE}/${recordId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` },
      }
    )
    if (!res.ok) throw new Error(`Airtable ${res.status}`)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[review] DELETE error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
