import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { fetchAirtableRecords, airtableHeaders, OPS_BASE } from '@/lib/adminAuth'

const PALM_CREATORS_TABLE = 'tbls2so6pHGbU4Uhh'

// GET /api/creator/profile?creatorOpsId=recXXX
// Creator-accessible — returns their AI-generated profile (no admin required)
export async function GET(request) {
  try {
    const { userId } = auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const creatorOpsId = searchParams.get('creatorOpsId')
    if (!creatorOpsId) {
      return NextResponse.json({ error: 'creatorOpsId required' }, { status: 400 })
    }

    const res = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/${PALM_CREATORS_TABLE}/${creatorOpsId}`,
      { headers: airtableHeaders }
    )
    if (!res.ok) {
      return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
    }

    const data = await res.json()
    const f = data.fields || {}

    return NextResponse.json({
      profileSummary: f['Profile Summary'] || '',
      brandVoiceNotes: f['Brand Voice Notes'] || '',
      contentDirectionNotes: f['Content Direction Notes'] || '',
      dosDonts: f['Dos and Donts'] || '',
      profileAnalysisStatus: f['Profile Analysis Status'] || 'Not Started',
    })
  } catch (err) {
    console.error('Creator profile GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
