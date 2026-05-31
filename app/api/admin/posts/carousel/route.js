export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, createAirtableRecord, patchAirtableRecord, OPS_BASE } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'

function recordIdFormula(ids) {
  if (!ids.length) return 'FALSE()'
  return `OR(${ids.map(id => `RECORD_ID() = ${quoteAirtableString(id)}`).join(',')})`
}

// POST — create one carousel Post per creator.
// Body (preferred): { photoIds: string[], creatorIds: string[], caption?, hashtags? }
//   photoIds reference rows in the Photos table; we mirror each into a new
//   Asset record (Asset Type=Photo) so the existing Post.Asset linkage and
//   send pipeline work uniformly.
// Body (legacy): { assetIds: string[], ... } — pass-through, expects Asset records.
// Photos table fields read: Source Handle, Caption, Dropbox Link, Dropbox Path, CDN URL, Creator, Source Post URL, Carousel Index.
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const body = await request.json()
    const { creatorIds, caption, hashtags } = body
    let { photoIds, assetIds } = body

    photoIds = Array.isArray(photoIds) ? photoIds : []
    assetIds = Array.isArray(assetIds) ? assetIds : []

    if (!photoIds.length && !assetIds.length) {
      return NextResponse.json({ error: 'photoIds or assetIds required' }, { status: 400 })
    }
    if (photoIds.length + assetIds.length > 10) {
      return NextResponse.json({ error: 'IG carousels max 10 slides' }, { status: 400 })
    }
    if (!Array.isArray(creatorIds) || creatorIds.length < 1) {
      return NextResponse.json({ error: 'creatorIds must be a non-empty array' }, { status: 400 })
    }

    // Mirror Photos → Assets. Ordered: each Photo becomes a fresh Asset so
    // the carousel slide order is preserved by linking the Assets in order.
    let mirroredAssetIds = []
    if (photoIds.length) {
      const photos = await fetchAirtableRecords('Photos', {
        filterByFormula: recordIdFormula(photoIds),
        fields: ['Source Handle', 'Caption', 'Dropbox Link', 'Dropbox Path', 'CDN URL', 'Creator', 'Source Post URL', 'Carousel Index', 'Source Type'],
      })
      const photoById = Object.fromEntries(photos.map(p => [p.id, p]))
      const missing = photoIds.filter(id => !photoById[id])
      if (missing.length) {
        return NextResponse.json({ error: `Photos not found: ${missing.join(', ')}` }, { status: 404 })
      }
      for (const pid of photoIds) {
        const p = photoById[pid]
        const f = p.fields || {}
        const handle = f['Source Handle'] || ''
        const capSnippet = (f['Caption'] || '').slice(0, 40).replace(/\s+/g, ' ').trim()
        // Embed the source Photo ID in the Asset Name so Discard can find +
        // un-mark the source Photo later. Format: `[src:recXXX]` suffix.
        // Asset Name is otherwise informational; this is the cheapest
        // back-reference without a new linked field on Assets.
        const name = `Carousel slide — ${capSnippet || handle || pid} [src:${pid}]`
        const assetFields = {
          'Asset Name': name,
          'Asset Type': 'Photo',
          // Mark the mirror as Used In Carousel from the jump — it should
          // never surface in the picker since the user submitted it via the
          // source Photo, not as a standalone Asset.
          'Used In Carousel': true,
        }
        // Skip Palm Creators link on the mirror so it doesn't pollute the
        // Creator Upload picker — the Asset is purely backing storage for
        // the carousel post, not a creator-uploaded photo in its own right.
        if (f['Dropbox Link']) assetFields['Dropbox Shared Link'] = f['Dropbox Link']
        if (f['Dropbox Path']) assetFields['Dropbox Path (Current)'] = f['Dropbox Path']
        if (f['CDN URL']) assetFields['CDN URL'] = f['CDN URL']
        // Carry the source Photo's Source Type onto the mirror Asset. AI
        // carousel slides come in as Source Type='AI Generated'; without this
        // the mirror lands blank and leaks into chat-manager surfaces (the
        // /photo-library wall filters {Source Type}!='AI Generated'). Real
        // Creator Upload slides keep their own Source Type and stay visible.
        if (f['Source Type']) assetFields['Source Type'] = f['Source Type']
        const rec = await createAirtableRecord('Assets', assetFields, { typecast: true })
        mirroredAssetIds.push(rec.id)
      }
    }

    // Legacy assetIds pass-through: validate they exist and are Photo type.
    if (assetIds.length) {
      const assets = await fetchAirtableRecords('Assets', {
        filterByFormula: recordIdFormula(assetIds),
        fields: ['Asset Name', 'Asset Type'],
      })
      if (assets.length !== assetIds.length) {
        const found = new Set(assets.map(a => a.id))
        const missing = assetIds.filter(id => !found.has(id))
        return NextResponse.json({ error: `Assets not found: ${missing.join(', ')}` }, { status: 404 })
      }
      const nonPhoto = assets.filter(a => a.fields?.['Asset Type'] !== 'Photo')
      if (nonPhoto.length) {
        return NextResponse.json({
          error: `All assets must be Asset Type='Photo'. Non-photo: ${nonPhoto.map(a => a.id).join(', ')}`,
        }, { status: 400 })
      }
    }

    // Order: mirrored photos first (in input order), then any legacy assetIds.
    const orderedAssetIds = [...mirroredAssetIds, ...assetIds]

    const creators = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: recordIdFormula(creatorIds),
      fields: ['AKA', 'Creator'],
    })
    if (creators.length !== creatorIds.length) {
      const found = new Set(creators.map(c => c.id))
      const missing = creatorIds.filter(id => !found.has(id))
      return NextResponse.json({ error: `Creators not found: ${missing.join(', ')}` }, { status: 404 })
    }
    const creatorMap = Object.fromEntries(creators.map(c => [c.id, c.fields]))

    const shortDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const slideLabel = orderedAssetIds.length === 1 ? '1 photo' : `${orderedAssetIds.length} photos`

    const created = []
    for (const creatorId of creatorIds) {
      const c = creatorMap[creatorId] || {}
      const aka = c.AKA || c.Creator || ''
      const postName = [aka, shortDate, slideLabel].filter(Boolean).join(' – ')

      const fields = {
        'Post Name': postName,
        'Creator': [creatorId],
        'Asset': orderedAssetIds,
        'Type': 'Carousel',
        'Status': 'Ready to Go',
      }
      if (caption) fields['Caption'] = caption
      if (hashtags) fields['Hashtags'] = hashtags

      const rec = await createAirtableRecord('Posts', fields, { typecast: true })
      created.push({ id: rec.id, creatorId, name: postName })
    }

    // Mark source records as Used In Carousel so they fall out of the
    // picker for future carousels. Non-fatal — Post creation already
    // succeeded above; surface any patch failure as a warning.
    const usagePatches = []
    for (const pid of photoIds) {
      usagePatches.push(
        patchAirtableRecord('Photos', pid, { 'Used In Carousel': true })
          .catch(err => console.warn(`[Posts/carousel] Failed to mark Photo ${pid} used:`, err.message))
      )
    }
    for (const aid of assetIds) {
      usagePatches.push(
        patchAirtableRecord('Assets', aid, { 'Used In Carousel': true })
          .catch(err => console.warn(`[Posts/carousel] Failed to mark Asset ${aid} used:`, err.message))
      )
    }
    await Promise.allSettled(usagePatches)

    return NextResponse.json({ posts: created, mirroredAssetIds })
  } catch (err) {
    console.error('[Posts/carousel] POST error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

const AIRTABLE_PAT = process.env.AIRTABLE_PAT

// DELETE ?postId=rec... — Discard a carousel Post.
//   - Looks up the Post's linked Asset records
//   - For each Asset, parses `[src:rec...]` from Asset Name to find the
//     source Photo (set when we mirrored it on creation) and un-marks
//     `Used In Carousel` on that source Photo so it's selectable again.
//   - Un-marks `Used In Carousel` on the Assets themselves (covers the
//     Creator Upload case where the Asset IS the source record).
//   - Deletes the Post (Airtable). The mirror Asset records are left in
//     place but stay Used In Carousel + are not creator-linked, so they
//     don't appear in any picker.
export async function DELETE(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const url = new URL(request.url)
    const postId = url.searchParams.get('postId')
    if (!postId || !/^rec[A-Za-z0-9]{14}$/.test(postId)) {
      return NextResponse.json({ error: 'valid postId required' }, { status: 400 })
    }

    const posts = await fetchAirtableRecords('Posts', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(postId)}`,
      fields: ['Type', 'Asset', 'Status'],
    })
    const post = posts[0]
    if (!post) return NextResponse.json({ error: 'post not found' }, { status: 404 })
    const postType = post.fields?.Type?.name || post.fields?.Type
    if (postType !== 'Carousel') {
      return NextResponse.json({ error: 'Discard is only for carousel posts. Use the standard delete for reels.' }, { status: 400 })
    }
    const linkedAssetIds = post.fields?.Asset || []

    // Pull each linked Asset to find back-reference + un-mark.
    let sourcePhotoIds = []
    if (linkedAssetIds.length) {
      const assets = await fetchAirtableRecords('Assets', {
        filterByFormula: recordIdFormula(linkedAssetIds),
        fields: ['Asset Name', 'Used In Carousel'],
      })
      for (const a of assets) {
        const name = a.fields?.['Asset Name'] || ''
        const m = name.match(/\[src:(rec[A-Za-z0-9]{14})\]/)
        if (m) sourcePhotoIds.push(m[1])
      }
      // Un-mark all linked Assets. Covers Creator Upload case (the Asset
      // IS the source) and the mirror Assets (leaves them un-used so we
      // could in theory re-use them, though they're never surfaced).
      await Promise.allSettled(linkedAssetIds.map(aid =>
        patchAirtableRecord('Assets', aid, { 'Used In Carousel': false })
          .catch(err => console.warn(`[Posts/carousel] Failed to un-mark Asset ${aid}:`, err.message))
      ))
    }

    // Un-mark source Photos parsed from the mirror Asset Names.
    if (sourcePhotoIds.length) {
      await Promise.allSettled(sourcePhotoIds.map(pid =>
        patchAirtableRecord('Photos', pid, { 'Used In Carousel': false })
          .catch(err => console.warn(`[Posts/carousel] Failed to un-mark Photo ${pid}:`, err.message))
      ))
    }

    // Delete the Post. Use direct REST since lib/adminAuth doesn't expose
    // a delete helper.
    const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/Posts/${postId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
    })
    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json({ error: `Airtable delete failed: ${res.status} ${text}` }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      deletedPostId: postId,
      unmarkedPhotos: sourcePhotoIds.length,
      unmarkedAssets: linkedAssetIds.length,
    })
  } catch (err) {
    console.error('[Posts/carousel] DELETE error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
