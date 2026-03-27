import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, batchCreateRecords } from '@/lib/adminAuth'

const SHORTCODE_RE = /instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/

function extractShortcode(url) {
  const m = url?.match(SHORTCODE_RE)
  return m ? m[1] : null
}

/**
 * POST — import Instagram data export JSON → Source Reels
 *
 * Accepts either:
 * 1. Raw IG export: { raw: { saved_saved_media: [...] } }
 * 2. Pre-parsed: { items: [{ url, savedAt? }] }
 */
export async function POST(request) {
  try {
    await requireAdmin()
  } catch (e) { return e }

  try {
    const body = await request.json()
    let items = []

    // Parse raw IG export format
    if (body.raw) {
      const saved = body.raw.saved_saved_media || body.raw.saved_media || []
      for (const entry of saved) {
        // IG export has nested structure with string_map_data and media_list_data
        const stringData = entry.string_map_data || {}
        const savedOn = stringData['Saved on']?.timestamp
          ? new Date(stringData['Saved on'].timestamp * 1000).toISOString()
          : null

        // URLs can be in string_map_data or media_list_data
        const mediaList = entry.media_list_data || []
        for (const media of mediaList) {
          const url = media.media_url || media.uri || ''
          if (url) items.push({ url, savedAt: savedOn })
        }

        // Also check title/href patterns
        const titleData = stringData['Title'] || stringData['Media'] || {}
        if (titleData.href) {
          items.push({ url: titleData.href, savedAt: savedOn })
        }
      }
    }

    // Also accept pre-parsed items
    if (body.items?.length) {
      items.push(...body.items)
    }

    if (items.length === 0) {
      return NextResponse.json({ error: 'No reel URLs found in the data' }, { status: 400 })
    }

    // Extract shortcodes and dedup within the import batch
    const seen = new Set()
    const parsed = []
    for (const item of items) {
      const sc = extractShortcode(item.url)
      if (!sc || seen.has(sc)) continue
      seen.add(sc)
      parsed.push({ shortcode: sc, savedAt: item.savedAt || null })
    }

    // Dedup against Inspiration (if already on the board, skip)
    const inspoRecords = await fetchAirtableRecords('Inspiration', {
      fields: ['Content link'],
    })
    const inspoShortcodes = new Set()
    for (const r of inspoRecords) {
      const sc = extractShortcode(r.fields['Content link'])
      if (sc) inspoShortcodes.add(sc)
    }

    // Also dedup against existing Source Reels
    const srRecords = await fetchAirtableRecords('Source Reels', {
      fields: ['Reel URL'],
    })
    const srShortcodes = new Set()
    for (const r of srRecords) {
      const sc = extractShortcode(r.fields['Reel URL'])
      if (sc) srShortcodes.add(sc)
    }

    const toCreate = []
    let skippedInspo = 0
    let skippedSR = 0

    for (const { shortcode, savedAt } of parsed) {
      if (inspoShortcodes.has(shortcode)) {
        skippedInspo++
        continue
      }
      if (srShortcodes.has(shortcode)) {
        skippedSR++
        continue
      }

      const record = {
        fields: {
          'Reel URL': `https://www.instagram.com/reel/${shortcode}/`,
          'Data Source': 'IG Export',
          'Review Status': 'Pending Review',
        },
      }
      if (savedAt) {
        record.fields['Date Saved'] = savedAt
      }
      toCreate.push(record)
    }

    if (toCreate.length > 0) {
      await batchCreateRecords('Source Reels', toCreate)
    }

    return NextResponse.json({
      created: toCreate.length,
      skippedAlreadyOnBoard: skippedInspo,
      skippedAlreadyInSourceReels: skippedSR,
      totalParsed: parsed.length,
      totalRawItems: items.length,
    })
  } catch (err) {
    console.error('[import] POST error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
