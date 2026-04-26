import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'
import { pollWaveSpeedTask } from '@/lib/wavespeed'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'
import { POSES, AI_REF_FOLDER, outputFilename } from '@/lib/aiCloneConfig'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PALM_CREATORS = 'Palm Creators'

function rawDropboxUrl(url) {
  if (!url) return ''
  return url.replace(/[?&]dl=0/, '').replace(/([?&]raw=1)?$/, '') + (url.includes('?') ? '&raw=1' : '?raw=1')
}

// POST — body: { creatorId, pose, taskId }
// Polls WaveSpeed once. If completed, downloads the output, uploads to
// Dropbox renamed as "{Pose Label} AI Reference.{ext}", and attaches to the
// pose-specific Airtable output field. Returns current status either way.
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorId, pose, taskId } = await request.json()
    if (!creatorId || !pose || !taskId) {
      return NextResponse.json({ error: 'Missing creatorId, pose, or taskId' }, { status: 400 })
    }
    const poseConfig = POSES[pose]
    if (!poseConfig) return NextResponse.json({ error: 'Invalid pose' }, { status: 400 })

    const task = await pollWaveSpeedTask(taskId)

    if (task.status === 'failed') {
      return NextResponse.json({ status: 'failed', error: task.error || 'WaveSpeed task failed' })
    }
    if (task.status !== 'completed') {
      return NextResponse.json({ status: task.status })
    }

    const outputUrl = (task.outputs || [])[0]
    if (!outputUrl) {
      return NextResponse.json({ status: 'failed', error: 'Task completed but no output URL' })
    }

    // Look up creator AKA to know where in Dropbox
    const records = await fetchAirtableRecords(PALM_CREATORS, {
      filterByFormula: `RECORD_ID() = '${creatorId}'`,
      fields: ['AKA'],
      maxRecords: 1,
    })
    if (!records.length) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
    const aka = records[0].fields.AKA
    if (!aka) return NextResponse.json({ error: 'Creator missing AKA' }, { status: 400 })

    // Download from WaveSpeed
    const dl = await fetch(outputUrl)
    if (!dl.ok) throw new Error(`Failed to download WaveSpeed output: ${dl.status}`)
    const buf = Buffer.from(await dl.arrayBuffer())
    const ext = outputUrl.split('?')[0].split('.').pop()?.toLowerCase() || 'jpg'
    const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'jpg'

    // Upload to Dropbox renamed
    const accessToken = await getDropboxAccessToken()
    const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)
    const folder = AI_REF_FOLDER(aka)
    const filename = outputFilename(pose, safeExt)
    const dropboxPath = `${folder}/${filename}`
    await uploadToDropbox(accessToken, rootNamespaceId, dropboxPath, buf, { overwrite: true })
    const sharedLink = await createDropboxSharedLink(accessToken, rootNamespaceId, dropboxPath)
    const publicUrl = rawDropboxUrl(sharedLink)

    // Attach to Airtable output field (replaces any prior approved output)
    await patchAirtableRecord(PALM_CREATORS, creatorId, {
      [poseConfig.airtableOutputField]: [{ url: publicUrl, filename }],
    })

    return NextResponse.json({
      status: 'completed',
      output: { url: publicUrl, filename },
    })
  } catch (err) {
    console.error('[creator-ai-clone/poll] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
