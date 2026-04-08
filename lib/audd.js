// AudD API helper — song identification from audio
// Docs: https://docs.audd.io/

const AUDD_API_TOKEN = process.env.AUDD_API_TOKEN

// Identify a song from an audio buffer (MP3/WAV)
// Returns: { title, artist, album, releaseDate, spotifyUrl, appleUrl, confidence } or null
export async function identifySong(audioBuffer) {
  if (!AUDD_API_TOKEN) throw new Error('AUDD_API_TOKEN not configured')

  const base64Audio = Buffer.from(audioBuffer).toString('base64')

  const res = await fetch('https://api.audd.io/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      api_token: AUDD_API_TOKEN,
      audio: base64Audio,
      return: 'spotify,apple_music',
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`AudD API failed: ${res.status} ${err}`)
  }

  const data = await res.json()

  if (data.status !== 'success') {
    throw new Error(`AudD error: ${data.error?.error_message || 'Unknown error'}`)
  }

  // No match found
  if (!data.result) return null

  const r = data.result
  return {
    title: r.title || '',
    artist: r.artist || '',
    album: r.album || '',
    releaseDate: r.release_date || '',
    spotifyUrl: r.spotify?.external_urls?.spotify || null,
    spotifyId: r.spotify?.id || null,
    appleUrl: r.apple_music?.url || null,
    label: r.label || '',
    timecode: r.timecode || '',
    score: r.score || null,
  }
}
