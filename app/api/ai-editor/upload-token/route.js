import { NextResponse } from 'next/server'
import { requireAdminOrAiEditor } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId } from '@/lib/dropbox'
import { parseSlug } from '@/lib/recreateSlug'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'

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
    const path = parsed
      ? `/Palm Ops/Recreate Staging/${parsed.aka}/${slug}.mp4`
      : `/Palm Ops/Recreate Staging/${handle}/output/${reelId}.mp4`

    return NextResponse.json({ accessToken, rootNamespaceId, path })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
