import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'
import { POSES, AI_REF_FOLDER, outputFilename } from '@/lib/aiCloneConfig'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PALM_CREATORS = 'Palm Creators'

function rawDropboxUrl(url) {
  if (!url) return ''
  return url.replace(/[?&]dl=0/, '').replace(/([?&]raw=1)?$/, '') + (url.includes('?') ? '&raw=1' : '?raw=1')
}

// POST — body: { creatorId, pose, outputUrl }
// Downloads the chosen WaveSpeed output, uploads to Dropbox renamed
// "{Pose Label} AI Reference.{ext}", and attaches to the pose's Airtable
// output field. Replaces any prior approved image for this pose.
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorId, pose, outputUrl } = await request.json()
    if (!creatorId || !pose || !outputUrl) {
      return NextResponse.json({ error: 'Missing creatorId, pose, or outputUrl' }, { status: 400 })
    }
    const poseConfig = POSES[pose]
    if (!poseConfig) return NextResponse.json({ error: 'Invalid pose' }, { status: 400 })

    const records = await fetchAirtableRecords(PALM_CREATORS, {
      filterByFormula: `RECORD_ID() = '${creatorId}'`,
      fields: ['AKA'],
      maxRecords: 1,
    })
    if (!records.length) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
    const aka = records[0].fields.AKA
    if (!aka) return NextResponse.json({ error: 'Creator missing AKA' }, { status: 400 })

    const dl = await fetch(outputUrl)
    if (!dl.ok) throw new Error(`Failed to download WaveSpeed output: ${dl.status}`)
    const buf = Buffer.from(await dl.arrayBuffer())
    const ext = outputUrl.split('?')[0].split('.').pop()?.toLowerCase() || 'jpg'
    const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'jpg'

    const accessToken = await getDropboxAccessToken()
    const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)
    const folder = AI_REF_FOLDER(aka)
    const filename = outputFilename(pose, safeExt)
    const dropboxPath = `${folder}/${filename}`
    await uploadToDropbox(accessToken, rootNamespaceId, dropboxPath, buf, { overwrite: true })
    const sharedLink = await createDropboxSharedLink(accessToken, rootNamespaceId, dropboxPath)
    // Cache-bust: same Dropbox path → same shared link. Without a unique
    // suffix, Airtable dedupes by URL and never re-downloads, so the
    // attachment keeps showing the OLD image even after a regenerate.
    const publicUrl = `${rawDropboxUrl(sharedLink)}&t=${Date.now()}`

    await patchAirtableRecord(PALM_CREATORS, creatorId, {
      [poseConfig.airtableOutputField]: [{ url: publicUrl, filename }],
    })

    return NextResponse.json({
      ok: true,
      output: { url: publicUrl, filename },
    })
  } catch (err) {
    console.error('[creator-ai-clone/approve] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
