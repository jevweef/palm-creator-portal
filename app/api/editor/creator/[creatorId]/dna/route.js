export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdminOrEditor, fetchAirtableRecords } from '@/lib/adminAuth'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'

export async function GET(request, { params }) {
  try { await requireAdminOrEditor() } catch (e) { return e }

  const { creatorId } = params
  if (!creatorId || !/^rec[A-Za-z0-9]{14}$/.test(creatorId)) {
    return NextResponse.json({ error: 'Invalid creator ID' }, { status: 400 })
  }

  try {
    // Fetch creator profile + tag weights in parallel
    const [creatorRes, tagWeights] = await Promise.all([
      fetch(`https://api.airtable.com/v0/${OPS_BASE}/tbls2so6pHGbU4Uhh/${creatorId}`, {
        headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
        cache: 'no-store',
      }),
      fetchAirtableRecords('Creator Tag Weights', {
        filterByFormula: `AND({Weight}>0, FIND('${creatorId}', ARRAYJOIN({Creator})))`,
        fields: ['Tag', 'Weight', 'Tag Category', 'Creator'],
      }),
    ])

    if (!creatorRes.ok) {
      return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
    }

    const creator = await creatorRes.json()
    const f = creator.fields || {}

    // Build top tags sorted by weight
    const topTags = tagWeights
      .filter(tw => (tw.fields?.Creator || []).includes(creatorId))
      .map(tw => ({
        tag: tw.fields?.Tag || '',
        weight: tw.fields?.Weight || 0,
        category: tw.fields?.['Tag Category'] || '',
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 8)

    return NextResponse.json({
      profileSummary: f['Profile Summary'] || '',
      brandVoiceNotes: f['Brand Voice Notes'] || '',
      contentDirectionNotes: f['Content Direction Notes'] || '',
      dosDonts: f['Dos and Donts'] || '',
      topTags,
    })
  } catch (err) {
    console.error('[Creator DNA] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
