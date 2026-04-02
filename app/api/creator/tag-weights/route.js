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

    // Fetch all and filter in JS — filterByFormula on linked record fields
    // matches by primary field value (name), not record ID
    const allRecords = await fetchAirtableRecords('Creator Tag Weights', {})
    const records = allRecords.filter(r =>
      (r.fields['Creator'] || []).some(c => (c.id || c) === creatorOpsId)
    )

    // Return as { tag: weight } map + separate film format weights
    const tagWeights = {}
    const filmFormatWeights = {}
    records.forEach(r => {
      const tag = r.fields['Tag']
      const weight = r.fields['Weight'] ?? 0
      const category = r.fields['Tag Category'] || ''
      if (!tag) return
      if (category === 'Film Format') {
        filmFormatWeights[tag] = weight
      } else {
        tagWeights[tag] = weight
      }
    })

    return NextResponse.json({ tagWeights, filmFormatWeights })
  } catch (err) {
    console.error('Tag weights GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
