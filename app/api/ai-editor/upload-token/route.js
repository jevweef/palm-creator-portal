import { NextResponse } from 'next/server'
import { requireAdminOrAiEditor } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId } from '@/lib/dropbox'
import { parseSlug } from '@/lib/recreateSlug'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'

// Existence check for a single Dropbox path. Returns true if a file/folder
// is already there, false on path/not_found (409) or any other error
// (fail-open: a rare overwrite beats blocking the upload outright).
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

// Mints a short-lived Dropbox token + target path so the browser uploads
// the (potentially large) AI reel straight to Dropbox — bypassing the
// serverless request-body limit.
//
// CRITICAL: when a slug is provided, the path is keyed off the slug
// (one file per variant) — NOT off the reel ID. Without this, every
// outfit variant uploaded for the same reel would target the same
// Dropbox path and overwrite each other. Pre-slug callers (legacy
// single-upload flow without a slug-named file) fall back to the old
// "{handle}/output/{reelId}.mp4" path.
//
// COLLISION SAFETY: the freelance batch flow hands the SAME project slug
// to every file in a multi-file submit. Without disambiguation each file
// targets the same "{Aka}/{slug}.mp4" path and — because the browser PUTs
// with mode:'overwrite' — clobbers the previous one, leaving N review
// cards that all point at the last-written video (the "3 of the same"
// bug). To prevent that we check Dropbox before minting the path: if the
// requested slug's file already exists, allocate the next free
// "{slug}_O{nn}" variant (the documented per-still variant convention —
// see lib/recreateSlug). The RESOLVED slug is returned as `slug` so the
// caller names the Asset/Task after the file it actually wrote. Allocation
// is race-free for the sequential freelance batch (each file is PUT before
// the next token request) but assumes callers don't fan out concurrently
// against the same base slug.
export async function POST(request) {
  try {
    await requireAdminOrAiEditor()
    const { reelRecordId, slug } = await request.json()
    if (!reelRecordId || !/^rec[A-Za-z0-9]{14}$/.test(reelRecordId)) {
      return NextResponse.json({ error: 'Valid reelRecordId required' }, { status: 400 })
    }

    const res = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/Recreate%20Reels/${reelRecordId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
    )
    if (!res.ok) return NextResponse.json({ error: 'Reel not found' }, { status: 404 })
    const f = (await res.json()).fields || {}
    const handle = f['Source Handle'] || 'account'
    const reelId = f['Reel ID'] || reelRecordId

    const accessToken = await getDropboxAccessToken()
    const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)

    // Slug-based path keeps every variant unique on disk and matches the
    // editor's local filenames after unzipping a Stage B bulk ZIP.
    const parsed = slug ? parseSlug(slug) : null
    let resolvedSlug = slug || null
    let path
    if (parsed) {
      const folder = `/Palm Ops/Recreate Staging/${parsed.aka}`
      // Take the requested slug as-is if its file is free. Otherwise the
      // path is already taken — allocate the next free "{base}_O{nn}"
      // variant off the still slug (stripping any _O the caller already
      // carried) so we never overwrite an existing upload.
      if (!(await dropboxPathExists(accessToken, rootNamespaceId, `${folder}/${slug}.mp4`))) {
        resolvedSlug = slug
      } else {
        const base = slug.replace(/_O\d{1,3}$/, '')
        resolvedSlug = null
        for (let n = 1; n <= 99; n++) {
          const cand = `${base}_O${String(n).padStart(2, '0')}`
          if (cand === slug) continue // already known taken
          if (!(await dropboxPathExists(accessToken, rootNamespaceId, `${folder}/${cand}.mp4`))) {
            resolvedSlug = cand
            break
          }
        }
        // Pathological fallback (99 variants taken) — timestamp suffix so
        // the upload still lands on a unique path instead of overwriting.
        if (!resolvedSlug) resolvedSlug = `${base}_O${Date.now()}`
      }
      path = `${folder}/${resolvedSlug}.mp4`
    } else {
      path = `/Palm Ops/Recreate Staging/${handle}/output/${reelId}.mp4`
    }

    return NextResponse.json({ accessToken, rootNamespaceId, path, slug: resolvedSlug })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
