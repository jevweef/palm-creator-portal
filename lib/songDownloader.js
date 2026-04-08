// Song downloader — fetches MP3 audio files via cobalt.tools API
// Cobalt is open-source: https://github.com/imputnet/cobalt

const COBALT_API_URL = process.env.COBALT_API_URL || 'https://api.cobalt.tools'

// Download a song as MP3 from a Spotify/YouTube URL
// Returns: { buffer, filename, contentType } or null
export async function downloadSong({ spotifyUrl, youtubeUrl, artist, title }) {
  const url = spotifyUrl || youtubeUrl
  if (!url) throw new Error('Either spotifyUrl or youtubeUrl is required')

  // Try cobalt API
  try {
    const res = await fetch(`${COBALT_API_URL}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        url,
        downloadMode: 'audio',
        audioFormat: 'mp3',
      }),
    })

    if (res.ok) {
      const data = await res.json()
      const audioUrl = data.url
      if (audioUrl && (data.status === 'tunnel' || data.status === 'redirect' || data.status === 'stream')) {
        const audioRes = await fetch(audioUrl)
        if (audioRes.ok) {
          const buffer = Buffer.from(await audioRes.arrayBuffer())
          const filename = sanitizeFilename(artist, title)
          return { buffer, filename, contentType: 'audio/mpeg' }
        }
      }
      if (data.status === 'error') {
        console.error('[SongDownloader] Cobalt error:', data.error?.code)
      }
    } else {
      console.error('[SongDownloader] Cobalt HTTP error:', res.status)
    }
  } catch (err) {
    console.error('[SongDownloader] Cobalt failed:', err.message)
  }

  return null
}

function sanitizeFilename(artist, title) {
  return `${artist || 'Unknown'} - ${title || 'Unknown'}.mp3`
    .replace(/[/\\?%*:|"<>]/g, '-')
}

// Build a spotdown URL — just open the site with the Spotify URL on clipboard
// spotdown.org doesn't support URL params, so we return the Spotify URL directly
// and the frontend copies it to clipboard before opening spotdown
export function getSpotdownUrl(spotifyUrl) {
  if (!spotifyUrl) return null
  return 'https://spotdown.org'
}

// Build a YouTube search URL for manual fallback
export function getYouTubeSearchUrl(artist, title) {
  const query = encodeURIComponent(`${artist} ${title}`)
  return `https://www.youtube.com/results?search_query=${query}`
}
