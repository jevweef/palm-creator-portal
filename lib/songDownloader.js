// Song downloader — fetches MP3 audio files via cobalt.tools API or similar service
// Cobalt is open-source: https://github.com/imputnet/cobalt
// Public API: https://cobalt.tools

const COBALT_API_URL = process.env.COBALT_API_URL || 'https://api.cobalt.tools'

// Download a song as MP3 from a Spotify/YouTube URL
// Returns: { buffer, filename, contentType } or null
export async function downloadSong({ spotifyUrl, youtubeUrl, artist, title }) {
  const url = spotifyUrl || youtubeUrl
  if (!url) {
    throw new Error('Either spotifyUrl or youtubeUrl is required')
  }

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

    if (!res.ok) {
      const err = await res.text()
      console.error('[SongDownloader] Cobalt API error:', res.status, err)
      return null
    }

    const data = await res.json()

    // Cobalt returns a tunnel or redirect URL to the audio file
    if (data.status === 'tunnel' || data.status === 'redirect') {
      const audioUrl = data.url
      const audioRes = await fetch(audioUrl)
      if (!audioRes.ok) {
        console.error('[SongDownloader] Audio fetch failed:', audioRes.status)
        return null
      }

      const buffer = Buffer.from(await audioRes.arrayBuffer())
      const filename = `${artist || 'Unknown'} - ${title || 'Unknown'}.mp3`
        .replace(/[/\\?%*:|"<>]/g, '-')

      return { buffer, filename, contentType: 'audio/mpeg' }
    }

    // Cobalt v8+ may return a stream directly
    if (data.status === 'stream') {
      const audioRes = await fetch(data.url)
      if (!audioRes.ok) return null
      const buffer = Buffer.from(await audioRes.arrayBuffer())
      const filename = `${artist || 'Unknown'} - ${title || 'Unknown'}.mp3`
        .replace(/[/\\?%*:|"<>]/g, '-')
      return { buffer, filename, contentType: 'audio/mpeg' }
    }

    // If cobalt can't process, return error info
    if (data.status === 'error') {
      console.error('[SongDownloader] Cobalt error:', data.error?.code, data.error?.context)
      return null
    }

    console.error('[SongDownloader] Unexpected cobalt response:', data.status)
    return null
  } catch (err) {
    console.error('[SongDownloader] Failed:', err.message)
    return null
  }
}

// Build a YouTube search URL for manual fallback
export function getYouTubeSearchUrl(artist, title) {
  const query = encodeURIComponent(`${artist} ${title} audio`)
  return `https://www.youtube.com/results?search_query=${query}`
}

// Build a spotdown fallback URL
export function getSpotdownUrl(spotifyUrl) {
  if (!spotifyUrl) return null
  return `https://spotdown.org/?url=${encodeURIComponent(spotifyUrl)}`
}
