export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { requireAdmin, patchAirtableRecord } from '@/lib/adminAuth'
import { identifySong } from '@/lib/audd'
import { searchTrack } from '@/lib/spotify'
import ffmpegStatic from 'ffmpeg-static'
import ffmpeg from 'fluent-ffmpeg'
import { readFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

ffmpeg.setFfmpegPath(ffmpegStatic)

function rawDropboxUrl(url) {
  if (!url) return ''
  return url.replace(/[?&]dl=0/, '').replace(/([?&]raw=1)?$/, '') + (url.includes('?') ? '&raw=1' : '?raw=1')
}

// Get video duration using ffprobe
function getVideoDuration(inputUrl) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputUrl, (err, metadata) => {
      if (err) reject(err)
      else resolve(metadata.format.duration || 30)
    })
  })
}

// Extract audio clip from video
function extractAudioClip(inputUrl, outputPath, startTime, duration) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputUrl)
      .inputOptions([`-ss ${startTime}`])
      .outputOptions([
        `-t ${duration}`,
        '-vn',              // no video
        '-acodec libmp3lame',
        '-ab 128k',
        '-ar 44100',
        '-ac 1',            // mono
      ])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run()
  })
}

// POST — identify a song from an inspo reel video
// Input: { inspoId, videoUrl } where videoUrl is a Dropbox shared link
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { inspoId, videoUrl } = await request.json()
    if (!inspoId || !videoUrl) {
      return NextResponse.json({ error: 'inspoId and videoUrl required' }, { status: 400 })
    }

    const rawUrl = rawDropboxUrl(videoUrl)
    const id = Date.now()
    const audioPath = join(tmpdir(), `audio_${id}.mp3`)

    console.log(`[Music Identify] Extracting audio from video...`)

    // Get video duration to extract from the middle
    let duration
    try {
      duration = await getVideoDuration(rawUrl)
    } catch (e) {
      console.warn('[Music Identify] ffprobe failed, assuming 30s:', e.message)
      duration = 30
    }

    // Extract 20 seconds from the middle of the video
    const clipDuration = Math.min(20, duration)
    const startTime = Math.max(0, (duration / 2) - (clipDuration / 2))

    await extractAudioClip(rawUrl, audioPath, startTime, clipDuration)

    const audioBuffer = await readFile(audioPath)
    await unlink(audioPath).catch(() => {})

    console.log(`[Music Identify] Audio extracted: ${(audioBuffer.length / 1024).toFixed(0)}KB, sending to AudD...`)

    // Identify the song via AudD
    const result = await identifySong(audioBuffer)

    if (!result) {
      console.log('[Music Identify] No match found')
      return NextResponse.json({ ok: true, match: false, message: 'No song match found' })
    }

    console.log(`[Music Identify] Match: ${result.artist} - ${result.title}`)

    // Enrich with Spotify data if AudD didn't return it
    let spotifyUrl = result.spotifyUrl
    let spotifyId = result.spotifyId
    if (!spotifyId && result.artist && result.title) {
      try {
        const searchResults = await searchTrack(`${result.artist} ${result.title}`)
        if (searchResults.length) {
          spotifyUrl = searchResults[0].spotifyUrl
          spotifyId = searchResults[0].spotifyId
        }
      } catch (e) {
        console.warn('[Music Identify] Spotify search failed:', e.message)
      }
    }

    const songData = {
      title: result.title,
      artist: result.artist,
      album: result.album,
      spotifyId,
      spotifyUrl,
      appleUrl: result.appleUrl,
      label: result.label,
    }

    // Save to Airtable
    await patchAirtableRecord('Inspiration', inspoId, {
      'Identified Song': `${result.artist} - ${result.title}`,
      'Identified Song Data': JSON.stringify(songData),
    })

    return NextResponse.json({ ok: true, match: true, song: songData })
  } catch (err) {
    console.error('[Music Identify] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
