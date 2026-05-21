import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, createAirtableRecord, patchAirtableRecord, OPS_BASE } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

const TABLE = 'Photo Accounts'
const AIRTABLE_PAT = process.env.AIRTABLE_PAT

// GET — list every Photo Account, normalized.
export async function GET() {
  try {
    await requireAdmin()
    const rows = await fetchAirtableRecords(TABLE, {
      fields: ['Handle', 'Enabled', 'Last Scraped At', 'Last Photos Scraped', 'Account Status', 'Notes'],
    })
    const accounts = rows.map(r => {
      const f = r.fields || {}
      return {
        id: r.id,
        handle: f.Handle || '',
        enabled: !!f.Enabled,
        lastScrapedAt: f['Last Scraped At'] || null,
        lastPhotosScraped: f['Last Photos Scraped'] || 0,
        accountStatus: f['Account Status']?.name || f['Account Status'] || 'Active',
        notes: f.Notes || '',
      }
    }).sort((a, b) => a.handle.localeCompare(b.handle))
    return NextResponse.json({ ok: true, accounts })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST { handles: ["latinamamiisabella", ...] }  —  Add new handles.
// Accepts comma- or newline-separated list. Idempotent: handles already
// in the table are skipped, never duplicated.
export async function POST(request) {
  try {
    await requireAdmin()
    const body = await request.json()
    const raw = Array.isArray(body.handles) ? body.handles : String(body.handles || '').split(/[\n,]+/)
    const clean = [...new Set(raw.map(h => String(h || '').replace(/^@/, '').trim().toLowerCase()).filter(Boolean))]
    if (!clean.length) return NextResponse.json({ error: 'no handles' }, { status: 400 })

    const existing = await fetchAirtableRecords(TABLE, { fields: ['Handle'] })
    const existingSet = new Set(existing.map(r => String(r.fields?.Handle || '').toLowerCase().trim()))
    const added = []
    const skipped = []
    for (const handle of clean) {
      if (existingSet.has(handle)) { skipped.push(handle); continue }
      try {
        const rec = await createAirtableRecord(TABLE, { Handle: handle, Enabled: true, 'Account Status': 'Active' })
        added.push({ id: rec.id, handle })
      } catch (e) {
        console.warn(`[photos/accounts] add ${handle} failed:`, e.message)
      }
    }
    return NextResponse.json({ ok: true, added, skipped })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH { id, fields }  —  Toggle Enabled, set status, etc.
export async function PATCH(request) {
  try {
    await requireAdmin()
    const { id, fields } = await request.json()
    if (!id || !/^rec[A-Za-z0-9]{14}$/.test(id)) {
      return NextResponse.json({ error: 'Valid id required' }, { status: 400 })
    }
    if (!fields || typeof fields !== 'object') {
      return NextResponse.json({ error: 'fields object required' }, { status: 400 })
    }
    await patchAirtableRecord(TABLE, id, fields, { typecast: true })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE ?id=rec...
export async function DELETE(request) {
  try {
    await requireAdmin()
    const id = new URL(request.url).searchParams.get('id')
    if (!id || !/^rec[A-Za-z0-9]{14}$/.test(id)) {
      return NextResponse.json({ error: 'Valid id required' }, { status: 400 })
    }
    const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(TABLE)}/${id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
    })
    if (!res.ok) return NextResponse.json({ error: `airtable ${res.status}` }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
