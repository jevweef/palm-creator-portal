export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { requireAdminOrChatManager, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'

const PAGE_SIZE = 40

const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tiff', 'tif']
const imageExtRegex = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)/i

const getLinkedIds = (val) => (val || []).map(c => typeof c === 'string' ? c : c?.id).filter(Boolean)
const getSelectName = (val) => (typeof val === 'string' ? val : val?.name || '').toLowerCase()

const isImageAsset = (a) => {
  const ext = (a.fields?.['File Extension'] || '').toLowerCase()
  const link = a.fields?.['Dropbox Shared Link'] || ''
  const type = getSelectName(a.fields?.['Asset Type'])
  return imageExts.includes(ext) || imageExtRegex.test(link) || type === 'photo' || type === 'image'
}

// GET /api/admin/chat-wall/photos?creatorId=...&view=available|used&page=0
// Returns paginated photos for a creator. Photo only, sorted by createdTime desc.
// view=available — not yet marked used by chat manager (default)
// view=used      — already toggled used (for restore view)
export async function GET(request) {
  try {
    await requireAdminOrChatManager()
  } catch (e) { return e }

  const { searchParams } = new URL(request.url)
  const creatorId = searchParams.get('creatorId')
  const view = searchParams.get('view') === 'used' ? 'used' : 'available'
  const page = Math.max(0, parseInt(searchParams.get('page') || '0', 10))

  if (!creatorId) {
    return NextResponse.json({ error: 'creatorId required' }, { status: 400 })
  }

  try {
    // Note: we scan the Assets table because Airtable formulas can't filter
    // multipleRecordLinks by ID (ARRAYJOIN returns names, not IDs). Tried
    // walking the creator's Assets backlink + chunked OR(RECORD_ID()=…)
    // batches but Sunny's backlink had 4006 IDs (every asset ever linked,
    // including reels/posts), which blew through rate limits and was slower
    // than the scan. The scan stays — narrowed by Asset Type when possible
    // to cut payload.
    const assets = await fetchAirtableRecords('Assets', {
      filterByFormula: `AND(NOT({Dropbox Shared Link}=''),OR({Asset Type}='Photo',{Asset Type}='Image',{Asset Type}=BLANK()))`,
      fields: [
        'Asset Name',
        'Dropbox Shared Link',
        'Palm Creators',
        'Asset Type',
        'File Extension',
        'Pipeline Status',
        'Thumbnail',
        'CDN URL',
        'Used By Chat Manager At',
        'Used By Chat Manager',
      ],
    })

    const photoAssets = assets.filter(a => {
      if (!getLinkedIds(a.fields?.['Palm Creators']).includes(creatorId)) return false
      return isImageAsset(a)
    })

    // Counts for both tabs — drives the badge on each tab so they stay
    // consistent when the user switches views.
    const availableCount = photoAssets.filter(a => !a.fields?.['Used By Chat Manager At']).length
    const usedCount = photoAssets.length - availableCount

    const filtered = photoAssets.filter(a => {
      const usedAt = a.fields?.['Used By Chat Manager At']
      if (view === 'used') return !!usedAt
      return !usedAt
    })

    // Sort by createdTime descending — newest uploads first
    filtered.sort((a, b) => new Date(b.createdTime || 0) - new Date(a.createdTime || 0))

    const total = filtered.length
    const start = page * PAGE_SIZE
    const slice = filtered.slice(start, start + PAGE_SIZE)

    const photos = slice.map(a => {
      // Prefer the Airtable-generated thumbnail (auto-resized ~512px) over the
      // full-resolution Dropbox file. Falls back to the Dropbox link when no
      // Thumbnail attachment exists for this asset.
      const thumbAttachment = (a.fields['Thumbnail'] || [])[0]
      const thumbnails = thumbAttachment?.thumbnails || {}
      return {
        id: a.id,
        name: a.fields['Asset Name'] || '',
        dropboxLink: a.fields['Dropbox Shared Link'] || '',
        // Highest-priority source for browse views: Cloudflare Images CDN.
        // Set by scripts/backfill-cf-images.mjs (per-creator, opt-in for now).
        cdnUrl: a.fields['CDN URL'] || null,
        thumbSmall: thumbnails.small?.url || null,
        thumbLarge: thumbnails.large?.url || null,
        thumbFull: thumbnails.full?.url || thumbAttachment?.url || null,
        pipelineStatus: a.fields['Pipeline Status'] || '',
        fileExtension: a.fields['File Extension'] || '',
        createdTime: a.createdTime,
        usedAt: a.fields['Used By Chat Manager At'] || null,
      }
    })

    return NextResponse.json({
      photos,
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages: Math.ceil(total / PAGE_SIZE),
      availableCount,
      usedCount,
    })
  } catch (err) {
    console.error('[chat-wall/photos] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH /api/admin/chat-wall/photos
// Body: { assetId, used: boolean }
// Toggle the chat manager "used" flag. Setting used=false clears both fields (restore).
export async function PATCH(request) {
  try {
    await requireAdminOrChatManager()
  } catch (e) { return e }

  try {
    const { userId } = auth()
    const { assetId, used } = await request.json()
    if (!assetId) return NextResponse.json({ error: 'assetId required' }, { status: 400 })

    const fields = used
      ? {
          'Used By Chat Manager At': new Date().toISOString(),
          'Used By Chat Manager': userId || '',
        }
      : {
          'Used By Chat Manager At': null,
          'Used By Chat Manager': '',
        }

    await patchAirtableRecord('Assets', assetId, fields)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[chat-wall/photos] PATCH error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
