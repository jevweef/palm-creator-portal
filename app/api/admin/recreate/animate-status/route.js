import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { pollWaveSpeedTask } from '@/lib/wavespeed'
import {
  getDropboxAccessToken,
  getDropboxRootNamespaceId,
  uploadToDropbox,
  createDropboxSharedLink,
  createDropboxFolder,
} from '@/lib/dropbox'
import ffmpegStatic from 'ffmpeg-static'
import ffmpeg from 'fluent-ffmpeg'
import { writeFile, unlink, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'

ffmpeg.setFfmpegPath(ffmpegStatic)

const PALM_CREATORS = 'Palm Creators'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function rawDropboxUrl(url) {
  if (!url) return ''
  return url.replace(/[?&]dl=0/, '').replace(/([?&]raw=1)?$/, '') + (url.includes('?') ? '&raw=1' : '?raw=1')
}

async function ensureFolder(accessToken, rootNamespaceId, path) {
  try { await createDropboxFolder(accessToken, rootNamespaceId, path) }
  catch (e) {
    const msg = String(e.message || '')
    if (!msg.includes('path/conflict/folder') && !msg.includes('already_exists')) throw e
  }
}

// Mux: replace silent Kling audio track with original inspo audio, starting
// at audioOffset seconds into the inspo. -shortest cuts to whichever is
// shorter (always Kling). -c:v copy avoids re-encode (~1-2s instead of ~10s).
async function muxAudio(klingPath, inspoPath, outPath, audioOffset = 0) {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg()
      .input(klingPath)
      .input(inspoPath)
    if (audioOffset > 0) cmd.inputOptions([`-ss ${audioOffset}`])  // applies to second input
    cmd
      .outputOptions([
        '-map 0:v:0',       // video from Kling
        '-map 1:a:0?',      // audio from inspo (? = optional, won't fail if no audio)
        '-c:v copy',        // don't re-encode video
        '-c:a aac',
        '-b:a 192k',
        '-shortest',
      ])
      .save(outPath)
      .on('end', () => resolve())
      .on('error', err => reject(new Error(`ffmpeg mux failed: ${err.message}`)))
  })
}

// POST — body: { taskId, creatorId, shortcode, inspoVideoUrl?, audioOffset? }
//   On 'completed': downloads Kling MP4, fetches inspo video for audio,
//   muxes, uploads final to /Palm Ops/Creators/{aka}/recreations/{shortcode}/animated-{ts}.mp4
// Returns: { status: 'created'|'processing'|'completed'|'failed', outputUrl?, filename?, ... }
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { taskId, creatorId, shortcode, inspoVideoUrl, audioOffset } = await request.json()
    if (!taskId) return NextResponse.json({ error: 'Missing taskId' }, { status: 400 })

    const task = await pollWaveSpeedTask(taskId)
    if (task.status !== 'completed') {
      return NextResponse.json({ status: task.status, error: task.error || null })
    }

    const klingUrl = Array.isArray(task.outputs) ? task.outputs[0] : null
    if (!klingUrl) {
      return NextResponse.json({ status: 'failed', error: 'No output URL from Kling' })
    }

    // If no creator/shortcode provided we just return the raw Kling URL —
    // useful if the caller wants to handle storage themselves.
    if (!creatorId || !shortcode) {
      return NextResponse.json({ status: 'completed', outputUrl: klingUrl, muxed: false })
    }

    // Resolve creator AKA for the Dropbox folder
    const records = await fetchAirtableRecords(PALM_CREATORS, {
      filterByFormula: `RECORD_ID() = '${creatorId}'`,
      fields: ['AKA'],
      maxRecords: 1,
    })
    if (!records.length) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
    const aka = records[0].fields.AKA
    if (!aka) return NextResponse.json({ error: 'Creator missing AKA' }, { status: 400 })

    // Download Kling MP4 → temp file
    const tmp = tmpdir()
    const stamp = Date.now()
    const rand = randomBytes(4).toString('hex')
    const klingPath = join(tmp, `kling-${stamp}-${rand}.mp4`)
    const inspoPath = join(tmp, `inspo-${stamp}-${rand}.mp4`)
    const outPath = join(tmp, `animated-${stamp}-${rand}.mp4`)

    let muxed = true
    let muxNote = ''
    try {
      const klingRes = await fetch(klingUrl)
      if (!klingRes.ok) throw new Error(`Kling video fetch failed (${klingRes.status})`)
      await writeFile(klingPath, Buffer.from(await klingRes.arrayBuffer()))

      // Try to fetch inspo audio source. If no inspoVideoUrl provided or
      // fetch fails, fall back to muxless upload (silent video).
      if (inspoVideoUrl) {
        const inspoRes = await fetch(inspoVideoUrl)
        if (!inspoRes.ok) throw new Error(`Inspo video fetch failed (${inspoRes.status})`)
        await writeFile(inspoPath, Buffer.from(await inspoRes.arrayBuffer()))
        await muxAudio(klingPath, inspoPath, outPath, Math.max(0, Number(audioOffset) || 0))
      } else {
        muxed = false
        muxNote = 'No inspoVideoUrl provided — uploaded silent video.'
      }
    } catch (e) {
      // If muxing fails, fall back to the raw Kling video so the user still
      // gets something rather than a hard fail.
      console.warn('[recreate/animate-status] mux fallback:', e.message)
      muxed = false
      muxNote = `Mux failed: ${e.message}. Uploaded silent Kling output.`
    }

    const finalLocalPath = muxed ? outPath : klingPath
    const finalBuffer = await readFile(finalLocalPath)

    // Upload to Dropbox
    const accessToken = await getDropboxAccessToken()
    const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)
    const folder = `/Palm Ops/Creators/${aka}/recreations/${shortcode}`
    await ensureFolder(accessToken, rootNamespaceId, '/Palm Ops/Creators')
    await ensureFolder(accessToken, rootNamespaceId, `/Palm Ops/Creators/${aka}`)
    await ensureFolder(accessToken, rootNamespaceId, `/Palm Ops/Creators/${aka}/recreations`)
    await ensureFolder(accessToken, rootNamespaceId, folder)

    const filename = `animated-${stamp}.mp4`
    const dropboxPath = `${folder}/${filename}`
    await uploadToDropbox(accessToken, rootNamespaceId, dropboxPath, finalBuffer, { overwrite: true })
    const sharedLink = await createDropboxSharedLink(accessToken, rootNamespaceId, dropboxPath)
    const outputUrl = `${rawDropboxUrl(sharedLink)}&t=${Date.now()}`

    // Cleanup temp files
    await Promise.all([
      unlink(klingPath).catch(() => {}),
      unlink(inspoPath).catch(() => {}),
      unlink(outPath).catch(() => {}),
    ])

    return NextResponse.json({
      status: 'completed',
      outputUrl,
      filename,
      muxed,
      muxNote: muxNote || null,
    })
  } catch (err) {
    console.error('[recreate/animate-status] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
