import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, createAirtableRecord, patchAirtableRecord } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, deleteDropboxFile } from '@/lib/dropbox'

export const maxDuration = 30

const DEFAULT_MAX = 50
const HARD_CEIL = 100

// GET — the global library: queued/scraped accounts + every scraped reel
export async function GET() {
  try {
    await requireAdmin()

    const [sources, reels] = await Promise.all([
      fetchAirtableRecords('Recreate Sources', {
        fields: ['Handle', 'Status', 'Max Reels', 'Reels Found', 'Reels Stored', 'Last Scraped', 'Error'],
        sort: [{ field: 'Last Scraped', direction: 'desc' }],
      }),
      fetchAirtableRecords('Recreate Reels', {
        fields: ['Reel ID', 'Source Handle', 'Reel URL', 'Posted At', 'Views', 'Thumbnail', 'Dropbox Video Link', 'Status', 'Produced For'],
        sort: [{ field: 'Posted At', direction: 'desc' }],
      }),
    ])

    return NextResponse.json({
      sources: sources.map(s => {
        const f = s.fields || {}
        return {
          id: s.id,
          handle: f.Handle || '',
          status: f.Status?.name || f.Status || 'Queued',
          maxReels: f['Max Reels'] || null,
          reelsFound: f['Reels Found'] || 0,
          reelsStored: f['Reels Stored'] || 0,
          lastScraped: f['Last Scraped'] || null,
          error: f.Error || '',
        }
      }),
      reels: reels.map(r => {
        const f = r.fields || {}
        const thumb = Array.isArray(f.Thumbnail) && f.Thumbnail[0]
          ? (f.Thumbnail[0].thumbnails?.large?.url || f.Thumbnail[0].url)
          : null
        return {
          id: r.id,
          reelId: f['Reel ID'] || '',
          handle: f['Source Handle'] || '',
          url: f['Reel URL'] || '',
          postedAt: f['Posted At'] || null,
          views: f.Views || 0,
          thumbnail: thumb,
          video: (f['Dropbox Video Link'] || '').replace('dl=0', 'raw=1').replace('dl=1', 'raw=1'),
          producedForCount: Array.isArray(f['Produced For']) ? f['Produced For'].length : 0,
        }
      }),
    })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST — add one or more accounts to the global library (no creator)
export async function POST(request) {
  try {
    await requireAdmin()
    const { handles, maxReels } = await request.json()

    const list = (Array.isArray(handles) ? handles : String(handles || '').split(/[\s,\n]+/))
      .map(h => h.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/.*$/, ''))
      .filter(Boolean)

    if (list.length === 0) {
      return NextResponse.json({ error: 'No handles provided' }, { status: 400 })
    }

    let cap = Number(maxReels)
    cap = Number.isFinite(cap) && cap > 0 ? Math.min(cap, HARD_CEIL) : DEFAULT_MAX

    const existing = await fetchAirtableRecords('Recreate Sources', { fields: ['Handle'] })
    const existingHandles = new Set(existing.map(e => (e.fields?.Handle || '').toLowerCase()))

    const created = []
    const skipped = []
    for (const handle of list) {
      if (existingHandles.has(handle.toLowerCase())) {
        skipped.push({ handle, reason: 'already in library' })
        continue
      }
      try {
        await createAirtableRecord('Recreate Sources', {
          Handle: handle,
          Status: 'Queued',
          'Max Reels': cap,
        })
        created.push(handle)
        existingHandles.add(handle.toLowerCase())
      } catch (err) {
        skipped.push({ handle, reason: err.message })
      }
    }

    return NextResponse.json({ created, skipped, maxReels: cap })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE — remove a source account (?id=) OR a single library reel
// (?reelId=). Removing a reel also deletes its Dropbox file so denied
// junk doesn't sit in storage.
export async function DELETE(request) {
  try {
    await requireAdmin()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const reelId = searchParams.get('reelId')

    if (reelId) {
      if (!/^rec[A-Za-z0-9]{14}$/.test(reelId)) {
        return NextResponse.json({ error: 'Valid reelId required' }, { status: 400 })
      }
      // Look up the Dropbox path before deleting the row
      const recRes = await fetch(
        `https://api.airtable.com/v0/applLIT2t83plMqNx/Recreate%20Reels/${reelId}`,
        { headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` }, cache: 'no-store' }
      )
      if (recRes.ok) {
        const path = (await recRes.json()).fields?.['Dropbox Video Path']
        if (path) {
          try {
            const token = await getDropboxAccessToken()
            const ns = await getDropboxRootNamespaceId(token)
            await deleteDropboxFile(token, ns, path)
          } catch (e) {
            console.warn('[recreate-sources] Dropbox delete failed (non-fatal):', e.message)
          }
        }
      }
      const del = await fetch(
        `https://api.airtable.com/v0/applLIT2t83plMqNx/Recreate%20Reels/${reelId}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` } }
      )
      if (!del.ok) throw new Error(`Airtable DELETE ${del.status}`)
      return NextResponse.json({ deletedReel: reelId })
    }

    if (!id || !/^rec[A-Za-z0-9]{14}$/.test(id)) {
      return NextResponse.json({ error: 'Valid id required' }, { status: 400 })
    }
    const res = await fetch(
      `https://api.airtable.com/v0/applLIT2t83plMqNx/Recreate%20Sources/${id}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` } }
    )
    if (!res.ok) throw new Error(`Airtable DELETE ${res.status}`)
    return NextResponse.json({ deleted: id })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
