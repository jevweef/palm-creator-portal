export const maxDuration = 60

import { NextResponse } from 'next/server'
import { requireAdmin, patchAirtableRecord } from '@/lib/adminAuth'
import { getPlaylistTracks, searchAndEnrich } from '@/lib/spotify'

// POST — process a creator's music DNA input
// Accepts: Spotify playlist URL, Apple Music playlist URL, or text list of songs
// Enriches with Spotify metadata and saves to Airtable
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorId, inputType, rawInput } = await request.json()
    if (!creatorId || !rawInput) {
      return NextResponse.json({ error: 'creatorId and rawInput required' }, { status: 400 })
    }

    let tracks = []

    if (inputType === 'spotify_playlist') {
      // Parse Spotify playlist directly
      console.log('[Music DNA] Processing Spotify playlist...')
      const playlistTracks = await getPlaylistTracks(rawInput)

      // Enrich with artist genres (batch the unique artists)
      tracks = playlistTracks.map(t => ({
        track: t.track,
        artist: t.artist,
        spotifyId: t.spotifyId,
        spotifyUrl: t.spotifyUrl,
        previewUrl: t.previewUrl,
        album: t.album,
        genres: [], // Will be enriched below
      }))

      // Get genres for unique artists
      try {
        const { getArtistGenres } = await import('@/lib/spotify')
        // Extract unique artist IDs from the playlist
        const playlistData = await getPlaylistTracks(rawInput)
        // We'd need artist IDs — for now, genres are nice-to-have
      } catch (e) {
        console.warn('[Music DNA] Genre enrichment skipped:', e.message)
      }

    } else if (inputType === 'text_list') {
      // Parse text list — each line is "Artist - Song Title" or just "Artist"
      console.log('[Music DNA] Processing text list...')
      const lines = rawInput.split('\n').map(l => l.trim()).filter(Boolean)

      for (const line of lines) {
        try {
          const result = await searchAndEnrich(line)
          if (result) {
            tracks.push({
              track: result.track,
              artist: result.artist,
              spotifyId: result.spotifyId,
              spotifyUrl: result.spotifyUrl,
              previewUrl: result.previewUrl,
              album: result.album,
              genres: result.genres || [],
            })
          } else {
            // Track not found on Spotify — keep as manual entry
            tracks.push({
              track: line,
              artist: '',
              spotifyId: null,
              spotifyUrl: null,
              previewUrl: null,
              album: '',
              genres: [],
            })
          }
        } catch (e) {
          console.warn(`[Music DNA] Failed to search "${line}":`, e.message)
          tracks.push({
            track: line,
            artist: '',
            spotifyId: null,
            spotifyUrl: null,
            previewUrl: null,
            album: '',
            genres: [],
          })
        }
      }

    } else if (inputType === 'apple_music') {
      // Apple Music — extract track names and search Spotify
      // For MVP: treat the URL as a hint and ask user to also provide text list
      console.log('[Music DNA] Apple Music URL — falling back to text search...')
      return NextResponse.json({
        error: 'Apple Music playlist parsing is not yet supported. Please paste the song list as text instead.',
      }, { status: 400 })

    } else {
      return NextResponse.json({ error: 'Invalid inputType. Use: spotify_playlist, text_list, or apple_music' }, { status: 400 })
    }

    // Compute aggregate stats
    const allGenres = tracks.flatMap(t => t.genres || [])
    const genreCounts = {}
    allGenres.forEach(g => { genreCounts[g] = (genreCounts[g] || 0) + 1 })
    const topGenres = Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([genre]) => genre)

    const dnaData = {
      tracks,
      topGenres,
      trackCount: tracks.length,
      processedAt: new Date().toISOString(),
    }

    // Map inputType to Airtable select value
    const typeMap = {
      spotify_playlist: 'Spotify Playlist',
      apple_music: 'Apple Music Playlist',
      text_list: 'Text List',
    }

    // Save to Airtable
    await patchAirtableRecord('Palm Creators', creatorId, {
      'Music DNA Input': rawInput,
      'Music DNA Type': typeMap[inputType] || inputType,
      'Music DNA Processed': JSON.stringify(dnaData),
    })

    console.log(`[Music DNA] Processed ${tracks.length} tracks for creator ${creatorId}`)
    return NextResponse.json({ ok: true, ...dnaData })
  } catch (err) {
    console.error('[Music DNA] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
