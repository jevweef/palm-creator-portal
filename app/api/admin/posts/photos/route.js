export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'

export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }

  const { searchParams } = new URL(request.url)
  const creatorId = searchParams.get('creatorId')
  const forReel = searchParams.get('forReel') === 'true'
  if (!creatorId) return NextResponse.json({ error: 'creatorId required' }, { status: 400 })

  try {
    const imageExts = ['jpg','jpeg','png','gif','webp','heic','heif','bmp','tiff','tif']
    const imageExtRegex = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)/i

    // Fetch all assets with a Dropbox link — paginated, no maxRecords cap.
    // Filter by creator, image type, and reel thumbnail usage in memory
    // (ARRAYJOIN on linked records returns display names not IDs, so can't
    // filter creator in formula).
    //
    // Also fetch in-flight Posts that have a Thumbnail set — we exclude any
    // photo that's already staged on a Prepping/Staged/Sent post so the
    // picker doesn't show "unused" when the photo is already in the pipeline.
    // The Asset flag 'Used As Reel Thumbnail' only flips on successful
    // Telegram send; this covers the gap between pick and send.
    const [assets, activePostsWithThumbs] = await Promise.all([
      fetchAirtableRecords('Assets', {
        filterByFormula: `NOT({Dropbox Shared Link}='')`,
        fields: ['Asset Name', 'Dropbox Shared Link', 'Palm Creators', 'Asset Type', 'Pipeline Status', 'Used As Reel Thumbnail', 'File Extension'],
        sort: [{ field: 'Created Time', direction: 'desc' }],
      }),
      forReel ? fetchAirtableRecords('Posts', {
        filterByFormula: `AND(NOT({Thumbnail}=''),OR({Status}='Prepping',{Status}='Staged',{Status}='Sending',{Status}='Sent to Telegram',{Status}='Ready to Post',{Status}='Posted'))`,
        fields: ['Thumbnail', 'Creator'],
      }) : Promise.resolve([]),
    ])

    // Airtable REST API may return linked records as string IDs OR as {id, name} objects
    const getLinkedIds = (val) => (val || []).map(c => typeof c === 'string' ? c : c?.id).filter(Boolean)
    // Single select may return a string OR {id, name, color} object
    const getSelectName = (val) => (typeof val === 'string' ? val : val?.name || '').toLowerCase()

    const isImageAsset = (a) => {
      const ext = (a.fields?.['File Extension'] || '').toLowerCase()
      const link = a.fields?.['Dropbox Shared Link'] || ''
      const type = getSelectName(a.fields?.['Asset Type'])
      return imageExts.includes(ext) || imageExtRegex.test(link) || type === 'photo' || type === 'image'
    }

    // Build a set of filenames already used by any active Post's Thumbnail
    // for THIS creator. Match by filename (not full URL) because Airtable
    // rewrites attachment URLs on ingest — the filename survives as the
    // original Dropbox filename.
    const usedFilenames = new Set()
    for (const p of activePostsWithThumbs) {
      const pc = getLinkedIds(p.fields?.Creator)
      if (!pc.includes(creatorId)) continue
      for (const t of (p.fields?.Thumbnail || [])) {
        if (t?.filename) usedFilenames.add(t.filename.toLowerCase())
      }
    }

    // Extract the filename portion of a Dropbox Shared Link, e.g.
    //   https://dl.dropboxusercontent.com/s/abc/IMG_1234.jpg?dl=0 → IMG_1234.jpg
    const filenameFromUrl = (url) => {
      if (!url) return ''
      try {
        const clean = url.split('?')[0]
        const last = clean.split('/').pop() || ''
        return decodeURIComponent(last).toLowerCase()
      } catch { return '' }
    }

    // Filter in memory for this creator + image type + not-already-used
    const photos = assets
      .filter(a => {
        if (!getLinkedIds(a.fields?.['Palm Creators']).includes(creatorId)) return false
        if (!isImageAsset(a)) return false
        if (!forReel) return true
        // Exclude if Airtable flag says it was sent as a thumbnail before
        if (a.fields?.['Used As Reel Thumbnail']) return false
        // Exclude if it's currently attached to any active Post's Thumbnail
        const fname = filenameFromUrl(a.fields?.['Dropbox Shared Link'])
        if (fname && usedFilenames.has(fname)) return false
        return true
      })
      .map(a => ({
        id: a.id,
        name: a.fields['Asset Name'] || '',
        dropboxLink: a.fields['Dropbox Shared Link'] || '',
        pipelineStatus: a.fields['Pipeline Status'] || '',
      }))

    return NextResponse.json({ photos })
  } catch (err) {
    console.error('[Photos] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH — mark an asset as used as reel thumbnail
export async function PATCH(request) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const { assetId } = await request.json()
    if (!assetId) return NextResponse.json({ error: 'assetId required' }, { status: 400 })
    await patchAirtableRecord('Assets', assetId, { 'Used As Reel Thumbnail': true })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
