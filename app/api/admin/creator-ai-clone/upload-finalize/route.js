import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, createDropboxSharedLink } from '@/lib/dropbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PALM_CREATORS = 'Palm Creators'

function rawDropboxUrl(url) {
  if (!url) return ''
  return url.replace(/[?&]dl=0/, '').replace(/([?&]raw=1)?$/, '') + (url.includes('?') ? '&raw=1' : '?raw=1')
}

// POST — body: { creatorId, paths: [{ path, filename }] }
// After the browser uploads files directly to Dropbox, the client calls
// this to (1) create shared links for each file and (2) append them to
// the creator's AI Ref Inputs Airtable field.
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const { creatorId, paths } = await request.json()
    if (!creatorId || !Array.isArray(paths) || !paths.length) {
      return NextResponse.json({ error: 'Missing creatorId or paths' }, { status: 400 })
    }

    const records = await fetchAirtableRecords(PALM_CREATORS, {
      filterByFormula: `RECORD_ID() = '${creatorId}'`,
      fields: ['AI Ref Inputs'],
      maxRecords: 1,
    })
    if (!records.length) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })

    const accessToken = await getDropboxAccessToken()
    const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)

    const newAttachments = []
    for (const { path, filename } of paths) {
      try {
        const sharedLink = await createDropboxSharedLink(accessToken, rootNamespaceId, path)
        newAttachments.push({ url: rawDropboxUrl(sharedLink), filename })
      } catch (e) {
        console.error('[upload-finalize] shared link failed for', path, e.message)
      }
    }

    if (!newAttachments.length) {
      return NextResponse.json({ error: 'No shared links could be created' }, { status: 500 })
    }

    const existing = records[0].fields['AI Ref Inputs'] || []
    const updated = [
      ...existing.map(att => ({ url: att.url, filename: att.filename })),
      ...newAttachments,
    ]
    await patchAirtableRecord(PALM_CREATORS, creatorId, { 'AI Ref Inputs': updated })

    return NextResponse.json({ ok: true, added: newAttachments.length })
  } catch (err) {
    console.error('[creator-ai-clone/upload-finalize] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
