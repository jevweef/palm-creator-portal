import { NextResponse } from 'next/server'
import { requireAdmin, patchAirtableRecord } from '@/lib/adminAuth'
import {
  getDropboxAccessToken,
  getDropboxRootNamespaceId,
  uploadToDropbox,
  createDropboxSharedLink,
  deleteDropboxFile,
  createDropboxFolder,
} from '@/lib/dropbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const INSPIRATION_TABLE = 'tblnQhATaMtpoYErb'

function rawDropboxUrl(url) {
  if (!url) return ''
  return url.replace(/[?&]dl=0/, '').replace(/([?&]raw=1)?$/, '') + (url.includes('?') ? '&raw=1' : '?raw=1')
}

// Reverse a Dropbox raw shared link back to its team-namespace path so we
// can delete the underlying file. Shared links don't carry the path; instead
// we encode the path on save so we always know where to delete from.
function dropboxPathForShortcode(shortcode, ext) {
  return `/Palm Ops/Inspo Frames/${shortcode}/source-frame.${ext}`
}

async function ensureFolder(accessToken, rootNamespaceId, path) {
  try { await createDropboxFolder(accessToken, rootNamespaceId, path) }
  catch (e) {
    if (!String(e.message || '').includes('path/conflict/folder') &&
        !String(e.message || '').includes('already_exists')) throw e
  }
}

async function nukeAllVariants(accessToken, rootNamespaceId, shortcode) {
  // Delete all known extensions of source-frame.* so a jpg→png swap doesn't
  // leave an orphan, and the saved URL always points to the current bytes.
  const exts = ['jpg', 'png', 'webp']
  await Promise.all(exts.map(ext =>
    deleteDropboxFile(accessToken, rootNamespaceId, dropboxPathForShortcode(shortcode, ext))
      .catch(() => {})  // not_found is expected for unused extensions
  ))
}

// POST — body: { frameDataUrl?, sourceUrl?, inspoRecordId, shortcode }
//   Either frameDataUrl (data:image/...) or sourceUrl (Airtable attachment /
//   Dropbox link the server fetches) is required. Uploads to Dropbox at a
//   stable path, patches Airtable's Recreate Source Frame URL field, and
//   nukes any prior frame variants for this shortcode first.
// DELETE — body: { inspoRecordId, shortcode }
//   Deletes all saved frames for the shortcode and clears Airtable.
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { frameDataUrl, sourceUrl, inspoRecordId, shortcode } = await request.json()
    if (!frameDataUrl && !sourceUrl) return NextResponse.json({ error: 'Missing frameDataUrl or sourceUrl' }, { status: 400 })
    if (!inspoRecordId) return NextResponse.json({ error: 'Missing inspoRecordId' }, { status: 400 })
    if (!shortcode) return NextResponse.json({ error: 'Missing shortcode' }, { status: 400 })

    let buf, safeExt
    if (frameDataUrl) {
      const match = frameDataUrl.match(/^data:image\/([a-z]+);base64,(.+)$/i)
      if (!match) return NextResponse.json({ error: 'Invalid frameDataUrl (expected base64 data URL)' }, { status: 400 })
      const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase()
      safeExt = ['jpg', 'png', 'webp'].includes(ext) ? ext : 'jpg'
      buf = Buffer.from(match[2], 'base64')
    } else {
      const fetchRes = await fetch(sourceUrl)
      if (!fetchRes.ok) return NextResponse.json({ error: `Source fetch failed (${fetchRes.status})` }, { status: 400 })
      const arrayBuf = await fetchRes.arrayBuffer()
      buf = Buffer.from(arrayBuf)
      const contentType = fetchRes.headers.get('content-type') || ''
      const m = contentType.match(/^image\/([a-z]+)/i)
      const ext = m ? (m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase()) : 'jpg'
      safeExt = ['jpg', 'png', 'webp'].includes(ext) ? ext : 'jpg'
    }

    const accessToken = await getDropboxAccessToken()
    const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)

    await ensureFolder(accessToken, rootNamespaceId, '/Palm Ops/Inspo Frames')
    await ensureFolder(accessToken, rootNamespaceId, `/Palm Ops/Inspo Frames/${shortcode}`)

    await nukeAllVariants(accessToken, rootNamespaceId, shortcode)

    const dropboxPath = dropboxPathForShortcode(shortcode, safeExt)
    await uploadToDropbox(accessToken, rootNamespaceId, dropboxPath, buf, { overwrite: true })
    const sharedLink = await createDropboxSharedLink(accessToken, rootNamespaceId, dropboxPath)
    const url = `${rawDropboxUrl(sharedLink)}&t=${Date.now()}`

    await patchAirtableRecord(INSPIRATION_TABLE, inspoRecordId, {
      'Recreate Source Frame URL': url,
    })

    return NextResponse.json({ ok: true, url, path: dropboxPath })
  } catch (err) {
    console.error('[recreate/save-frame] error:', err)
    return NextResponse.json({ error: err.message || 'Save failed' }, { status: 500 })
  }
}

export async function DELETE(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { inspoRecordId, shortcode } = await request.json()
    if (!inspoRecordId) return NextResponse.json({ error: 'Missing inspoRecordId' }, { status: 400 })

    if (shortcode) {
      const accessToken = await getDropboxAccessToken()
      const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)
      await nukeAllVariants(accessToken, rootNamespaceId, shortcode)
    }

    await patchAirtableRecord(INSPIRATION_TABLE, inspoRecordId, {
      'Recreate Source Frame URL': '',
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[recreate/save-frame] DELETE error:', err)
    return NextResponse.json({ error: err.message || 'Delete failed' }, { status: 500 })
  }
}
