import { NextResponse } from 'next/server'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const BASE_ID = 'applLIT2t83plMqNx'
const INSPIRATION_TABLE = 'tblnQhATaMtpoYErb'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const creatorOpsId = searchParams.get('creatorOpsId')

    if (!creatorOpsId) {
      return NextResponse.json({ error: 'Missing creatorOpsId' }, { status: 400 })
    }

    // Fetch records where Saved By contains this creator
    const url = `https://api.airtable.com/v0/${BASE_ID}/${INSPIRATION_TABLE}?` + new URLSearchParams({
      filterByFormula: `FIND("${creatorOpsId}", ARRAYJOIN({Saved By}))`,
      'fields[]': ['Title', 'Thumbnail', 'Tags', 'Username', 'Views', 'Likes', 'Content link', 'Engagement Score', 'Notes', 'On-Screen Text', 'Film Format'],
    })

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
      cache: 'no-store',
    })

    if (!res.ok) {
      const err = await res.text()
      return NextResponse.json({ error: err }, { status: res.status })
    }

    const data = await res.json()
    const records = data.records.map((r) => {
      const thumb = r.fields['Thumbnail']
      return {
        id: r.id,
        title: r.fields['Title'] || 'Untitled',
        thumbnail: thumb && thumb.length > 0 ? thumb[0].url : null,
        tags: r.fields['Tags'] || [],
        username: r.fields['Username'] || '',
        views: r.fields['Views'] || 0,
        likes: r.fields['Likes'] || 0,
        contentLink: r.fields['Content link'] || '',
        engagementScore: r.fields['Engagement Score'] || 0,
        notes: r.fields['Notes'] || '',
        onScreenText: r.fields['On-Screen Text'] || '',
        filmFormat: r.fields['Film Format'] || [],
      }
    })

    return NextResponse.json({ records })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
