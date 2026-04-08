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
// Builds queries from seed track artists + genres from DNA to discover related songs.
// seedTracks: array of { artist, track, genres?, spotifyId? }
export async function findSimilarMusic(seedTracks, options = {}) {
  const limit = options.limit || 20
  const seen = new Set(seedTracks.map(t => t.spotifyId).filter(Boolean))
  const results = []

  // Strategy 1: Search by each seed artist name (finds their other songs + related)
  const artists = [...new Set(seedTracks.map(t => t.artist?.split(',')[0]?.trim()).filter(Boolean))]
  for (const artist of artists.slice(0, 4)) {
    if (results.length >= limit) break
    try {
      const data = await spotifyFetch('/search', {
        q: `artist:"${artist}"`,
        type: 'track',
        limit: 8,
      })
      for (const track of data.tracks?.items || []) {
        if (seen.has(track.id) || results.length >= limit) continue
        seen.add(track.id)
        results.push({
          spotifyId: track.id,
          track: track.name,
          artist: (track.artists || []).map(a => a.name).join(', '),
          album: track.album?.name || '',
          durationMs: track.duration_ms,
          previewUrl: track.preview_url || null,
          spotifyUrl: track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`,
          albumArt: track.album?.images?.[0]?.url || null,
        })
      }
    } catch (e) {
      console.warn(`[Spotify] Search for artist "${artist}" failed:`, e.message)
    }
  }

  // Strategy 2: Search by genre keywords from DNA
  const genres = [...new Set(seedTracks.flatMap(t => t.genres || []))].slice(0, 3)
  for (const genre of genres) {
    if (results.length >= limit) break
    try {
      const data = await spotifyFetch('/search', {
        q: `genre:"${genre}"`,
        type: 'track',
        limit: 8,
      })
      for (const track of data.tracks?.items || []) {
        if (seen.has(track.id) || results.length >= limit) continue
        seen.add(track.id)
        results.push({
          spotifyId: track.id,
          track: track.name,
          artist: (track.artists || []).map(a => a.name).join(', '),
          album: track.album?.name || '',
          durationMs: track.duration_ms,
          previewUrl: track.preview_url || null,
          spotifyUrl: track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`,
          albumArt: track.album?.images?.[0]?.url || null,
        })
      }
    } catch (e) {
      console.warn(`[Spotify] Search for genre "${genre}" failed:`, e.message)
    }
  }

  // Strategy 3: If we have an identified song, search for similar title patterns
  const seedTrack = seedTracks[0]
  if (seedTrack?.track && results.length < limit) {
    try {
      const data = await spotifyFetch('/search', {
        q: seedTrack.track,
        type: 'track',
        limit: 10,
      })
      for (const track of data.tracks?.items || []) {
        if (seen.has(track.id) || results.length >= limit) continue
        seen.add(track.id)
        results.push({
          spotifyId: track.id,
          track: track.name,
          artist: (track.artists || []).map(a => a.name).join(', '),
          album: track.album?.name || '',
          durationMs: track.duration_ms,
          previewUrl: track.preview_url || null,
          spotifyUrl: track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`,
          albumArt: track.album?.images?.[0]?.url || null,
        })
      }
    } catch (e) {
      console.warn(`[Spotify] Search for track "${seedTrack.track}" failed:`, e.message)
    }
  }

  return results.slice(0, limit)
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

export { getSpotifyToken, parsePlaylistId }
