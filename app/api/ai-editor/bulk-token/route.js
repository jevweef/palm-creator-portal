import { NextResponse } from 'next/server'
import { requireAdminOrAiEditor, fetchAirtableRecords } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId } from '@/lib/dropbox'
import { quoteAirtableString } from '@/lib/airtableFormula'

// Existence check for a single Dropbox path. Returns true if a file is
// already there; false on not_found or any error (fail-open — we only use
// this to pick a non-colliding name, and the caller adds a suffix anyway).
async function dropboxPathExists(accessToken, rootNamespaceId, path) {
  try {
    const res = await fetch('https://api.dropboxapi.com/2/files/get_metadata', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root: rootNamespaceId }),
      },
      body: JSON.stringify({ path }),
    })
    return res.ok
  } catch {
    return false
  }
}

// Turn an arbitrary uploaded filename into a Dropbox-safe leaf. Keeps the
// extension, strips path separators + weird chars, caps length.
function safeName(name) {
  const raw = String(name || 'reel.mp4')
  const dot = raw.lastIndexOf('.')
  const ext = dot > 0 ? raw.slice(dot).replace(/[^A-Za-z0-9.]/g, '').slice(0, 8) : '.mp4'
  const base = (dot > 0 ? raw.slice(0, dot) : raw)
    .replace(/[^A-Za-z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'reel'
  return `${base}${ext || '.mp4'}`
}

// Mints a short-lived Dropbox token + target path so the browser uploads a
// finished AI reel straight to Dropbox (bypassing the serverless body
// limit). Unlike /api/ai-editor/upload-token this is NOT tied to a source
// pool reel — it's the standalone "bulk submit finished reels for a
// creator" flow. Path is keyed off the creator's AKA so everything lands in
// that creator's existing Recreate Staging folder, under a Bulk Review
// subfolder, with a collision-safe leaf name.
export async function POST(request) {
  try {
    await requireAdminOrAiEditor()
    const { creatorId, fileName } = await request.json()
    if (!creatorId || !/^rec[A-Za-z0-9]{14}$/.test(creatorId)) {
      return NextResponse.json({ error: 'Valid creatorId required' }, { status: 400 })
    }

    const [creator] = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(creatorId)}`,
      fields: ['AKA', 'Creator'],
    })
    if (!creator) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
    const aka = creator.fields?.AKA || creator.fields?.Creator || 'creator'
    // Match the folder-name sanitizing used elsewhere for AKA-keyed paths.
    const akaSafe = String(aka).replace(/[^A-Za-z0-9-_ ]/g, '').trim() || 'creator'

    const accessToken = await getDropboxAccessToken()
    const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)

    const folder = `/Palm Ops/Recreate Staging/${akaSafe}/Bulk Review`
    const leaf = safeName(fileName)
    // Allocate a non-colliding path: name.mp4, name_2.mp4, name_3.mp4 …
    let path = `${folder}/${leaf}`
    if (await dropboxPathExists(accessToken, rootNamespaceId, path)) {
      const dot = leaf.lastIndexOf('.')
      const base = dot > 0 ? leaf.slice(0, dot) : leaf
      const ext = dot > 0 ? leaf.slice(dot) : '.mp4'
      let n = 2
      // Cap the probe loop; fall back to a timestamp leaf if somehow full.
      for (; n <= 99; n++) {
        const cand = `${folder}/${base}_${n}${ext}`
        if (!(await dropboxPathExists(accessToken, rootNamespaceId, cand))) { path = cand; break }
      }
      if (n > 99) path = `${folder}/${base}_${Date.now()}${ext}`
    }

    return NextResponse.json({ accessToken, rootNamespaceId, path })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
