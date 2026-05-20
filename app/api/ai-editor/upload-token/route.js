import { NextResponse } from 'next/server'
import { requireAdminOrAiEditor } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId } from '@/lib/dropbox'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'

// Mints a short-lived Dropbox token + target path so the browser uploads
// the (potentially large) AI reel straight to Dropbox — bypassing the
// serverless request-body limit. Mirrors the /api/upload-token pattern.
export async function POST(request) {
  try {
    await requireAdminOrAiEditor()
    const { reelRecordId } = await request.json()
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
    const path = `/Palm Ops/Recreate Staging/${handle}/output/${reelId}.mp4`

    return NextResponse.json({ accessToken, rootNamespaceId, path })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
