import { NextResponse } from 'next/server'
import { requireAdminOrAiEditor, fetchAirtableRecords } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

// POST { slugs: ['Amelia_R042_S01_O03', ...] }
//   → { results: [{ slug, ok, reelRecordId, creatorId, outfit, parentSlug, error? }] }
//
// Single round-trip resolver used by batch upload. For each provided
// slug, find the parent Stage B Output (or the Outfit Swap variant's
// parent), return the source reel + creator the editor needs to
// create an Asset+Task against. Drops the slug→reel lookup from the
// client into one Airtable scan instead of N.
export async function POST(request) {
  try {
    await requireAdminOrAiEditor()
    const { slugs } = await request.json()
    if (!Array.isArray(slugs) || !slugs.length) {
      return NextResponse.json({ error: 'slugs[] required' }, { status: 400 })
    }

    // Normalize: strip extensions / trailing suffixes so the editor
    // can drop "Amelia_R042_S01_O03.mp4" or "Amelia_R042_S01_O03_v2"
    // and still hit the slug.
    const slugRe = /^([A-Za-z]+_R\d{1,4}_S\d{1,3}(?:_O\d{1,3})?)/
    const normalized = slugs.map(s => {
      const m = String(s || '').match(slugRe)
      return m ? m[1] : null
    })

    // Pull every Stage B Output + Outfit Swap Output once. These are
    // small tables; one scan beats N filterByFormula calls.
    const [stageBs, outfits] = await Promise.all([
      fetchAirtableRecords('Stage B Outputs', { fields: ['Slug', 'Creator', 'Source Reel'] }),
      fetchAirtableRecords('Outfit Swap Outputs', { fields: ['Slug', 'Creator', 'Stage B Parent', 'Outfit'] }),
    ])
    const stageBBySlug = new Map()
    for (const s of stageBs) {
      const sl = s.fields?.Slug
      if (sl) stageBBySlug.set(sl, { id: s.id, reelId: (s.fields?.['Source Reel'] || [])[0] || null, creatorId: (s.fields?.Creator || [])[0] || null })
    }
    const outfitBySlug = new Map()
    for (const o of outfits) {
      const sl = o.fields?.Slug
      if (sl) outfitBySlug.set(sl, { id: o.id, parentId: (o.fields?.['Stage B Parent'] || [])[0] || null, creatorId: (o.fields?.Creator || [])[0] || null, outfit: o.fields?.Outfit || '' })
    }

    const results = normalized.map((slug, i) => {
      if (!slug) return { slug: slugs[i], ok: false, error: 'Could not parse slug from filename' }
      // Outfit variant: resolve via parent Stage B to get the reel.
      if (slug.match(/_O\d/)) {
        const variant = outfitBySlug.get(slug)
        if (!variant) return { slug, ok: false, error: 'Outfit variant not found in Airtable' }
        const parent = variant.parentId ? Array.from(stageBBySlug.values()).find(s => s.id === variant.parentId) : null
        const reelId = parent?.reelId || null
        const creatorId = variant.creatorId || parent?.creatorId || null
        if (!reelId) return { slug, ok: false, error: 'Parent Stage B Output has no source reel' }
        return { slug, ok: true, reelRecordId: reelId, creatorId, outfit: variant.outfit, parentSlug: slug.replace(/_O\d{1,3}$/, '') }
      }
      // Bare Stage B still (no outfit variant): the reel itself is the source.
      const sb = stageBBySlug.get(slug)
      if (!sb) return { slug, ok: false, error: 'Stage B Output not found in Airtable' }
      if (!sb.reelId) return { slug, ok: false, error: 'Stage B Output has no source reel' }
      return { slug, ok: true, reelRecordId: sb.reelId, creatorId: sb.creatorId, outfit: null, parentSlug: slug }
    })

    return NextResponse.json({ results })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
