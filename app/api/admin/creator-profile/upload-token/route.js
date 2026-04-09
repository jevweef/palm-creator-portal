import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId } from '@/lib/dropbox'

export const dynamic = 'force-dynamic'

// GET /api/admin/creator-profile/upload-token?creatorName=Taby
// Returns a short-lived Dropbox access token + namespace ID so the
// browser can upload large files directly to Dropbox (bypasses Vercel body limit).
export async function GET(request) {
  try {
    await requireAdmin()

    const { searchParams } = new URL(request.url)
    const creatorName = searchParams.get('creatorName') || 'unknown'
    const safeName = creatorName.replace(/[^a-zA-Z0-9 _-]/g, '_')

    const token = await getDropboxAccessToken()
    const namespaceId = await getDropboxRootNamespaceId(token)

    return NextResponse.json({
      accessToken: token,
      namespaceId,
      uploadPathPrefix: `/Palm Ops/Creator Profiles/${safeName}`,
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('Upload token error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
