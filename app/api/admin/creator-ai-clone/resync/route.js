import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, createDropboxSharedLink } from '@/lib/dropbox'
import { POSES, AI_REF_FOLDER, outputFilename } from '@/lib/aiCloneConfig'

export const dynamic = 'force-dynamic'

const PALM_CREATORS = 'Palm Creators'

function rawDropboxUrl(url) {
  if (!url) return ''
  return url.replace(/[?&]dl=0/, '').replace(/([?&]raw=1)?$/, '') + (url.includes('?') ? '&raw=1' : '?raw=1')
}

// POST — body: { creatorId, pose }
// Re-attaches the canonical Dropbox file to the Airtable output field with
// a cache-busted URL. Use when:
//   1. The Dropbox file was edited or replaced manually outside the app
//   2. An attachment was created before cache-busting shipped and Airtable
//      is still serving the cached old content
async function tryExt(accessToken, rootNamespaceId, folder, pose, exts) {
  for (const ext of exts) {
    const filename = outputFilename(pose, ext)
    try {
      const link = await createDropboxSharedLink(accessToken, rootNamespaceId, `${folder}/${filename}`)
      return { filename, link }
    } catch (e) {
      // not_found → try next extension
      continue
    }
  }
  return null
}

export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorId, pose } = await request.json()
    if (!creatorId || !pose) return NextResponse.json({ error: 'Missing creatorId or pose' }, { status: 400 })
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

    const accessToken = await getDropboxAccessToken()
    const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)
    const folder = AI_REF_FOLDER(aka)

    // We don't know the extension up-front (could be .jpg/.png/.webp/.jpeg).
    // Try each in order.
    const found = await tryExt(accessToken, rootNamespaceId, folder, pose, ['png', 'jpg', 'jpeg', 'webp'])
    if (!found) {
      return NextResponse.json({ error: `No "${POSES[pose].fileLabel} AI Reference" file found in Dropbox at ${folder}` }, { status: 404 })
    }

    const publicUrl = `${rawDropboxUrl(found.link)}&t=${Date.now()}`
    await patchAirtableRecord(PALM_CREATORS, creatorId, {
      [poseConfig.airtableOutputField]: [{ url: publicUrl, filename: found.filename }],
    })

    return NextResponse.json({ ok: true, filename: found.filename })
  } catch (err) {
    console.error('[creator-ai-clone/resync] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
