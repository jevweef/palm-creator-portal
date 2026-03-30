import { NextResponse } from 'next/server'
import { getDropboxAccessToken, getDropboxRootNamespaceId } from '@/lib/dropbox'

export async function POST() {
  try {
    const accessToken = await getDropboxAccessToken()
    const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)

    return NextResponse.json({ accessToken, rootNamespaceId })
  } catch (err) {
    console.error('[editor-upload-token] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
