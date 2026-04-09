import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'

const INSPIRATION_TABLE = 'tblnQhATaMtpoYErb'

export async function GET() {
  try {
    await requireAdmin()
  } catch (res) {
    return res
  }

  try {
    const records = await fetchAirtableRecords(INSPIRATION_TABLE, {
      filterByFormula: "AND({Status} = 'Complete', {On-Screen Text} != '', NOT({Text Training Reviewed}))",
      fields: [
        'Title',
        'On-Screen Text',
        'Tags',
        'Suggested Tags',
        'Film Format',
        'Notes',
        'Thumbnail',
        'DB Share Link',
        'DB Raw = 1',
        'DB Embed Code',
        'Username',
        'Views',
        'Likes',
        'Comments',
      ],
      sort: [{ field: 'Views', direction: 'desc' }],
    })

    const mapped = records.map(r => ({
      id: r.id,
      title: r.fields['Title'] || 'Untitled',
      onScreenText: r.fields['On-Screen Text'] || '',
      tags: r.fields['Tags'] || [],
      suggestedTags: r.fields['Suggested Tags'] || [],
      filmFormat: r.fields['Film Format'] || [],
      notes: r.fields['Notes'] || '',
      thumbnail: r.fields['Thumbnail']?.[0]?.url || null,
      dbShareLink: r.fields['DB Share Link'] || '',
      dbRawLink: r.fields['DB Raw = 1'] || '',
      dbEmbedCode: r.fields['DB Embed Code'] || '',
      username: r.fields['Username'] || '',
      views: r.fields['Views'] || 0,
      likes: r.fields['Likes'] || 0,
      comments: r.fields['Comments'] || 0,
    }))

    return NextResponse.json({ records: mapped, total: mapped.length })
  } catch (err) {
    console.error('[Text Training] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PATCH(request) {
  try {
    await requireAdmin()
  } catch (res) {
    return res
  }

  try {
    const { recordId, approved, mode } = await request.json()

    if (!recordId) {
      return NextResponse.json({ error: 'recordId required' }, { status: 400 })
    }

    const fields = { 'Text Training Reviewed': true }

    if (approved) {
      fields['Text Training Approved'] = true
      if (mode) {
        fields['Text Training Mode'] = mode
      }
    }
    // Denied: reviewed = true, approved stays unchecked, no mode

    await patchAirtableRecord(INSPIRATION_TABLE, recordId, fields)

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[Text Training] PATCH error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
