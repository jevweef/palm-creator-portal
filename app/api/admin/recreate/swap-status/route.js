import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { pollWaveSpeedTask } from '@/lib/wavespeed'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'
import { stripImageMetadata } from '@/lib/stripImageMetadata'

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

// POST — body: { taskId, creatorId, shortcode? }
// Polls Wan 2.7 task. On 'completed', downloads + strips metadata + uploads
// to Dropbox under the creator's recreations folder, returns the saved URL.
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { taskId, creatorId, shortcode } = await request.json()
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

    // No creatorId means just return the WaveSpeed URL (caller persists)
    if (!creatorId) {
      return NextResponse.json({ status: 'completed', outputUrl })
    }

    const records = await fetchAirtableRecords(PALM_CREATORS, {
      filterByFormula: `RECORD_ID() = '${creatorId}'`,
      fields: ['AKA'],
      maxRecords: 1,
    })
    if (!records.length) return NextResponse.json({ status: 'completed', outputUrl, error: 'Creator not found, returning unsaved URL' })
    const aka = records[0].fields.AKA
    if (!aka) return NextResponse.json({ status: 'completed', outputUrl, error: 'Creator missing AKA' })

    // Download from WaveSpeed, strip metadata
    const dl = await fetch(outputUrl)
    if (!dl.ok) throw new Error(`Failed to download WaveSpeed output: ${dl.status}`)
    const rawBuf = Buffer.from(await dl.arrayBuffer())
    const ext = outputUrl.split('?')[0].split('.').pop()?.toLowerCase() || 'jpg'
    const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? (ext === 'jpeg' ? 'jpg' : ext) : 'jpg'
    const buf = await stripImageMetadata(rawBuf, safeExt)

    // Upload to Dropbox under creator's recreations folder
    const accessToken = await getDropboxAccessToken()
    const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)
    const folder = `/Palm Ops/Creators/${aka}/recreations${shortcode ? `/${shortcode}` : ''}`
    await ensureFolder(accessToken, rootNamespaceId, '/Palm Ops/Creators')
    await ensureFolder(accessToken, rootNamespaceId, `/Palm Ops/Creators/${aka}`)
    await ensureFolder(accessToken, rootNamespaceId, `/Palm Ops/Creators/${aka}/recreations`)
    if (shortcode) await ensureFolder(accessToken, rootNamespaceId, folder)

    const filename = `swap-${Date.now()}.${safeExt}`
    const dropboxPath = `${folder}/${filename}`
    await uploadToDropbox(accessToken, rootNamespaceId, dropboxPath, buf, { overwrite: true })
    const sharedLink = await createDropboxSharedLink(accessToken, rootNamespaceId, dropboxPath)
    const publicUrl = `${rawDropboxUrl(sharedLink)}&t=${Date.now()}`

    return NextResponse.json({
      status: 'completed',
      outputUrl: publicUrl,
      filename,
    })
  } catch (err) {
    console.error('[recreate/swap-status] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
