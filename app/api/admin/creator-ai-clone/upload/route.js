import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'
import { POSES, AI_REF_FOLDER, inputFilename } from '@/lib/aiCloneConfig'

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
  // already-exists is fine
  if (text.includes('path/conflict/folder') || text.includes('already_exists')) return
  if (res.status === 409) return
  throw new Error(`Dropbox folder create failed (${res.status}): ${text}`)
}

// POST — body: FormData with creatorId, pose, files[]
// Auto-renames each file to "{Pose Label} input_{N}.{ext}" and appends to
// the shared AI Ref Inputs Airtable field.
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const form = await request.formData()
    const creatorId = form.get('creatorId')
    const pose = form.get('pose')
    const files = form.getAll('files')

    if (!creatorId) return NextResponse.json({ error: 'Missing creatorId' }, { status: 400 })
    if (!POSES[pose]) return NextResponse.json({ error: 'Invalid pose' }, { status: 400 })
    if (!files.length) return NextResponse.json({ error: 'No files' }, { status: 400 })

    // Look up creator AKA + existing inputs
    const records = await fetchAirtableRecords(PALM_CREATORS, {
      filterByFormula: `RECORD_ID() = '${creatorId}'`,
      fields: ['AKA', 'AI Ref Inputs'],
      maxRecords: 1,
    })
    if (!records.length) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
    const record = records[0]
    const aka = record.fields.AKA
    if (!aka) return NextResponse.json({ error: 'Creator missing AKA' }, { status: 400 })

    const existing = record.fields['AI Ref Inputs'] || []
    const poseFilePrefix = `${POSES[pose].fileLabel} input_`
    const existingForPose = existing.filter(att => att.filename?.startsWith(poseFilePrefix))
    let nextIndex = existingForPose.length + 1

    // Dropbox setup
    const accessToken = await getDropboxAccessToken()
    const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)
    const folder = AI_REF_FOLDER(aka)
    await ensureFolder(accessToken, rootNamespaceId, '/Palm Ops/Creators')
    await ensureFolder(accessToken, rootNamespaceId, `/Palm Ops/Creators/${aka}`)
    await ensureFolder(accessToken, rootNamespaceId, folder)

    const newAttachments = []
    for (const file of files) {
      if (!file || typeof file === 'string') continue
      const buf = Buffer.from(await file.arrayBuffer())
      const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase()
      const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext) ? ext : 'jpg'
      const newName = inputFilename(pose, nextIndex++, safeExt)
      const dropboxPath = `${folder}/${newName}`
      await uploadToDropbox(accessToken, rootNamespaceId, dropboxPath, buf, { overwrite: true })
      const sharedLink = await createDropboxSharedLink(accessToken, rootNamespaceId, dropboxPath)
      newAttachments.push({ url: rawDropboxUrl(sharedLink), filename: newName })
    }

    // Append to Airtable AI Ref Inputs (preserve existing)
    const updatedAttachments = [
      ...existing.map(att => ({ url: att.url, filename: att.filename })),
      ...newAttachments,
    ]
    await patchAirtableRecord(PALM_CREATORS, creatorId, { 'AI Ref Inputs': updatedAttachments })

    return NextResponse.json({ ok: true, added: newAttachments.length, attachments: newAttachments })
  } catch (err) {
    console.error('[creator-ai-clone/upload] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
