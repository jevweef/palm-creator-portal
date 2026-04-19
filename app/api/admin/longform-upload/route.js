export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { requireAdminOrEditor } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'

// POST — download a file from a Google Drive URL and upload to Dropbox Long Form folder
export async function POST(request) {
  try { await requireAdminOrEditor() } catch (e) { return e }

  try {
    const { url, creatorName, fileName } = await request.json()
    if (!url || !creatorName) {
      return NextResponse.json({ error: 'url and creatorName required' }, { status: 400 })
    }

    // Convert Google Drive share URL to direct download URL
    let downloadUrl = url
    const driveMatch = url.match(/drive\.google\.com\/file\/d\/([^/]+)/)
    if (driveMatch) {
      downloadUrl = `https://drive.google.com/uc?export=download&id=${driveMatch[1]}`
    }
    // Also handle docs.google.com/uc? format
    const ucMatch = url.match(/drive\.google\.com\/uc\?.*id=([^&]+)/)
    if (ucMatch) {
      downloadUrl = `https://drive.google.com/uc?export=download&id=${ucMatch[1]}`
    }

    console.log(`[LongForm] Downloading from: ${downloadUrl.substring(0, 80)}...`)

    // Download the file
    const dlRes = await fetch(downloadUrl, { redirect: 'follow' })
    if (!dlRes.ok) throw new Error(`Download failed: ${dlRes.status}`)

    const buffer = Buffer.from(await dlRes.arrayBuffer())
    const size = buffer.length
    console.log(`[LongForm] Downloaded: ${(size / 1024 / 1024).toFixed(1)}MB`)

    if (size > 150 * 1024 * 1024) {
      return NextResponse.json({ error: `File too large (${(size / 1024 / 1024).toFixed(0)}MB). Max 150MB.` }, { status: 400 })
    }

    // Determine filename
    const contentDisp = dlRes.headers.get('content-disposition') || ''
    const cdMatch = contentDisp.match(/filename="?([^";\n]+)/)
    const finalName = fileName || (cdMatch ? cdMatch[1].trim() : `longform_${Date.now()}.mp4`)

    // Upload to Dropbox
    const accessToken = await getDropboxAccessToken()
    const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)
    const dropboxPath = `/Palm Ops/Creators/${creatorName}/Long Form/35_FINALS_FOR_REVIEW/${finalName}`

    console.log(`[LongForm] Uploading to Dropbox: ${dropboxPath}`)
    const result = await uploadToDropbox(accessToken, rootNamespaceId, dropboxPath, buffer)

    // Create share link
    let sharedLink = ''
    try {
      sharedLink = await createDropboxSharedLink(accessToken, rootNamespaceId, result.path_display)
    } catch {}

    return NextResponse.json({
      ok: true,
      name: finalName,
      path: result.path_display,
      size,
      sharedLink,
    })
  } catch (err) {
    console.error('[LongForm] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
