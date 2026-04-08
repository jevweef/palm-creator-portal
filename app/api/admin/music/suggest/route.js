export const maxDuration = 60

import { NextResponse } from 'next/server'
import { requireAdminOrEditor, fetchAirtableRecords } from '@/lib/adminAuth'
import { getRecommendations, searchTrack } from '@/lib/spotify'

// POST — get music suggestions based on inspo reel song + creator DNA
// Input: { inspoId, creatorId } or { seedQuery } for standalone search
export async function POST(request) {
  try { await requireAdminOrEditor() } catch (e) { return e }

  try {
    const { inspoId, creatorId, seedQuery } = await request.json()

    let seedTrackIds = []
    let identifiedSong = null

    // Mode 1: Task-based — use identified song + creator DNA
    if (inspoId) {
      // Fetch the identified song from the inspo record
      const inspoRecords = await fetchAirtableRecords('Inspiration', {
        filterByFormula: `RECORD_ID()='${inspoId}'`,
        fields: ['Identified Song', 'Identified Song Data'],
      })
      const inspoData = inspoRecords[0]?.fields?.['Identified Song Data']
      if (inspoData) {
        try {
          const parsed = JSON.parse(inspoData)
          if (parsed.spotifyId) {
            seedTrackIds.push(parsed.spotifyId)
            identifiedSong = parsed
          }
        } catch (e) {
          console.warn('[Music Suggest] Failed to parse song data:', e.message)
        }
      }
    }

    // Mode 2: Standalone search — use a text query as seed
    if (seedQuery && !seedTrackIds.length) {
      const results = await searchTrack(seedQuery)
      if (results.length) {
        seedTrackIds.push(results[0].spotifyId)
        identifiedSong = results[0]
      }
    }

    // Add creator DNA tracks as seeds (up to remaining slots, max 5 total)
    if (creatorId && seedTrackIds.length < 5) {
      try {
        const creatorRecords = await fetchAirtableRecords('Palm Creators', {
          filterByFormula: `RECORD_ID()='${creatorId}'`,
          fields: ['Music DNA Processed'],
        })
        const dnaRaw = creatorRecords[0]?.fields?.['Music DNA Processed']
        if (dnaRaw) {
          const dna = JSON.parse(dnaRaw)
          const dnaTracks = (dna.tracks || [])
            .filter(t => t.spotifyId)
            .slice(0, 5 - seedTrackIds.length)
          seedTrackIds.push(...dnaTracks.map(t => t.spotifyId))
        }
      } catch (e) {
        console.warn('[Music Suggest] Failed to load creator DNA:', e.message)
      }
    }

    if (!seedTrackIds.length) {
      return NextResponse.json({
        error: 'No seed tracks available. Identify the song first or add Music DNA to the creator profile.',
      }, { status: 400 })
    }

    console.log(`[Music Suggest] Getting recommendations with ${seedTrackIds.length} seed(s)...`)

    const suggestions = await getRecommendations(seedTrackIds, { limit: 20 })

    return NextResponse.json({
      ok: true,
      identifiedSong,
      suggestions,
      seedCount: seedTrackIds.length,
    })
  } catch (err) {
    console.error('[Music Suggest] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
