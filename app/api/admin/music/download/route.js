export const maxDuration = 60

import { NextResponse } from 'next/server'
import { requireAdminOrEditor } from '@/lib/adminAuth'
import { downloadSong, getSpotdownUrl, getYouTubeSearchUrl } from '@/lib/songDownloader'

// POST — download a song as MP3
// Input: { spotifyUrl, artist, title }
// Returns: MP3 audio stream or fallback links
export async function POST(request) {
  try { await requireAdminOrEditor() } catch (e) { return e }

  try {
    const { spotifyUrl, youtubeUrl, artist, title } = await request.json()

    if (!spotifyUrl && !youtubeUrl) {
      return NextResponse.json({ error: 'spotifyUrl or youtubeUrl required' }, { status: 400 })
    }

    console.log(`[Music Download] Downloading: ${artist} - ${title}`)

    // Try automated download via cobalt
    const result = await downloadSong({ spotifyUrl, youtubeUrl, artist, title })

    if (result) {
      // Stream the MP3 back to the browser
      return new Response(result.buffer, {
        headers: {
          'Content-Type': result.contentType,
          'Content-Disposition': `attachment; filename="${result.filename}"`,
          'Content-Length': result.buffer.length.toString(),
        },
      })
    }

    // Fallback: return links for manual download
    console.log('[Music Download] Automated download failed, returning fallback links')
    return NextResponse.json({
      ok: false,
      fallback: true,
      message: 'Automated download unavailable. Use one of the links below:',
      links: {
        spotdown: getSpotdownUrl(spotifyUrl),
        youtube: getYouTubeSearchUrl(artist, title),
        spotify: spotifyUrl,
      },
    })
  } catch (err) {
    console.error('[Music Download] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
