import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'
import { pollWaveSpeedTask } from '@/lib/wavespeed'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'
import { POSES, AI_REF_FOLDER, candidateFilename } from '@/lib/aiCloneConfig'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PALM_CREATORS = 'Palm Creators'

function rawDropboxUrl(url) {
  if (!url) return ''
  return url.replace(/[?&]dl=0/, '').replace(/([?&]raw=1)?$/, '') + (url.includes('?') ? '&raw=1' : '?raw=1')
}

async function ensureFolder(accessToken, rootNamespaceId, path) {
  const res = await fetch('https://api.dropboxapi.com/2/files/create_folder_v2', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root: rootNamespaceId }),
    },
    body: JSON.stringify({ path, autorename: false }),
  })
  if (res.ok) return
  const text = await res.text()
  if (text.includes('path/conflict/folder') || text.includes('already_exists') || res.status === 409) return
  throw new Error(`Dropbox folder create failed (${res.status}): ${text}`)
}

// POST — body: { taskId, creatorId, pose }
// Polls WaveSpeed. On 'completed', persists the output IMMEDIATELY to
// Dropbox + Airtable Candidates field so a page refresh doesn't lose
// the (already-paid-for) generation. Returns { status, candidate? }.
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { taskId, creatorId, pose } = await request.json()
    if (!taskId) return NextResponse.json({ error: 'Missing taskId' }, { status: 400 })

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

    // Need creatorId + pose to save. If missing (older clients), just return URL.
    if (!creatorId || !pose) {
      return NextResponse.json({ status: 'completed', outputUrl })
    }
    const poseConfig = POSES[pose]
    if (!poseConfig) {
      return NextResponse.json({ status: 'completed', outputUrl })
    }

    // Save the candidate to Dropbox + Airtable so it persists
    const records = await fetchAirtableRecords(PALM_CREATORS, {
      filterByFormula: `RECORD_ID() = '${creatorId}'`,
      fields: ['AKA', poseConfig.airtableCandidatesField],
      maxRecords: 1,
    })
    if (!records.length) {
      return NextResponse.json({ status: 'completed', outputUrl, error: 'Creator not found, returning unsaved URL' })
    }
    const aka = records[0].fields.AKA
    if (!aka) {
      return NextResponse.json({ status: 'completed', outputUrl, error: 'Creator missing AKA' })
    }

    // Avoid double-saving the same task — if the task ID already maps to a
    // saved candidate (filename includes the task id suffix), skip.
    const existingCandidates = records[0].fields[poseConfig.airtableCandidatesField] || []
    if (existingCandidates.some(att => att.filename?.includes(taskId.slice(0, 8)))) {
      return NextResponse.json({ status: 'completed', candidate: existingCandidates.find(att => att.filename?.includes(taskId.slice(0, 8))) })
    }

    const dl = await fetch(outputUrl)
    if (!dl.ok) throw new Error(`Failed to download WaveSpeed output: ${dl.status}`)
    const buf = Buffer.from(await dl.arrayBuffer())
    const ext = outputUrl.split('?')[0].split('.').pop()?.toLowerCase() || 'jpg'
    const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'jpg'

    const accessToken = await getDropboxAccessToken()
    const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)
    const folder = AI_REF_FOLDER(aka)
    const candidatesFolder = `${folder}/candidates`
    await ensureFolder(accessToken, rootNamespaceId, candidatesFolder)

    // Use max existing candidate index + 1 — append, don't replace
    const labelEsc = poseConfig.fileLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const indexRe = new RegExp(`^${labelEsc} Candidate (\\d+)`)
    const indices = existingCandidates
      .map(att => { const m = att.filename?.match(indexRe); return m ? parseInt(m[1], 10) : 0 })
      .filter(n => n > 0)
    const nextIndex = (indices.length ? Math.max(...indices) : 0) + 1

    // Filename includes a short task-ID suffix so we can dedupe re-polls
    const filename = `${poseConfig.fileLabel} Candidate ${nextIndex} (${taskId.slice(0, 8)}).${safeExt}`
    const dropboxPath = `${candidatesFolder}/${filename}`
    await uploadToDropbox(accessToken, rootNamespaceId, dropboxPath, buf, { overwrite: true })
    const sharedLink = await createDropboxSharedLink(accessToken, rootNamespaceId, dropboxPath)
    const publicUrl = `${rawDropboxUrl(sharedLink)}&t=${Date.now()}`

    const updatedCandidates = [
      ...existingCandidates.map(att => ({ url: att.url, filename: att.filename })),
      { url: publicUrl, filename },
    ]
    await patchAirtableRecord(PALM_CREATORS, creatorId, {
      [poseConfig.airtableCandidatesField]: updatedCandidates,
    })

    return NextResponse.json({
      status: 'completed',
      candidate: { url: publicUrl, filename },
    })
  } catch (err) {
    console.error('[creator-ai-clone/poll] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
