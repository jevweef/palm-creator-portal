import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { fetchAirtableRecords } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const BASE_ID = 'applLIT2t83plMqNx'
const PALM_CREATORS_TABLE = 'tbls2so6pHGbU4Uhh'

async function fetchCreatorPersonalCache(creatorOpsId) {
  // Cached on the Palm Creators record by /api/inspo-rate. Soft-fail — if
  // any of these fields are missing or unparseable, return empties so the
  // page still functions without personalization.
  try {
    const r = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${PALM_CREATORS_TABLE}/${creatorOpsId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' },
    )
    if (!r.ok) return { tagBumps: {}, hasCentroidUp: false, hasCentroidDown: false }
    const f = (await r.json()).fields || {}
    let tagBumps = {}
    try {
      tagBumps = JSON.parse(f['Inspo Tag Bumps'] || '{}')
    } catch {}
    return {
      tagBumps,
      hasCentroidUp: !!(f['Inspo Centroid Up'] && f['Inspo Centroid Up'].length > 100),
      hasCentroidDown: !!(f['Inspo Centroid Down'] && f['Inspo Centroid Down'].length > 100),
    }
  } catch {
    return { tagBumps: {}, hasCentroidUp: false, hasCentroidDown: false }
  }
}

// GET /api/creator/tag-weights?creatorOpsId=recXXX
// Returns tag weights for a creator. Accessible by the creator themselves or admin.
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
      return NextResponse.json({ tagWeights: {} })
    }

    if (!isAdmin && user?.publicMetadata?.airtableOpsId !== creatorOpsId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch all and filter in JS — filterByFormula on linked record fields
    // matches by primary field value (name), not record ID
    const allRecords = await fetchAirtableRecords('Creator Tag Weights', {})
    const records = allRecords.filter(r =>
      (r.fields['Creator'] || []).some(c => (c.id || c) === creatorOpsId)
    )

    // Return as { tag: weight } map + separate film format weights + full list with categories
    const tagWeights = {}
    const filmFormatWeights = {}
    const allTags = []
    records.forEach(r => {
      const tag = r.fields['Tag']
      const weight = r.fields['Weight'] ?? 0
      const category = r.fields['Tag Category'] || 'Other'
      if (!tag) return
      allTags.push({ tag, weight, category })
      if (category === 'Film Format') {
        filmFormatWeights[tag] = weight
      } else {
        tagWeights[tag] = weight
      }
    })

    // Personalized layer — thumbs-up / thumbs-down derived tag bumps
    const personal = await fetchCreatorPersonalCache(creatorOpsId)

    return NextResponse.json({
      tagWeights,
      filmFormatWeights,
      allTags,
      tagBumps: personal.tagBumps,
      hasCentroidUp: personal.hasCentroidUp,
      hasCentroidDown: personal.hasCentroidDown,
    })
  } catch (err) {
    console.error('Tag weights GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
