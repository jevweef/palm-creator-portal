// Spotify API helper — Client Credentials flow (no user login needed)
// Used for: playlist parsing, track search, recommendations

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET

let cachedToken = null
let tokenExpiresAt = 0

async function getSpotifyToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedToken
  }

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Spotify token failed: ${res.status} ${err}`)
  }

  const data = await res.json()
  cachedToken = data.access_token
  tokenExpiresAt = Date.now() + (data.expires_in * 1000)
  return cachedToken
}

async function spotifyFetch(path, params = {}) {
  const token = await getSpotifyToken()
  const url = new URL(`https://api.spotify.com/v1${path}`)
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v)
  })

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Spotify API ${path} failed: ${res.status} ${err}`)
  }

  return res.json()
}

// Extract playlist ID from various Spotify URL formats
function parsePlaylistId(input) {
  const trimmed = input.trim()
  // Direct ID
  if (/^[a-zA-Z0-9]{22}$/.test(trimmed)) return trimmed
  // URL: https://open.spotify.com/playlist/XXXXX?si=...
  const match = trimmed.match(/playlist\/([a-zA-Z0-9]{22})/)
  return match ? match[1] : null
}

// Get all tracks from a Spotify playlist
export async function getPlaylistTracks(playlistUrl) {
  const playlistId = parsePlaylistId(playlistUrl)
  if (!playlistId) throw new Error('Could not parse Spotify playlist ID from input')

  const tracks = []
  let offset = 0
  const limit = 100

  while (true) {
    const data = await spotifyFetch(`/playlists/${playlistId}/tracks`, {
      offset,
      limit,
      fields: 'items(track(id,name,artists,album,duration_ms,preview_url,external_urls)),next',
    })

    for (const item of data.items || []) {
      const track = item.track
      if (!track || !track.id) continue
      tracks.push({
        spotifyId: track.id,
        track: track.name,
        artist: (track.artists || []).map(a => a.name).join(', '),
        album: track.album?.name || '',
        durationMs: track.duration_ms,
        previewUrl: track.preview_url || null,
        spotifyUrl: track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`,
      })
    }

    if (!data.next) break
    offset += limit
  }

  return tracks
}

// Search for a track by "artist - song title" query
export async function searchTrack(query) {
  const data = await spotifyFetch('/search', {
    q: query,
    type: 'track',
    limit: 5,
  })

  return (data.tracks?.items || []).map(track => ({
    spotifyId: track.id,
    track: track.name,
    artist: (track.artists || []).map(a => a.name).join(', '),
    album: track.album?.name || '',
    durationMs: track.duration_ms,
    previewUrl: track.preview_url || null,
    spotifyUrl: track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`,
    albumArt: track.album?.images?.[0]?.url || null,
  }))
}

// Find similar music using search — replacement for deprecated /recommendations endpoint.
// Collects results from multiple sources then interleaves them like a radio station.
// seedTracks: array of { artist, track, genres?, spotifyId? }
export async function findSimilarMusic(seedTracks, options = {}) {
  const limit = options.limit || 20
  const seen = new Set(seedTracks.map(t => t.spotifyId).filter(Boolean))
  // Collect results in separate buckets per source, then interleave
  const buckets = []

  function parseTrack(track) {
    return {
      spotifyId: track.id,
      track: track.name,
      artist: (track.artists || []).map(a => a.name).join(', '),
      album: track.album?.name || '',
      durationMs: track.duration_ms,
      previewUrl: track.preview_url || null,
      spotifyUrl: track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`,
      albumArt: track.album?.images?.[0]?.url || null,
    }
  }

  // Search by each seed artist name
  const artists = [...new Set(seedTracks.map(t => t.artist?.split(',')[0]?.trim()).filter(Boolean))]
  for (const artist of artists.slice(0, 5)) {
    try {
      const data = await spotifyFetch('/search', { q: `artist:"${artist}"`, type: 'track', limit: 6 })
      const bucket = []
      for (const track of data.tracks?.items || []) {
        if (!seen.has(track.id)) { seen.add(track.id); bucket.push(parseTrack(track)) }
      }
      if (bucket.length) buckets.push(bucket)
    } catch (e) {
      console.warn(`[Spotify] Artist search "${artist}" failed:`, e.message)
    }
  }

  // Search by genre keywords from DNA
  const genres = [...new Set(seedTracks.flatMap(t => t.genres || []))].slice(0, 4)
  for (const genre of genres) {
    try {
      const data = await spotifyFetch('/search', { q: `genre:"${genre}"`, type: 'track', limit: 6 })
      const bucket = []
      for (const track of data.tracks?.items || []) {
        if (!seen.has(track.id)) { seen.add(track.id); bucket.push(parseTrack(track)) }
      }
      if (bucket.length) buckets.push(bucket)
    } catch (e) {
      console.warn(`[Spotify] Genre search "${genre}" failed:`, e.message)
    }
  }

  // Interleave: round-robin pick one from each bucket so no artist/genre dominates
  const results = []
  let round = 0
  while (results.length < limit) {
    let added = false
    for (const bucket of buckets) {
      if (round < bucket.length && results.length < limit) {
        results.push(bucket[round])
        added = true
      }
    }
    if (!added) break
    round++
  }

  return results
}

// Get artist info (genres) for enriching DNA
export async function getArtistGenres(artistIds) {
  if (!artistIds.length) return {}
  // Spotify allows up to 50 artist IDs per request
  const chunks = []
  for (let i = 0; i < artistIds.length; i += 50) {
    chunks.push(artistIds.slice(i, i + 50))
  }

  const genreMap = {}
  for (const chunk of chunks) {
    const data = await spotifyFetch('/artists', { ids: chunk.join(',') })
    for (const artist of data.artists || []) {
      if (artist) genreMap[artist.id] = artist.genres || []
    }
  }
  return genreMap
}

// Search for a track and return the best match with artist details
export async function searchAndEnrich(query) {
  const results = await searchTrack(query)
  if (!results.length) return null

  const best = results[0]

  // Try to get artist genres
  try {
    const searchData = await spotifyFetch('/search', {
      q: query,
      type: 'track',
      limit: 1,
    })
    const track = searchData.tracks?.items?.[0]
    if (track) {
      const artistIds = track.artists.map(a => a.id)
      const genres = await getArtistGenres(artistIds)
      best.genres = [...new Set(Object.values(genres).flat())]
    }
  } catch (e) {
    // Genres are nice-to-have, don't fail
    best.genres = []
  }

  return best
}

// Top 50 USA chart — Billboard Hot 100 via RapidAPI, enriched with Spotify data
let top50Cache = null
let top50CacheExpiry = 0

export async function getTop50USA() {
  if (top50Cache && Date.now() < top50CacheExpiry) return top50Cache

  const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY
  if (!RAPIDAPI_KEY) throw new Error('RAPIDAPI_KEY not configured')

  // Fetch Billboard Hot 100
  const billboardRes = await fetch('https://billboard-api2.p.rapidapi.com/hot-100?date=&range=1-50', {
    headers: {
      'x-rapidapi-key': RAPIDAPI_KEY,
      'x-rapidapi-host': 'billboard-api2.p.rapidapi.com',
    },
  })

  if (!billboardRes.ok) {
    const err = await billboardRes.text()
    throw new Error(`Billboard API failed: ${billboardRes.status} ${err}`)
  }

  const billboard = await billboardRes.json()
  const entries = Object.values(billboard.content || {})
    .sort((a, b) => parseInt(a.rank) - parseInt(b.rank))
    .slice(0, 50)

  // Enrich each track with Spotify data (album art, embed, download link)
  // Batch in parallel, 10 at a time to avoid rate limits
  const tracks = []
  for (let i = 0; i < entries.length; i += 10) {
    const batch = entries.slice(i, i + 10)
    const results = await Promise.all(
      batch.map(async (entry) => {
        const query = `${entry.artist} ${entry.title}`
        try {
          const results = await searchTrack(query)
          if (results.length > 0) {
            return { ...results[0], rank: parseInt(entry.rank) }
          }
        } catch {}
        // Fallback: return billboard data without Spotify enrichment
        return {
          spotifyId: null,
          track: entry.title,
          artist: entry.artist,
          album: '',
          durationMs: 0,
          previewUrl: null,
          spotifyUrl: null,
          albumArt: entry.image || null,
          rank: parseInt(entry.rank),
        }
      })
    )
    tracks.push(...results)
  }

  top50Cache = tracks
  top50CacheExpiry = Date.now() + 24 * 60 * 60 * 1000 // 24 hours (chart updates weekly)
  return tracks
}

export { getSpotifyToken, parsePlaylistId }
