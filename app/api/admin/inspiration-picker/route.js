import { NextResponse } from 'next/server'
import { requireAdminOrEditor, fetchAirtableRecords } from '@/lib/adminAuth'

const INSPIRATION_TABLE = 'tblnQhATaMtpoYErb'

export async function GET() {
  try {
    await requireAdminOrEditor()
  } catch (res) {
    return res
  }

  try {
    const records = await fetchAirtableRecords(INSPIRATION_TABLE, {
      filterByFormula: "{Status} = 'Complete'",
      fields: ['Title', 'Username', 'On-Screen Text', 'Thumbnail'],
      sort: [{ field: 'Views', direction: 'desc' }],
      maxRecords: 200,
    })

    const mapped = records
      .map(r => {
        const thumb = r.fields['Thumbnail']?.[0]?.url
        if (!thumb) return null
        return {
          id: r.id,
          title: r.fields['Title'] || 'Untitled',
          username: r.fields['Username'] || '',
          onScreenText: r.fields['On-Screen Text'] || '',
          thumbnail: thumb,
        }
      })
      .filter(Boolean)

    return NextResponse.json({ records: mapped })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
