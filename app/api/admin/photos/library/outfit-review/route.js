import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, batchUpdateRecords } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'
const TABLE = 'Photos'

// POST { postUrl: string, pickedId?: string, dismiss?: boolean }
//
// Marks an entire post as reviewed for outfit selection. Two modes:
//   • Pick: pickedId is the chosen image's record id. That image gets
//     Is Outfit + Outfit Reviewed; every other image in the post gets
//     just Outfit Reviewed.
//   • Dismiss: dismiss=true. Every image in the post gets Outfit
//     Reviewed=true, none get Is Outfit. Post drops out of the
//     picker queue but stays in the regular library.
//
// Either way, the post disappears from the Outfit Picker queue on
// next fetch (filter is "no images with Outfit Reviewed=true").
export async function POST(request) {
  try {
    await requireAdmin()
    const { postUrl, pickedId, dismiss } = await request.json()
    if (!postUrl || typeof postUrl !== 'string') {
      return NextResponse.json({ error: 'postUrl required' }, { status: 400 })
    }
    if (!pickedId && !dismiss) {
      return NextResponse.json({ error: 'either pickedId or dismiss=true required' }, { status: 400 })
    }
    if (pickedId && !/^rec[A-Za-z0-9]{14}$/.test(pickedId)) {
      return NextResponse.json({ error: 'invalid pickedId' }, { status: 400 })
    }

    // Find every Photos record sharing this Source Post URL.
    const siblings = await fetchAirtableRecords(TABLE, {
      fields: ['Source Post URL', 'Carousel Index'],
      filterByFormula: `{Source Post URL} = "${postUrl.replace(/"/g, '\\"')}"`,
    })
    if (siblings.length === 0) {
      return NextResponse.json({ error: 'no images found for that post' }, { status: 404 })
    }

    // Build the per-record update set.
    const updates = siblings.map(s => ({
      id: s.id,
      fields: {
        'Outfit Reviewed': true,
        ...(pickedId && s.id === pickedId ? { 'Is Outfit': true } : { 'Is Outfit': false }),
      },
    }))
    await batchUpdateRecords(TABLE, updates)

    return NextResponse.json({
      ok: true,
      postUrl,
      siblingCount: siblings.length,
      pickedId: pickedId || null,
      dismissed: !!dismiss,
    })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST /undo  — undo a review (clears Outfit Reviewed + Is Outfit on all
// siblings) so the post returns to the picker queue. Mounted as the
// DELETE method on the same route for ergonomics.
export async function DELETE(request) {
  try {
    await requireAdmin()
    const postUrl = new URL(request.url).searchParams.get('postUrl')
    if (!postUrl) return NextResponse.json({ error: 'postUrl required' }, { status: 400 })

    const siblings = await fetchAirtableRecords(TABLE, {
      fields: ['Source Post URL'],
      filterByFormula: `{Source Post URL} = "${postUrl.replace(/"/g, '\\"')}"`,
    })
    if (siblings.length === 0) {
      return NextResponse.json({ error: 'no images found for that post' }, { status: 404 })
    }
    const updates = siblings.map(s => ({
      id: s.id,
      fields: { 'Outfit Reviewed': false, 'Is Outfit': false },
    }))
    await batchUpdateRecords(TABLE, updates)
    return NextResponse.json({ ok: true, postUrl, siblingCount: siblings.length })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
