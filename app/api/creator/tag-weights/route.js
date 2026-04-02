import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { fetchAirtableRecords } from '@/lib/adminAuth'

// GET /api/creator/tag-weights?creatorOpsId=recXXX
// Returns tag weights for a creator. Accessible by the creator themselves or admin.
export async function GET(request) {
  try {
    const { userId } = auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const creatorOpsId = searchParams.get('creatorOpsId')
    if (!creatorOpsId) {
      return NextResponse.json({ tagWeights: {} })
    }

    const records = await fetchAirtableRecords('Creator Tag Weights', {
      filterByFormula: `FIND("${creatorOpsId}", ARRAYJOIN({Creator}))`,
    })

    // Return as a plain { tag: weight } map for easy lookup
    const tagWeights = {}
    records.forEach(r => {
      const tag = r.fields['Tag']
      const weight = r.fields['Weight'] ?? 0
      if (tag) tagWeights[tag] = weight
    })

    return NextResponse.json({ tagWeights })
  } catch (err) {
    console.error('Tag weights GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
