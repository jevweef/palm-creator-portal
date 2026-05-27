import { NextResponse } from 'next/server'
import { requireAdminOrAiEditor, fetchAirtableRecords } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function rawLink(shareLink) {
  if (!shareLink) return null
  return String(shareLink).replace('dl=0', 'raw=1').replace('dl=1', 'raw=1')
}

export async function GET(request) {
  try {
    await requireAdminOrAiEditor()
    const { searchParams } = new URL(request.url)
    const creatorId = searchParams.get('creatorId')

    const creators = await fetchAirtableRecords('Palm Creators', {
      fields: ['Creator', 'AKA', 'TJP Enabled'],
      filterByFormula: '{TJP Enabled} = 1',
    })
    const creatorList = creators
      .map(c => ({ id: c.id, name: c.fields?.AKA || c.fields?.Creator || 'Unknown' }))
      .sort((a, b) => a.name.localeCompare(b.name))

    let reels = []
    if (creatorId && /^rec[A-Za-z0-9]{14}$/.test(creatorId)) {
      // Global library minus what's already been produced for THIS
      // creator. "Produced For" is a link array — filter client-side, not
      // via ARRAYJOIN+FIND (that yields primary-field text, not rec IDs,
      // so FIND('rec…') silently matches nothing).
      const rows = (await fetchAirtableRecords('Recreate Reels', {
        fields: ['Reel ID', 'Source Handle', 'Reel URL', 'Caption', 'Posted At', 'Views', 'Dropbox Video Link', 'Stream UID', 'Thumbnail', 'Status', 'Produced For', 'Selected Outfits', 'Added Via', 'Added By'],
        filterByFormula: `{Status} = 'Available'`,
        sort: [{ field: 'Posted At', direction: 'desc' }],
      })).filter(r => !(r.fields?.['Produced For'] || []).includes(creatorId))
      reels = rows.map(r => {
        const f = r.fields || {}
        const thumb = Array.isArray(f.Thumbnail) && f.Thumbnail[0] ? f.Thumbnail[0].url : null
        // Added Via comes back as either a string or { name } depending on
        // read path. Normalize so client always sees a string.
        const addedViaRaw = f['Added Via']
        const addedVia = typeof addedViaRaw === 'string' ? addedViaRaw : (addedViaRaw?.name || null)
        return {
          id: r.id,
          reelId: f['Reel ID'] || '',
          handle: f['Source Handle'] || '',
          url: f['Reel URL'] || '',
          caption: f.Caption || '',
          postedAt: f['Posted At'] || null,
          views: f.Views || 0,
          video: rawLink(f['Dropbox Video Link']),
          streamUid: f['Stream UID'] || null,
          thumbnail: thumb,
          // Outfit IDs attached to this reel — the workflow uses these
          // to drive the outfit fan-out step. Just IDs here; the photo
          // metadata is hydrated client-side from the Photos library.
          selectedOutfits: Array.isArray(f['Selected Outfits']) ? f['Selected Outfits'] : [],
          // Provenance — exposed so the AI editor can filter to admin-added
          // vs editor-uploaded vs their own uploads.
          addedVia: addedVia || null,
          addedBy: f['Added By'] || '',
        }
      })
    }

    return NextResponse.json({ creators: creatorList, reels })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
