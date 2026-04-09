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

// TikTok Top Charts — scraped from mister-mixmania.com, enriched with Spotify data
// Free, no API key needed. Chart updates weekly.
let top50Cache = null
let top50CacheExpiry = 0

export async function getTop50USA() {
  if (top50Cache && Date.now() < top50CacheExpiry) return top50Cache

  // Get current calendar week for the URL
  const now = new Date()
  const startOfYear = new Date(now.getFullYear(), 0, 1)
  const weekNum = Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7)
  const cwParam = `${now.getFullYear()}-${weekNum}`

  const res = await fetch(`https://mister-mixmania.com/en/top-100-tiktok-charts/?cw_select=${cwParam}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PalmMgmt/1.0)' },
  })

  if (!res.ok) throw new Error(`TikTok chart fetch failed: ${res.status}`)
  const html = await res.text()

  // Parse entries from mm-music-item blocks using img alt="Artist - Title" pattern
  const entries = []
  const blocks = html.split('class="mm-music-item"')
  for (const block of blocks.slice(1)) {
    const rankM = block.match(/rank__number">(\d+)/)
    const altM = block.match(/alt="([^"]+?)"/)
    if (rankM && altM) {
      const alt = altM[1].replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&quot;/g, '"')
      if (alt.includes(' - ')) {
        const [artist, ...titleParts] = alt.split(' - ')
        entries.push({ rank: parseInt(rankM[1]), title: titleParts.join(' - ').trim(), artist: artist.trim() })
      }
    }
  }

  if (entries.length === 0) throw new Error('No chart entries found')

  // Enrich with Spotify data (album art, embed, download) — all in parallel
  const tracks = await Promise.all(
    entries.map(async (entry) => {
      try {
        const results = await searchTrack(`${entry.artist} ${entry.title}`)
        if (results.length > 0) return { ...results[0], rank: entry.rank }
      } catch {}
      return {
        spotifyId: null, track: entry.title, artist: entry.artist,
        album: '', durationMs: 0, previewUrl: null, spotifyUrl: null, albumArt: null,
        rank: entry.rank,
      }
    })
  )

  top50Cache = tracks
  top50CacheExpiry = Date.now() + 24 * 60 * 60 * 1000 // 24 hours
  return tracks
}

export { getSpotifyToken, parsePlaylistId }
