import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const BASE_ID = 'applLIT2t83plMqNx'
const INSPIRATION_TABLE = 'tblnQhATaMtpoYErb'

export async function GET(request) {
  try {
    const { userId } = auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await currentUser()
    const role = user?.publicMetadata?.role
    const isAdmin = role === 'admin' || role === 'super_admin' || role === 'editor'

    const { searchParams } = new URL(request.url)
    const creatorOpsId = searchParams.get('creatorOpsId')

    if (!creatorOpsId) {
      return NextResponse.json({ error: 'Missing creatorOpsId' }, { status: 400 })
    }

    if (!isAdmin && user?.publicMetadata?.airtableOpsId !== creatorOpsId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch all complete records with Saved By field — filter in code since
    // ARRAYJOIN on linked records returns display names, not record IDs
    const allRecords = []
    let offset = null
    let pages = 0
    const MAX_PAGES = 50

    do {
      if (++pages > MAX_PAGES) {
        console.warn('[saved-inspo] Hit max pagination limit')
        break
      }
      const params = new URLSearchParams({
        filterByFormula: "{Status} = 'Complete'",
      })
      // Add fields individually (URLSearchParams doesn't handle arrays well)
      ;['Title', 'Thumbnail', 'Tags', 'Username', 'Views', 'Likes', 'Content link', 'Engagement Score', 'Notes', 'On-Screen Text', 'Film Format', 'Saved By'].forEach((f) => {
        params.append('fields[]', f)
      })
      if (offset) params.set('offset', offset)

      const res = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${INSPIRATION_TABLE}?${params}`,
        {
          headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
          cache: 'no-store',
        }
      )

      if (!res.ok) {
        const err = await res.text()
        return NextResponse.json({ error: err }, { status: res.status })
      }

      const data = await res.json()
      allRecords.push(...data.records)
      offset = data.offset || null
    } while (offset)

    // Filter to records where Saved By includes this creator's ops ID
    const saved = allRecords.filter((r) => {
      const savedBy = r.fields['Saved By'] || []
      return savedBy.some((entry) => {
        const id = typeof entry === 'string' ? entry : entry?.id || entry
        return id === creatorOpsId
      })
    })

    const records = saved.map((r) => {
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
