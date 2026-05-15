import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'

export const maxDuration = 60

/**
 * GET — list unique IG handles that appear in the review queue but aren't
 * yet on Inspo Sources. Used by the Candidates tab so admins can scan a
 * creator's IG grid and decide whether to add them to the scrape list.
 */
export async function GET() {
  try {
    await requireAdmin()
  } catch (e) { return e }

  try {
    // 1. All Source Reels still in review, grouped by handle.
    const reels = await fetchAirtableRecords('Source Reels', {
      fields: ['Username', 'Source Handle', 'Reel URL', 'Date Saved', 'Review Status', 'Data Source'],
    })

    const byHandle = new Map() // key: lowercase handle, value: { handle, count, latestSavedAt, sampleUrl, sources:Set }
    for (const r of reels) {
      const f = r.fields || {}
      // Only consider pending reels (the user reviews creators of unreviewed reels)
      const status = (f['Review Status']?.name || f['Review Status'] || '').toLowerCase()
      if (status && status !== 'pending review') continue

      const raw = (f.Username || f['Source Handle'] || '').toString().trim().replace(/^@/, '')
      if (!raw) continue
      const key = raw.toLowerCase()

      const existing = byHandle.get(key)
      const savedAt = f['Date Saved'] || null
      if (!existing) {
        byHandle.set(key, {
          handle: raw,
          count: 1,
          latestSavedAt: savedAt,
          sampleUrl: f['Reel URL'] || null,
          dataSources: new Set([f['Data Source']?.name || f['Data Source'] || 'Unknown']),
        })
      } else {
        existing.count++
        if (savedAt && (!existing.latestSavedAt || savedAt > existing.latestSavedAt)) {
          existing.latestSavedAt = savedAt
          existing.sampleUrl = f['Reel URL'] || existing.sampleUrl
        }
        if (f['Data Source']) existing.dataSources.add(f['Data Source']?.name || f['Data Source'])
      }
    }

    // 2. Subtract handles already in Inspo Sources (including Dead/Banned —
    //    we don't want to re-prompt for accounts the admin already classified).
    const sources = await fetchAirtableRecords('Inspo Sources', {
      fields: ['Handle'],
    })
    const onSources = new Set()
    for (const r of sources) {
      const h = (r.fields?.Handle || '').toString().trim().replace(/^@/, '').toLowerCase()
      if (h) onSources.add(h)
    }

    const candidates = []
    for (const [key, v] of byHandle.entries()) {
      if (onSources.has(key)) continue
      candidates.push({
        handle: v.handle,
        count: v.count,
        latestSavedAt: v.latestSavedAt,
        sampleUrl: v.sampleUrl,
        dataSources: Array.from(v.dataSources),
      })
    }

    candidates.sort((a, b) => b.count - a.count)

    return NextResponse.json({
      candidates,
      totalReelsScanned: reels.length,
      totalHandles: byHandle.size,
      alreadyOnSources: byHandle.size - candidates.length,
    })
  } catch (err) {
    console.error('[source-candidates] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
