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

    // Extract Google Drive file ID from various URL formats
    let fileId = null
    const patterns = [
      /drive\.google\.com\/file\/d\/([^/?]+)/,
      /drive\.google\.com\/open\?id=([^&]+)/,
      /drive\.google\.com\/uc\?.*id=([^&]+)/,
    ]
    for (const p of patterns) {
      const m = url.match(p)
      if (m) { fileId = m[1]; break }
    }

    if (!fileId) {
      return NextResponse.json({ error: 'Could not extract Google Drive file ID from URL' }, { status: 400 })
    }

    console.log(`[LongForm] Google Drive file ID: ${fileId}`)

    // Use the confirm=t parameter to bypass the virus scan warning for large files
    const downloadUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`
    console.log(`[LongForm] Downloading from: ${downloadUrl}`)

    const dlRes = await fetch(downloadUrl, { redirect: 'follow' })
    if (!dlRes.ok) throw new Error(`Download failed: ${dlRes.status}`)

    const contentType = dlRes.headers.get('content-type') || ''
    console.log(`[LongForm] Content-Type: ${contentType}`)

    let buffer = Buffer.from(await dlRes.arrayBuffer())
    let size = buffer.length
    console.log(`[LongForm] Downloaded: ${(size / 1024 / 1024).toFixed(2)}MB`)

    // If we got HTML back (confirmation page), try to extract the confirmation token and retry
    if (contentType.includes('text/html')) {
      const html = buffer.toString('utf8')
      // Look for UUID confirmation token in the form
      const uuidMatch = html.match(/name="uuid"\s+value="([^"]+)"/)
      const confirmMatch = html.match(/name="confirm"\s+value="([^"]+)"/)

      if (uuidMatch || confirmMatch) {
        const params = new URLSearchParams({ id: fileId, export: 'download' })
        if (uuidMatch) params.set('uuid', uuidMatch[1])
        if (confirmMatch) params.set('confirm', confirmMatch[1])
        const retryUrl = `https://drive.usercontent.google.com/download?${params.toString()}`
        console.log(`[LongForm] Retrying with confirmation: ${retryUrl}`)

        const retryRes = await fetch(retryUrl, { redirect: 'follow' })
        if (!retryRes.ok) throw new Error(`Retry download failed: ${retryRes.status}`)
        buffer = Buffer.from(await retryRes.arrayBuffer())
        size = buffer.length
        console.log(`[LongForm] Retry downloaded: ${(size / 1024 / 1024).toFixed(2)}MB`)

        // Check again — if still HTML, we failed
        if (buffer.slice(0, 15).toString() === '<!DOCTYPE html>' || buffer.slice(0, 5).toString() === '<html') {
          throw new Error('Google Drive returned HTML after confirmation retry. The file may not be publicly accessible. Make sure the share link is set to "Anyone with the link".')
        }
      } else {
        throw new Error('Google Drive returned HTML instead of the file. Make sure the share link is set to "Anyone with the link" and the file is publicly accessible.')
      }
    }

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
