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
        fields: ['Reel ID', 'Source Handle', 'Reel URL', 'Caption', 'Posted At', 'Views', 'Dropbox Video Link', 'Stream UID', 'Thumbnail', 'Status', 'Produced For'],
        filterByFormula: `{Status} = 'Available'`,
        sort: [{ field: 'Posted At', direction: 'desc' }],
      })).filter(r => !(r.fields?.['Produced For'] || []).includes(creatorId))
      reels = rows.map(r => {
        const f = r.fields || {}
        const thumb = Array.isArray(f.Thumbnail) && f.Thumbnail[0] ? f.Thumbnail[0].url : null
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
        }
      })
    }

    return NextResponse.json({ creators: creatorList, reels })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
