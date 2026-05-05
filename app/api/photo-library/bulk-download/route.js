export const dynamic = 'force-dynamic'
// Vercel Pro: function maxDuration up to 300s. Need this much because we
// fetch every Dropbox file then stream-zip them — for a creator with 200
// photos we're looking at ~60-90s of streaming under typical conditions.
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { Readable } from 'node:stream'
import archiver from 'archiver'
import { requireAdminOrChatManager, fetchAirtableRecords } from '@/lib/adminAuth'

const OPS_BASE = 'applLIT2t83plMqNx'

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tiff', 'tif']
const IMAGE_RE = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)/i

const getLinkedIds = (val) => (val || []).map(c => typeof c === 'string' ? c : c?.id).filter(Boolean)
const getSelectName = (val) => (typeof val === 'string' ? val : val?.name || '').toLowerCase()

function isImageAsset(fields) {
  const ext = (fields['File Extension'] || '').toLowerCase()
  const link = fields['Dropbox Shared Link'] || ''
  const type = getSelectName(fields['Asset Type'])
  return IMAGE_EXTS.includes(ext) || IMAGE_RE.test(link) || type === 'photo' || type === 'image'
}

// Dropbox shared link → forced-download URL. ?dl=1 sets Content-Disposition:
// attachment, which is irrelevant for our server-side fetch but also strips
// any HTML-preview routing — we get raw bytes back.
function dropboxRawUrl(link) {
  if (!link) return ''
  const clean = link
    .replace(/[?&]dl=0/, '')
    .replace(/[?&]raw=1/, '')
    .replace(/[?&]dl=1/, '')
  return clean + (clean.includes('?') ? '&dl=1' : '?dl=1')
}

const USED_FOR_MAP = { wall: 'Wall Post', mm: 'Mass Message' }

// Airtable PATCH limits to 10 records per request. Chunks the bulk update.
async function batchMarkUsed(assetIds, surfaceLabel, userId) {
  const headers = {
    Authorization: `Bearer ${process.env.AIRTABLE_PAT}`,
    'Content-Type': 'application/json',
  }
  for (let i = 0; i < assetIds.length; i += 10) {
    const chunk = assetIds.slice(i, i + 10)
    const body = {
      records: chunk.map(id => ({
        id,
        fields: {
          'Used By Chat Manager At': new Date().toISOString(),
          'Used By Chat Manager': userId || '',
          'Used By Chat Manager For': surfaceLabel,
        },
      })),
    }
    const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/Assets`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Airtable bulk PATCH ${res.status}: ${text}`)
    }
  }
}

/**
 * POST /api/photo-library/bulk-download
 *
 * Body: { creatorId: string, usedFor: 'wall' | 'mm' }
 *
 * Marks every available photo for that creator as Used (with the chosen
 * surface), then streams back a zip containing the Dropbox originals.
 *
 * Response is a streaming application/zip — the browser starts saving the
 * file as soon as headers arrive, so the user sees a download appear
 * immediately rather than waiting for the whole zip to assemble.
 *
 * If the Airtable mark-used fails, we abort before downloading anything.
 * If a single Dropbox fetch fails mid-stream, that file is skipped and the
 * zip continues — the chat manager gets everything that worked.
 */
export async function POST(request) {
  try {
    await requireAdminOrChatManager()
  } catch (e) { return e }

  const { userId } = auth()
  let creatorId, usedFor
  try {
    const body = await request.json()
    creatorId = body.creatorId
    usedFor = body.usedFor
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!creatorId) return NextResponse.json({ error: 'creatorId required' }, { status: 400 })
  const surfaceLabel = USED_FOR_MAP[usedFor]
  if (!surfaceLabel) return NextResponse.json({ error: 'usedFor must be "wall" or "mm"' }, { status: 400 })

  // 1. Fetch every available photo for this creator. Mirrors the chat-wall
  // photos endpoint's filter (image type, has Dropbox link, not yet Used).
  let assets
  try {
    assets = await fetchAirtableRecords('Assets', {
      filterByFormula: `AND(NOT({Dropbox Shared Link}=''),OR({Asset Type}='Photo',{Asset Type}='Image',{Asset Type}=BLANK()),{Used By Chat Manager At}='')`,
      fields: ['Asset Name', 'Dropbox Shared Link', 'Palm Creators', 'Asset Type', 'File Extension'],
    })
  } catch (err) {
    return NextResponse.json({ error: 'Failed to load assets', detail: err.message }, { status: 500 })
  }

  const photos = assets.filter(a => {
    if (!getLinkedIds(a.fields?.['Palm Creators']).includes(creatorId)) return false
    return isImageAsset(a.fields || {})
  })
  if (photos.length === 0) {
    return NextResponse.json({ error: 'No available photos for this creator' }, { status: 404 })
  }

  // 2. Mark them all Used (batched PATCH). If this fails we bail before
  // streaming so the chat manager doesn't get half-marked state.
  try {
    await batchMarkUsed(photos.map(p => p.id), surfaceLabel, userId)
  } catch (err) {
    return NextResponse.json({ error: 'Failed to mark assets used', detail: err.message }, { status: 500 })
  }

  // 3. Build a streaming zip — fetch Dropbox files in parallel, append in
  // order, send. archiver writes entries one at a time (zip integrity), so
  // we use a sliding-window pattern: keep CONCURRENCY fetches in flight,
  // but only append to the archive once the next-in-order buffer is ready.
  // For Taby's ~140 photos this drops total time from ~70s → ~15s.
  //
  // Memory: each photo is fully buffered before append (Dropbox streams into
  // an ArrayBuffer). Worst case ≈ CONCURRENCY × largest photo size. For
  // typical iPhone JPEGs (~3MB) and a 5-wide window that's ~15MB, fine on
  // Vercel Pro.
  const CONCURRENCY = 5
  const archive = archiver('zip', { zlib: { level: 0 }, store: true })

  async function fetchOne(photo) {
    const link = photo.fields?.['Dropbox Shared Link']
    const name = photo.fields?.['Asset Name'] || photo.id
    if (!link) return null
    const url = dropboxRawUrl(link)
    try {
      const res = await fetch(url)
      if (!res.ok) {
        console.warn(`[bulk-download] skip ${photo.id} — HTTP ${res.status}`)
        return null
      }
      const buf = Buffer.from(await res.arrayBuffer())
      return { name, buffer: buf }
    } catch (err) {
      console.warn(`[bulk-download] error fetching ${photo.id}: ${err.message}`)
      return null
    }
  }

  ;(async () => {
    // Prime the sliding window with the first CONCURRENCY fetches.
    const pending = []
    let nextToFetch = 0
    for (; nextToFetch < Math.min(CONCURRENCY, photos.length); nextToFetch++) {
      pending.push(fetchOne(photos[nextToFetch]))
    }

    // Append in order — wait for each indexed fetch, append, kick off the
    // next one to keep the window saturated until everything's queued.
    for (let appendIdx = 0; appendIdx < photos.length; appendIdx++) {
      const result = await pending[appendIdx]
      if (result) {
        archive.append(result.buffer, { name: result.name })
      }
      pending[appendIdx] = null // free reference for GC
      if (nextToFetch < photos.length) {
        pending[nextToFetch] = fetchOne(photos[nextToFetch])
        nextToFetch++
      }
    }
    archive.finalize()
  })().catch(err => {
    console.error('[bulk-download] entry loop fatal:', err)
    archive.abort()
  })

  // archiver is a Node Readable. Convert to a Web ReadableStream for Next.
  const webStream = Readable.toWeb(archive)

  const today = new Date().toISOString().slice(0, 10)
  const filename = `palm-photos-${today}.zip`

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
