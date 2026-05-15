import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, batchCreateRecords, batchUpdateRecords } from '@/lib/adminAuth'

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
      // Newer IG export: top-level is a flat array, each entry has `label_values`
      // [{label:'URL', value, href}, ...] plus a top-level `timestamp` (unix seconds).
      // The creator's handle lives in a nested `title: "Owner"` block.
      if (Array.isArray(body.raw)) {
        for (const entry of body.raw) {
          const savedAt = entry.timestamp
            ? new Date(entry.timestamp * 1000).toISOString()
            : null

          let url = null
          let username = null
          if (Array.isArray(entry.label_values)) {
            for (const lv of entry.label_values) {
              if (lv.label === 'URL') {
                const u = lv.href || lv.value || ''
                if (u && !url) url = u
              }
              if (lv.title === 'Owner' && Array.isArray(lv.dict)) {
                for (const owner of lv.dict) {
                  const inner = owner?.dict
                  if (!Array.isArray(inner)) continue
                  for (const f of inner) {
                    if (f.label === 'Username' && f.value) username = f.value
                  }
                }
              }
            }
          }
          if (url) items.push({ url, savedAt, username })
          if (entry.url) items.push({ url: entry.url, savedAt, username })
        }
      }

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
      parsed.push({ shortcode: sc, savedAt: item.savedAt || null, username: item.username || null })
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

    // Index existing Source Reels by shortcode so we can backfill missing
    // Username/Source Handle on records imported before the Owner extractor existed.
    const srRecords = await fetchAirtableRecords('Source Reels', {
      fields: ['Reel URL', 'Username', 'Source Handle'],
    })
    const srByShortcode = new Map()
    for (const r of srRecords) {
      const sc = extractShortcode(r.fields['Reel URL'])
      if (sc) srByShortcode.set(sc, r)
    }

    const toCreate = []
    const toUpdate = []
    let skippedInspo = 0
    let skippedSR = 0

    for (const { shortcode, savedAt, username } of parsed) {
      if (inspoShortcodes.has(shortcode)) {
        skippedInspo++
        continue
      }
      const existing = srByShortcode.get(shortcode)
      if (existing) {
        const existingHandle = existing.fields['Username'] || existing.fields['Source Handle']
        if (username && !existingHandle) {
          toUpdate.push({
            id: existing.id,
            fields: { 'Source Handle': username, 'Username': username },
          })
        } else {
          skippedSR++
        }
        continue
      }

      const record = {
        fields: {
          'Reel URL': `https://www.instagram.com/reel/${shortcode}/`,
          'Data Source': 'IG Export',
          'Review Status': 'Pending Review',
        },
      }
      if (savedAt) record.fields['Date Saved'] = savedAt
      if (username) {
        record.fields['Source Handle'] = username
        record.fields['Username'] = username
      }
      toCreate.push(record)
    }

    if (toCreate.length > 0) {
      try {
        // typecast lets Airtable auto-add 'IG Export' as a Data Source choice if the
        // PAT has schema-write scope.
        await batchCreateRecords('Source Reels', toCreate, { typecast: true })
      } catch (err) {
        // Fall back: PAT lacks schema scope — Airtable refuses to create the option.
        // Retry with 'Manual', which already exists on the Data Source field.
        if (/INVALID_MULTIPLE_CHOICE_OPTIONS|select option/i.test(err.message)) {
          for (const rec of toCreate) rec.fields['Data Source'] = 'Manual'
          await batchCreateRecords('Source Reels', toCreate)
        } else {
          throw err
        }
      }
    }

    if (toUpdate.length > 0) {
      await batchUpdateRecords('Source Reels', toUpdate)
    }

    return NextResponse.json({
      created: toCreate.length,
      backfilled: toUpdate.length,
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
