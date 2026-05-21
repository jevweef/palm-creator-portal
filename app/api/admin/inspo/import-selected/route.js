import { NextResponse } from 'next/server'
import { requireAdmin, batchCreateRecords, fetchAirtableRecords } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST /api/admin/inspo/import-selected
// Body: { handle: string, reels: [{ url, code, postedAt, likes, comments, plays, duration, caption }, ...] }
//
// Skips the Apify scrape entirely — RapidAPI already returned everything
// Source Reels needs. We just batch-create one record per selected reel.
// Idempotent on Reel URL (records already in Source Reels for the handle
// are filtered out before insert so re-clicking Import never duplicates).
export async function POST(request) {
  try {
    await requireAdmin()
    const body = await request.json()
    const handle = String(body.handle || '').replace(/^@/, '').trim()
    const reels = Array.isArray(body.reels) ? body.reels : []
    if (!handle) return NextResponse.json({ error: 'handle required' }, { status: 400 })
    if (reels.length === 0) return NextResponse.json({ error: 'no reels selected' }, { status: 400 })
    if (reels.length > 100) return NextResponse.json({ error: 'max 100 reels per import' }, { status: 400 })

    // Drop any reels that already exist in Source Reels for this handle.
    const existing = await fetchAirtableRecords('Source Reels', {
      fields: ['Reel URL'],
      filterByFormula: `{Source Handle} = "${handle}"`,
    })
    const existingUrls = new Set(existing.map(r => normalizeUrl(r.fields?.['Reel URL'] || '')).filter(Boolean))

    const records = []
    let dupes = 0
    for (const r of reels) {
      const reelUrl = String(r.url || '').trim()
      if (!reelUrl) continue
      if (existingUrls.has(normalizeUrl(reelUrl))) { dupes++; continue }
      const fields = {
        'Source Handle': handle,
        'Reel URL': reelUrl,
        Username: handle,
        Caption: String(r.caption || '').trim(),
        'Data Source': 'RapidAPI Preview',
      }
      if (r.postedAt) fields['Posted At'] = r.postedAt
      if (r.likes != null) fields.Likes = r.likes
      if (r.comments != null) fields.Comments = r.comments
      if (r.plays != null) fields.Views = r.plays
      if (r.duration != null) fields['Duration Seconds'] = typeof r.duration === 'string' ? parseFloat(r.duration) : r.duration
      records.push({ fields })
    }

    if (records.length === 0) {
      return NextResponse.json({ ok: true, created: 0, duplicates: dupes, message: 'All selected reels already imported' })
    }

    const created = await batchCreateRecords('Source Reels', records, { typecast: true })
    return NextResponse.json({
      ok: true,
      created: created.length,
      duplicates: dupes,
      ids: created.map(r => r.id),
    })
  } catch (err) {
    if (err instanceof Response) return err
    const msg = typeof err?.message === 'string' && err.message ? err.message : String(err)
    console.error('[inspo/import-selected] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

function normalizeUrl(url) {
  if (!url) return ''
  const m = String(url).match(/\/(?:reel|p)\/([A-Za-z0-9_-]+)/)
  return m ? m[1] : String(url).toLowerCase().trim()
}
