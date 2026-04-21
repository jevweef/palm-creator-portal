export const maxDuration = 60

import { NextResponse } from 'next/server'
import { requireAdminOrEditor, fetchAirtableRecords } from '@/lib/adminAuth'
import { findSimilarMusic, searchTrack } from '@/lib/spotify'

// POST — get music suggestions based on inspo reel song + creator DNA
// Uses search-based discovery (Spotify deprecated /recommendations for new apps)
export async function POST(request) {
  try { await requireAdminOrEditor() } catch (e) { return e }

  try {
    const { inspoId, creatorId, seedQuery } = await request.json()

    let seedTracks = []
    let identifiedSong = null

    // Mode 1: Task-based — use identified song from the inspo reel
    if (inspoId) {
      const inspoRecords = await fetchAirtableRecords('Inspiration', {
        filterByFormula: `RECORD_ID()='${inspoId}'`,
        fields: ['Identified Song', 'Identified Song Data'],
      })
      const inspoData = inspoRecords[0]?.fields?.['Identified Song Data']
      if (inspoData) {
        try {
          const parsed = JSON.parse(inspoData)
          identifiedSong = parsed
          seedTracks.push({
            track: parsed.title,
            artist: parsed.artist,
            spotifyId: parsed.spotifyId,
            genres: [],
          })
        } catch (e) {
          console.warn('[Music Suggest] Failed to parse song data:', e.message)
        }
      }
    }

    // Mode 2: Standalone search — use a text query as seed
    if (seedQuery && !seedTracks.length) {
      const results = await searchTrack(seedQuery)
      if (results.length) {
        identifiedSong = results[0]
        seedTracks.push({
          track: results[0].track,
          artist: results[0].artist,
          spotifyId: results[0].spotifyId,
          genres: [],
        })
      }
    }

    // Add creator DNA tracks as seeds
    if (creatorId) {
      try {
        const creatorRecords = await fetchAirtableRecords('Palm Creators', {
          filterByFormula: `RECORD_ID()='${creatorId}'`,
          fields: ['Music DNA Processed'],
        })
        const dnaRaw = creatorRecords[0]?.fields?.['Music DNA Processed']
        if (dnaRaw) {
          const dna = JSON.parse(dnaRaw)
          // Shuffle DNA tracks so each refresh uses different seeds
          const shuffledDna = [...(dna.tracks || [])].sort(() => Math.random() - 0.5)
          const dnaTracks = shuffledDna.slice(0, 20)
          for (const t of dnaTracks) {
            seedTracks.push({
              track: t.track,
              artist: t.artist,
              spotifyId: t.spotifyId,
              genres: t.genres || [],
            })
          }
          // Also add top genres from DNA
          if (dna.topGenres?.length) {
            seedTracks.push({ track: '', artist: '', spotifyId: null, genres: dna.topGenres.slice(0, 8) })
          }
        }
      } catch (e) {
        console.warn('[Music Suggest] Failed to load creator DNA:', e.message)
      }
    }

    if (!seedTracks.length) {
      return NextResponse.json({
        error: 'No seed tracks available. Identify the song first or add Music DNA to the creator profile.',
      }, { status: 400 })
    }

    const artists = [...new Set(seedTracks.map(t => t.artist?.split(/[,&]/)[0]?.trim()).filter(Boolean))]
    const genres = [...new Set(seedTracks.flatMap(t => t.genres || []))]
    console.log(`[Music Suggest] seeds=${seedTracks.length} artists=${artists.length} genres=${genres.length}`)

    // Sanity-check Spotify auth up front so we can surface clear errors
    let spotifyAuthOk = true
    let spotifyAuthError = null
    try {
      const { searchTrack } = await import('@/lib/spotify')
      const probe = await searchTrack(artists[0] || 'test')
      if (!probe || !Array.isArray(probe)) throw new Error('Invalid probe response')
    } catch (e) {
      spotifyAuthOk = false
      spotifyAuthError = e.message
      console.error(`[Music Suggest] Spotify auth probe failed:`, e.message)
    }

    if (!spotifyAuthOk) {
      return NextResponse.json({
        error: 'Spotify API unavailable',
        details: spotifyAuthError,
        hint: 'Check SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET env vars on this deployment.',
      }, { status: 500 })
    }

    const suggestions = await findSimilarMusic(seedTracks, { limit: 100 })
    console.log(`[Music Suggest] returned ${suggestions.length} suggestions`)

    // Shuffle so each session gets a different order
    for (let i = suggestions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [suggestions[i], suggestions[j]] = [suggestions[j], suggestions[i]]
    }

    return NextResponse.json({
      ok: true,
      identifiedSong,
      suggestions,
      seedCount: seedTracks.length,
      diagnostics: {
        seedTracksCount: seedTracks.length,
        uniqueArtists: artists.length,
        uniqueGenres: genres.length,
        sampleArtists: artists.slice(0, 5),
      },
    })
  } catch (err) {
    console.error('[Music Suggest] error:', err)
    return NextResponse.json({ error: err.message, stack: err.stack }, { status: 500 })
  }
}
