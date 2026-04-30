export const dynamic = 'force-dynamic'
// Each tick processes ONE asset to its full completion. Heavy 4K source can
// take 90-180s of ffmpeg + 10s download + 10s upload — well inside 300s with
// no risk of partial work.
export const maxDuration = 300

import { NextResponse } from 'next/server'
import {
  fetchAirtableRecords,
  patchAirtableRecord,
  requireAdminOrSocialMedia,
} from '@/lib/adminAuth'
import {
  getDropboxAccessToken,
  getDropboxRootNamespaceId,
  uploadToDropbox,
  createDropboxSharedLink,
  createDropboxFolder,
} from '@/lib/dropbox'
import { makeTelegramReady, TELEGRAM_MAX_BYTES } from '@/lib/videoCompress'

const COMPRESSED_FOLDER = '/Palm Ops/Compressed for Telegram'

function rawDropboxUrl(url) {
  if (!url) return ''
  const clean = url
    .replace(/[?&]dl=0/, '')
    .replace(/[?&]raw=1/, '')
    .replace(/[?&]dl=1/, '')
  return clean + (clean.includes('?') ? '&raw=1' : '?raw=1')
}

function isVideo(url) {
  return /\.(mp4|mov|avi|webm|mkv)/i.test(url || '')
}

function getFilename(url) {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').pop() || 'video.mp4'
    return decodeURIComponent(last)
  } catch {
    return 'video.mp4'
  }
}

// Process ONE asset: download → makeTelegramReady → upload compressed to
// Dropbox → set Compressed File Link + Compress Status='Done' on the asset.
async function processOneAsset(asset) {
  const f = asset.fields || {}
  const editedFileLink = f['Edited File Link'] || f['Dropbox Shared Link']
  if (!editedFileLink) {
    return { assetId: asset.id, status: 'Skip', reason: 'no edited file link' }
  }
  if (!isVideo(editedFileLink)) {
    return { assetId: asset.id, status: 'Skip', reason: 'not a video' }
  }

  // Mark Compressing so concurrent ticks don't pick the same asset.
  await patchAirtableRecord('Assets', asset.id, {
    'Compress Status': 'Compressing',
  }, { typecast: true })

  try {
    // Download the source.
    const downloadRes = await fetch(rawDropboxUrl(editedFileLink), {
      redirect: 'follow',
    })
    if (!downloadRes.ok) {
      throw new Error(`Dropbox download failed (${downloadRes.status})`)
    }
    const sourceBuffer = await downloadRes.arrayBuffer()
    const filename = getFilename(editedFileLink)
    const sourceMB = (sourceBuffer.byteLength / 1024 / 1024).toFixed(1)
    console.log(`[Compress] ${asset.id} source ${sourceMB}MB ${filename}`)

    // Run the same pipeline the send route used to do inline.
    const ready = await makeTelegramReady(sourceBuffer, filename)
    const finalMB = (ready.buffer.length / 1024 / 1024).toFixed(1)
    console.log(`[Compress] ${asset.id} ready ${finalMB}MB ${ready.filename}`)

    // If source was already small enough AND already MP4, makeTelegramReady
    // returns the source bytes unchanged — no need to upload a duplicate
    // copy. Just point Compressed File Link at the existing Edited File Link.
    if (ready.buffer.length === sourceBuffer.byteLength && /\.mp4$/i.test(filename)) {
      await patchAirtableRecord('Assets', asset.id, {
        'Compressed File Link': editedFileLink,
        'Compress Status': 'Done',
      }, { typecast: true })
      return { assetId: asset.id, status: 'Done', reused: true, finalMB: parseFloat(finalMB) }
    }

    // Upload compressed copy to Dropbox alongside the original. Use a
    // dedicated folder so we can clean these up later if needed.
    const accessToken = await getDropboxAccessToken()
    const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)
    await createDropboxFolder(accessToken, rootNamespaceId, COMPRESSED_FOLDER)
    const baseName = ready.filename.replace(/\.[^.]+$/, '').replace(/[^\w.\-]/g, '_')
    const ts = Date.now()
    const path = `${COMPRESSED_FOLDER}/${asset.id}-${ts}-${baseName}.mp4`
    await uploadToDropbox(accessToken, rootNamespaceId, path, ready.buffer)
    const sharedLink = await createDropboxSharedLink(accessToken, rootNamespaceId, path)

    await patchAirtableRecord('Assets', asset.id, {
      'Compressed File Link': sharedLink,
      'Compress Status': 'Done',
    }, { typecast: true })

    return { assetId: asset.id, status: 'Done', sourceMB: parseFloat(sourceMB), finalMB: parseFloat(finalMB) }
  } catch (err) {
    console.error(`[Compress] ${asset.id} failed:`, err.message)
    await patchAirtableRecord('Assets', asset.id, {
      'Compress Status': 'Failed',
    }, { typecast: true }).catch(() => {})
    return { assetId: asset.id, status: 'Failed', error: err.message }
  }
}

export async function GET(request) {
  // Same auth pattern as telegram-queue: cron secret OR admin auth.
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  const actualAuth = request.headers.get('authorization')
  const isCronCall = expectedAuth && actualAuth === expectedAuth
  if (!isCronCall) {
    try { await requireAdminOrSocialMedia() } catch (e) { return e }
  }

  // Pick assets that need compression. Pending takes priority (explicitly
  // queued); empty Compress Status means "never evaluated" — process them
  // too so the system self-heals.
  const candidates = await fetchAirtableRecords('Assets', {
    filterByFormula: `AND(
      OR({Compress Status}='Pending', {Compress Status}=''),
      OR({Edited File Link}!='', {Dropbox Shared Link}!='')
    )`,
    fields: ['Asset Name', 'Edited File Link', 'Dropbox Shared Link', 'Compress Status'],
    maxRecords: 1, // one per tick — each can take 3 minutes
  })

  if (!candidates.length) {
    return NextResponse.json({ ok: true, processed: 0, message: 'queue empty' })
  }

  const result = await processOneAsset(candidates[0])
  return NextResponse.json({ ok: true, processed: 1, result })
}
