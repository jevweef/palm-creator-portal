import { NextResponse } from 'next/server'
import { requireAdminOrAiEditor, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

const REELS = 'Recreate Reels'
const PHOTOS = 'Photos'

// GET ?reelId=rec... — return the picked outfit photos (hydrated with
// thumbnail + handle) for one Stage B reel. Drives the "Selected Outfits"
// strip in the workflow.
//
// PUT  { reelId, outfitIds }    — replace the whole selection.
// POST { reelId, addId }        — append a single outfit.
// POST { reelId, removeId }     — drop a single outfit.
//
// We keep all three so the UI can do bulk-set (closing the picker) AND
// inline add/remove (×-button on a strip) without round-tripping the
// full set. Returns the hydrated list each time so the client never
// has to merge state manually.

async function readSelectionForReel(reelId) {
  const rows = await fetchAirtableRecords(REELS, {
    fields: ['Selected Outfits'],
    filterByFormula: `RECORD_ID() = '${reelId}'`,
  })
  return Array.isArray(rows[0]?.fields?.['Selected Outfits']) ? rows[0].fields['Selected Outfits'] : []
}

async function hydrateOutfits(ids) {
  if (!ids?.length) return []
  // Airtable's IN() formula doesn't exist; build a chained OR(RECORD_ID()=...).
  // 30 IDs max in a single OR() expression is comfortable — far above
  // the realistic outfit-count per reel.
  const expr = ids.map(id => `RECORD_ID() = '${id}'`).join(', ')
  const rows = await fetchAirtableRecords(PHOTOS, {
    fields: ['Source Handle', 'Source Post URL', 'Carousel Index', 'Carousel Total', 'CDN URL', 'Dropbox Path', 'Image', 'Is Outfit'],
    filterByFormula: `OR(${expr})`,
  })
  const byId = Object.fromEntries(rows.map(r => [r.id, r]))
  // Preserve the order in `ids` so the editor's pick-order is what
  // they see on the strip (and what the fan-out uses).
  return ids.map(id => {
    const r = byId[id]; if (!r) return null
    const f = r.fields || {}
    const cdnUrl = f['CDN URL'] || ''
    const dropboxPath = f['Dropbox Path'] || ''
    const proxyUrl = dropboxPath ? `/api/admin/photos/image?path=${encodeURIComponent(dropboxPath)}` : ''
    const att = f.Image
    const attThumb = (Array.isArray(att) && att[0]) ? (att[0].thumbnails?.large?.url || att[0].url) : null
    return {
      id: r.id,
      handle: f['Source Handle'] || '',
      postUrl: f['Source Post URL'] || '',
      carouselIndex: f['Carousel Index'] || 1,
      carouselTotal: f['Carousel Total'] || 1,
      image: cdnUrl || proxyUrl || attThumb,
      imageFallback: cdnUrl ? (proxyUrl || attThumb) : attThumb,
      isOutfit: !!f['Is Outfit'],
    }
  }).filter(Boolean)
}

export async function GET(request) {
  try {
    await requireAdminOrAiEditor()
    const reelId = new URL(request.url).searchParams.get('reelId')
    if (!reelId || !/^rec[A-Za-z0-9]{14}$/.test(reelId)) {
      return NextResponse.json({ error: 'reelId required' }, { status: 400 })
    }
    const ids = await readSelectionForReel(reelId)
    return NextResponse.json({ ok: true, outfits: await hydrateOutfits(ids) })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PUT(request) {
  try {
    await requireAdminOrAiEditor()
    const { reelId, outfitIds } = await request.json()
    if (!reelId || !/^rec[A-Za-z0-9]{14}$/.test(reelId)) {
      return NextResponse.json({ error: 'reelId required' }, { status: 400 })
    }
    if (!Array.isArray(outfitIds)) return NextResponse.json({ error: 'outfitIds array required' }, { status: 400 })
    // Dedupe + validate IDs without touching ordering (editor's order
    // is meaningful — drives fan-out numbering).
    const seen = new Set()
    const clean = []
    for (const id of outfitIds) {
      if (typeof id !== 'string' || !/^rec[A-Za-z0-9]{14}$/.test(id)) continue
      if (seen.has(id)) continue
      seen.add(id); clean.push(id)
    }
    await patchAirtableRecord(REELS, reelId, { 'Selected Outfits': clean })
    return NextResponse.json({ ok: true, outfits: await hydrateOutfits(clean) })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    await requireAdminOrAiEditor()
    const { reelId, addId, removeId } = await request.json()
    if (!reelId || !/^rec[A-Za-z0-9]{14}$/.test(reelId)) {
      return NextResponse.json({ error: 'reelId required' }, { status: 400 })
    }
    if (!addId && !removeId) return NextResponse.json({ error: 'addId or removeId required' }, { status: 400 })
    const current = await readSelectionForReel(reelId)
    let next = current
    if (addId) {
      if (!/^rec[A-Za-z0-9]{14}$/.test(addId)) return NextResponse.json({ error: 'addId must be a record id' }, { status: 400 })
      if (!current.includes(addId)) next = [...current, addId]
    } else if (removeId) {
      next = current.filter(id => id !== removeId)
    }
    if (next !== current) await patchAirtableRecord(REELS, reelId, { 'Selected Outfits': next })
    return NextResponse.json({ ok: true, outfits: await hydrateOutfits(next) })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
