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

// Scrape tracks from the Spotify embed page (fallback when API returns 403)
async function scrapePlaylistEmbed(playlistId) {
  const res = await fetch(`https://open.spotify.com/embed/playlist/${playlistId}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  })
  if (!res.ok) throw new Error(`Spotify embed fetch failed: ${res.status}`)
  const html = await res.text()

  const nextData = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s)
  if (!nextData) throw new Error('Could not find track data in Spotify embed page')

  const data = JSON.parse(nextData[1])
  const trackList = data.props?.pageProps?.state?.data?.entity?.trackList || []
  if (!trackList.length) throw new Error('Spotify embed returned empty track list')

  return trackList.map(t => {
    const spotifyId = t.uri?.replace('spotify:track:', '') || null
    return {
      spotifyId,
      track: t.title || '',
      artist: t.subtitle || '',
      album: '',
      durationMs: t.duration || 0,
      previewUrl: t.audioPreview?.url || null,
      spotifyUrl: spotifyId ? `https://open.spotify.com/track/${spotifyId}` : null,
    }
  }).filter(t => t.spotifyId)
}

// Get all tracks from a Spotify playlist
export async function getPlaylistTracks(playlistUrl) {
  const playlistId = parsePlaylistId(playlistUrl)
  if (!playlistId) throw new Error('Could not parse Spotify playlist ID from input')

  // Try API first, fall back to embed scrape on 403
  try {
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

    if (tracks.length) return tracks
  } catch (e) {
    if (!e.message?.includes('403')) throw e
    console.log('[Spotify] API returned 403 for playlist tracks, falling back to embed scrape')
  }

  return scrapePlaylistEmbed(playlistId)
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

// TikTok Top 100 — from tikcharts.com (Next.js page with embedded JSON data)
// Free, no API key, full 100 songs with images. Enriched with Spotify for play/download.
let top50Cache = null
let top50CacheExpiry = 0

export async function getTop50USA() {
  if (top50Cache && Date.now() < top50CacheExpiry) return top50Cache

  const res = await fetch('https://tikcharts.com/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PalmMgmt/1.0)' },
  })
  if (!res.ok) throw new Error(`TikTok chart fetch failed: ${res.status}`)
  const html = await res.text()

  // Extract __NEXT_DATA__ JSON embedded in the page
  const match = html.match(/__NEXT_DATA__[^>]*>(.*?)<\/script>/)
  if (!match) throw new Error('Could not find chart data on tikcharts.com')

  const pageData = JSON.parse(match[1])
  const weeks = pageData.props?.pageProps?.weeks || []
  const entriesByWeek = pageData.props?.pageProps?.entriesByWeek || {}
  const latestWeek = weeks[0]
  if (!latestWeek || !entriesByWeek[latestWeek]) throw new Error('No chart week found')

  const chartEntries = entriesByWeek[latestWeek].slice(0, 100)

  // Enrich with Spotify data — 25 at a time for play/download support
  const tracks = []
  for (let i = 0; i < chartEntries.length; i += 25) {
    const batch = chartEntries.slice(i, i + 25)
    const results = await Promise.all(
      batch.map(async (entry) => {
        try {
          const results = await searchTrack(`${entry.artist} ${entry.title}`)
          if (results.length > 0) return { ...results[0], rank: entry.rank }
        } catch {}
        // Fallback: use tikcharts data directly
        return {
          spotifyId: null, track: entry.title, artist: entry.artist,
          album: '', durationMs: 0, previewUrl: entry.play_url || null,
          spotifyUrl: null, albumArt: entry.image_url || null, rank: entry.rank,
        }
      })
    )
    tracks.push(...results)
  }

  top50Cache = tracks
  top50CacheExpiry = Date.now() + 24 * 60 * 60 * 1000 // 24 hours
  return tracks
}

// Billboard Hot 100 — scraped from billboard.com (free, ~14 songs from initial HTML)
let billboardCache = null
let billboardCacheExpiry = 0

export async function getBillboardHot100() {
  if (billboardCache && Date.now() < billboardCacheExpiry) return billboardCache

  const res = await fetch('https://www.billboard.com/charts/hot-100/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PalmMgmt/1.0)' },
  })
  if (!res.ok) throw new Error(`Billboard fetch failed: ${res.status}`)
  const html = await res.text()

  // Parse from HTML: 100 row containers, each has h3#title-of-a-story + span with artist
  const decode = s => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    .replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&quot;/g, '"')
  const entries = []
  const chunks = html.split('o-chart-results-list-row-container')
  for (const chunk of chunks.slice(1)) {
    // First h3#title-of-a-story = song title
    const titleM = chunk.match(/id="title-of-a-story"[^>]*>([\s\S]*?)<\/h3>/)
    // Artist is in a span with a-no-trucate class — class attr may have newlines, content may have <a> tags
    const artistM = chunk.match(/class="[^"]*a-no-trucate[^"]*"[^>]*>([\s\S]*?)<\/span>/)
    if (titleM && artistM) {
      const title = decode(titleM[1])
      const artist = decode(artistM[1])
      if (title && artist && !['Gains in', 'Additional Awards', 'Songwriter', 'Producer'].some(x => title.includes(x))) {
        entries.push({ rank: entries.length + 1, title, artist })
      }
    }
  }

  if (entries.length === 0) throw new Error('No Billboard entries found')

  // Enrich with Spotify
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

  billboardCache = tracks
  billboardCacheExpiry = Date.now() + 24 * 60 * 60 * 1000
  return tracks
}

export { getSpotifyToken, parsePlaylistId }
