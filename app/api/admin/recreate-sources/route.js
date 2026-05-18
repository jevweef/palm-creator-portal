import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, createAirtableRecord, patchAirtableRecord } from '@/lib/adminAuth'

export const maxDuration = 30

// GET — list queued sources + the TJP-enabled creators (for the dropdown)
export async function GET() {
  try {
    await requireAdmin()

    const [sources, creators] = await Promise.all([
      fetchAirtableRecords('Recreate Sources', {
        fields: ['Handle', 'Creator', 'Status', 'Reels Found', 'Reels Stored', 'Last Scraped', 'Error'],
        sort: [{ field: 'Last Scraped', direction: 'desc' }],
      }),
      fetchAirtableRecords('Palm Creators', {
        fields: ['Creator', 'AKA', 'TJP Enabled'],
        filterByFormula: '{TJP Enabled} = 1',
      }),
    ])

    const creatorById = {}
    for (const c of creators) {
      creatorById[c.id] = c.fields?.AKA || c.fields?.Creator || 'Unknown'
    }

    return NextResponse.json({
      sources: sources.map(s => {
        const f = s.fields || {}
        const cid = Array.isArray(f.Creator) ? f.Creator[0] : null
        return {
          id: s.id,
          handle: f.Handle || '',
          creatorId: cid,
          creatorName: cid ? (creatorById[cid] || 'Unknown') : '—',
          status: f.Status?.name || f.Status || 'Queued',
          reelsFound: f['Reels Found'] || 0,
          reelsStored: f['Reels Stored'] || 0,
          lastScraped: f['Last Scraped'] || null,
          error: f.Error || '',
        }
      }),
      creators: creators
        .map(c => ({ id: c.id, name: c.fields?.AKA || c.fields?.Creator || 'Unknown' }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST — add one or more handles for a creator
export async function POST(request) {
  try {
    await requireAdmin()
    const { creatorId, handles } = await request.json()

    if (!creatorId || !/^rec[A-Za-z0-9]{14}$/.test(creatorId)) {
      return NextResponse.json({ error: 'Valid creatorId required' }, { status: 400 })
    }
    const list = (Array.isArray(handles) ? handles : String(handles || '').split(/[\s,\n]+/))
      .map(h => h.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/.*$/, ''))
      .filter(Boolean)

    if (list.length === 0) {
      return NextResponse.json({ error: 'No handles provided' }, { status: 400 })
    }

    const existing = await fetchAirtableRecords('Recreate Sources', { fields: ['Handle', 'Creator'] })
    const created = []
    const skipped = []

    for (const handle of list) {
      const dupe = existing.find(e => {
        const f = e.fields || {}
        const ec = Array.isArray(f.Creator) ? f.Creator[0] : null
        return (f.Handle || '').toLowerCase() === handle.toLowerCase() && ec === creatorId
      })
      if (dupe) { skipped.push({ handle, reason: 'already queued for this creator' }); continue }
      try {
        await createAirtableRecord('Recreate Sources', {
          Handle: handle,
          Creator: [creatorId],
          Status: 'Queued',
        })
        created.push(handle)
      } catch (err) {
        skipped.push({ handle, reason: err.message })
      }
    }

    return NextResponse.json({ created, skipped })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE — remove a queued source (?id=rec...)
export async function DELETE(request) {
  try {
    await requireAdmin()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id || !/^rec[A-Za-z0-9]{14}$/.test(id)) {
      return NextResponse.json({ error: 'Valid id required' }, { status: 400 })
    }
    // Soft guard: only let queued/error rows be deleted from the UI so an
    // in-flight scrape isn't orphaned mid-run.
    await patchAirtableRecord('Recreate Sources', id, { Status: 'Error', Error: 'Removed by admin' }, { typecast: true })
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
