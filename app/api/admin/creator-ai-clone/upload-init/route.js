import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId } from '@/lib/dropbox'
import { POSES, AI_REF_FOLDER } from '@/lib/aiCloneConfig'

export const dynamic = 'force-dynamic'

const PALM_CREATORS = 'Palm Creators'

// POST — body: { creatorId, pose }
// Returns a short-lived Dropbox access token + namespace + folder path +
// the starting auto-name index for this pose. The browser uses this to
// upload files directly to Dropbox, bypassing Vercel's 4.5MB body limit.
// Token TTL is ~4h. Admin-only.
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const { creatorId, pose } = await request.json()
    if (!creatorId || !pose) return NextResponse.json({ error: 'Missing creatorId or pose' }, { status: 400 })
    const poseConfig = POSES[pose]
    if (!poseConfig) return NextResponse.json({ error: 'Invalid pose' }, { status: 400 })

    const records = await fetchAirtableRecords(PALM_CREATORS, {
      filterByFormula: `RECORD_ID() = '${creatorId}'`,
      fields: ['AKA', 'AI Ref Inputs'],
      maxRecords: 1,
    })
    if (!records.length) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
    const aka = records[0].fields.AKA
    if (!aka) return NextResponse.json({ error: 'Creator missing AKA' }, { status: 400 })

    const existing = records[0].fields['AI Ref Inputs'] || []
    const labelEsc = poseConfig.fileLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const indexRe = new RegExp(`^${labelEsc} input_(\\d+)`)
    const indices = existing
      .map(att => { const m = att.filename?.match(indexRe); return m ? parseInt(m[1], 10) : 0 })
      .filter(n => n > 0)
    const startIndex = (indices.length ? Math.max(...indices) : 0) + 1

    const accessToken = await getDropboxAccessToken()
    const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)

    return NextResponse.json({
      accessToken,
      rootNamespaceId,
      folder: AI_REF_FOLDER(aka),
      startIndex,
      poseLabel: poseConfig.fileLabel,
    })
  } catch (err) {
    console.error('[creator-ai-clone/upload-init] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
