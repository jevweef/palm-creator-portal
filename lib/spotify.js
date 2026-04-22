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
    limit: 1, // Spotify restricts non-extended-quota apps to limit=1
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

  // Decide how many to pull from each source based on requested limit
  // Spotify restricts new (non-extended-quota) apps to limit=1 per search call,
  // so we compensate by searching more artists/genres
  const PER_SEARCH = 1 // Spotify max for non-extended-quota apps
  const artistCount = limit >= 80 ? 30 : limit >= 40 ? 20 : 10
  const genreCount = limit >= 80 ? 15 : limit >= 40 ? 10 : 6

  // Search by each seed artist name — use BOTH quoted (exact) and unquoted (fuzzy) queries
  // Apple Music-sourced artists with special chars often fail the quoted form
  const artists = [...new Set(seedTracks.map(t => t.artist?.split(/[,&]/)[0]?.trim()).filter(Boolean))]
  console.log(`[findSimilarMusic] searching ${Math.min(artists.length, artistCount)} artists...`)
  // Run artist searches in parallel (Spotify handles ~30 req/s fine)
  const artistResults = await Promise.all(artists.slice(0, artistCount).map(async (artist) => {
    try {
      // Try quoted first (more precise)
      let data = await spotifyFetch('/search', { q: `artist:"${artist}"`, type: 'track', limit: PER_SEARCH })
      let items = data.tracks?.items || []
      // Fall back to plain search if quoted returned nothing
      if (items.length === 0) {
        data = await spotifyFetch('/search', { q: artist, type: 'track', limit: PER_SEARCH })
        items = data.tracks?.items || []
      }
      return { ok: true, items, artist }
    } catch (e) {
      console.warn(`[Spotify] Artist search "${artist}" failed:`, e.message)
      return { ok: false, error: e.message, artist }
    }
  }))
  let artistSearchSuccesses = 0
  let artistSearchFailures = 0
  let totalReturned = 0
  let totalAfterDedup = 0
  for (const r of artistResults) {
    if (!r.ok) { artistSearchFailures++; continue }
    artistSearchSuccesses++
    totalReturned += r.items.length
    const bucket = []
    for (const track of r.items) {
      if (!seen.has(track.id)) { seen.add(track.id); bucket.push(parseTrack(track)) }
    }
    totalAfterDedup += bucket.length
    if (bucket.length) buckets.push(bucket)
  }
  console.log(`[findSimilarMusic] artist searches: ${artistSearchSuccesses} ok, ${artistSearchFailures} fail, ${totalReturned} total returned, ${totalAfterDedup} after dedup`)

  // If no genres in seeds, derive them from seed tracks' artists on-the-fly
  // (Apple Music ingest doesn't populate genres — this fills the gap)
  let derivedGenres = [...new Set(seedTracks.flatMap(t => t.genres || []))]
  if (derivedGenres.length === 0 && seedTracks.some(t => t.spotifyId)) {
    try {
      const seedSpotifyIds = seedTracks.map(t => t.spotifyId).filter(Boolean).slice(0, 10)
      const trackLookups = await Promise.all(seedSpotifyIds.map(id =>
        spotifyFetch(`/tracks/${id}`).catch(() => null)
      ))
      const artistIds = [...new Set(trackLookups.filter(Boolean).flatMap(t => (t.artists || []).map(a => a.id)))].slice(0, 20)
      if (artistIds.length) {
        const genreMap = await getArtistGenres(artistIds)
        derivedGenres = [...new Set(Object.values(genreMap).flat())].slice(0, 10)
        console.log(`[findSimilarMusic] derived ${derivedGenres.length} genres from seed artists`)
      }
    } catch (e) {
      console.warn(`[findSimilarMusic] genre derivation failed:`, e.message)
    }
  }

  // Search by genre keywords — use derived genres (falls back to seed genres)
  const genres = derivedGenres.slice(0, genreCount)
  const genreResults = await Promise.all(genres.map(async (genre) => {
    try {
      const data = await spotifyFetch('/search', { q: `genre:"${genre}"`, type: 'track', limit: PER_SEARCH })
      return { ok: true, items: data.tracks?.items || [] }
    } catch (e) {
      console.warn(`[Spotify] Genre search "${genre}" failed:`, e.message)
      return { ok: false }
    }
  }))
  for (const r of genreResults) {
    if (!r.ok) continue
    const bucket = []
    for (const track of r.items) {
      if (!seen.has(track.id)) { seen.add(track.id); bucket.push(parseTrack(track)) }
    }
    if (bucket.length) buckets.push(bucket)
  }

  // Also get "related artists" via Spotify — searches for tracks with similar vibes
  // by looking up each seed artist's top tracks (pulls deeper catalog)
  if (limit >= 80) {
    for (const artistName of artists.slice(0, 8)) {
      try {
        // Find artist ID first
        const searchData = await spotifyFetch('/search', { q: artistName, type: 'artist', limit: 1 })
        const artistId = searchData.artists?.items?.[0]?.id
        if (!artistId) continue
        // Get their top tracks
        const topData = await spotifyFetch(`/artists/${artistId}/top-tracks`, { market: 'US' })
        const bucket = []
        for (const track of topData.tracks || []) {
          if (!seen.has(track.id)) { seen.add(track.id); bucket.push(parseTrack(track)) }
        }
        if (bucket.length) buckets.push(bucket)
      } catch (e) {
        // Ignore failures, just continue
      }
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

  // Enrich with Spotify (batch 10 at a time to avoid rate limits)
  const tracks = []
  for (let i = 0; i < entries.length; i += 10) {
    const batch = entries.slice(i, i + 10)
    const results = await Promise.all(
      batch.map(async (entry) => {
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
    tracks.push(...results)
  }

  billboardCache = tracks
  billboardCacheExpiry = Date.now() + 24 * 60 * 60 * 1000
  return tracks
}

export { getSpotifyToken, parsePlaylistId }
