/**
 * POST /api/inspo/bulk-download
 *
 * Body: { creatorOpsId: string, force?: boolean }
 *
 * Streams a single .zip of every reel the creator has saved that they
 * haven't already downloaded. Each record gets its `Downloaded By` field
 * updated as we package it, so a second click only zips the newly-saved
 * reels added since last time. Pass `force: true` to re-download
 * everything regardless of state.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { Readable } from 'node:stream'
import archiver from 'archiver'
import { getDropboxAccessToken } from '@/lib/dropbox'

const BASE_ID = 'applLIT2t83plMqNx'
const INSPIRATION_TABLE = 'tblnQhATaMtpoYErb'
const AIRTABLE_PAT = process.env.AIRTABLE_PAT

const CONCURRENCY = 4

const safeName = (title) => {
  const cleaned = (title || 'reel').replace(/[^a-zA-Z0-9-_ ]/g, '').trim()
  return (cleaned || 'reel') + '.mp4'
}

function getLinkedIds(val) {
  return (val || []).map((c) => (typeof c === 'string' ? c : c?.id)).filter(Boolean)
}

async function listSavedNotDownloaded(creatorOpsId, force) {
  const headers = { Authorization: `Bearer ${AIRTABLE_PAT}` }
  // Match linked-record fields by FIND on ARRAYJOIN since filterByFormula
  // can't filter on link arrays directly.
  const formula = force
    ? `FIND('${creatorOpsId}', ARRAYJOIN({Saved By}))`
    : `AND(FIND('${creatorOpsId}', ARRAYJOIN({Saved By})), NOT(FIND('${creatorOpsId}', ARRAYJOIN({Downloaded By}))))`

  const out = []
  let offset = null
  do {
    const params = new URLSearchParams({
      filterByFormula: formula,
      pageSize: '100',
    })
    for (const f of ['Title', 'DB Share Link', 'DB Raw = 1', 'Saved By', 'Downloaded By']) {
      params.append('fields[]', f)
    }
    if (offset) params.set('offset', offset)
    const r = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${INSPIRATION_TABLE}?${params}`,
      { headers, cache: 'no-store' },
    )
    if (!r.ok) throw new Error(`Airtable list ${r.status}: ${await r.text()}`)
    const j = await r.json()
    for (const rec of j.records || []) {
      const f = rec.fields || {}
      const url = f['DB Raw = 1'] || (f['DB Share Link']
        ? String(f['DB Share Link']).replace('dl=0', 'raw=1').replace('dl=1', 'raw=1')
        : null)
      if (!url) continue
      out.push({ id: rec.id, title: f['Title'] || 'reel', url })
    }
    offset = j.offset || null
  } while (offset)
  return out
}

async function batchMarkDownloaded(recordIds, creatorOpsId) {
  // Read-modify-write: union creator into existing Downloaded By list.
  // Airtable PATCH with `typecast: true` so a brand-new linked option is
  // accepted. Chunk to 10 records per request (Airtable limit).
  const headers = {
    Authorization: `Bearer ${AIRTABLE_PAT}`,
    'Content-Type': 'application/json',
  }

  // Read existing Downloaded By for each so we don't clobber other creators
  // who've already downloaded the same reel.
  const existing = {}
  for (let i = 0; i < recordIds.length; i += 10) {
    const chunk = recordIds.slice(i, i + 10)
    const params = new URLSearchParams({
      filterByFormula: `OR(${chunk.map((id) => `RECORD_ID()='${id}'`).join(',')})`,
    })
    params.append('fields[]', 'Downloaded By')
    const r = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${INSPIRATION_TABLE}?${params}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' },
    )
    if (!r.ok) continue
    const j = await r.json()
    for (const rec of j.records || []) {
      existing[rec.id] = getLinkedIds(rec.fields?.['Downloaded By'])
    }
  }

  for (let i = 0; i < recordIds.length; i += 10) {
    const chunk = recordIds.slice(i, i + 10)
    const body = {
      typecast: true,
      records: chunk.map((id) => {
        const current = new Set(existing[id] || [])
        current.add(creatorOpsId)
        return { id, fields: { 'Downloaded By': Array.from(current) } }
      }),
    }
    const res = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${INSPIRATION_TABLE}`,
      { method: 'PATCH', headers, body: JSON.stringify(body) },
    )
    if (!res.ok) {
      console.error('[bulk-download] mark Downloaded By failed', res.status, await res.text())
    }
  }
}

export async function POST(request) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let creatorOpsId, force
  try {
    const body = await request.json()
    creatorOpsId = body.creatorOpsId
    force = !!body.force
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!creatorOpsId || !/^rec[A-Za-z0-9]{14}$/.test(creatorOpsId)) {
    return NextResponse.json({ error: 'creatorOpsId required' }, { status: 400 })
  }

  // Ownership check — creators can only bulk-download their own saves
  const user = await currentUser()
  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin' || role === 'super_admin' || role === 'editor'
  if (!isAdmin && user?.publicMetadata?.airtableOpsId !== creatorOpsId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let reels
  try {
    reels = await listSavedNotDownloaded(creatorOpsId, force)
  } catch (err) {
    return NextResponse.json({ error: 'Failed to list saved reels', detail: err.message }, { status: 500 })
  }
  if (reels.length === 0) {
    return NextResponse.json({ error: 'Nothing new to download' }, { status: 404 })
  }

  let accessToken
  try {
    accessToken = await getDropboxAccessToken()
  } catch (err) {
    return NextResponse.json({ error: 'Dropbox auth failed', detail: err.message }, { status: 500 })
  }

  // Dropbox sometimes returns a 200 OK HTML interstitial on the public dl=1
  // URL instead of the file bytes. Hit the authenticated content API first,
  // fall back to public URL on failure.
  async function fetchViaApi(link) {
    const res = await fetch('https://content.dropboxapi.com/2/sharing/get_shared_link_file', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Dropbox-API-Arg': JSON.stringify({ url: link }),
      },
    })
    if (!res.ok) throw new Error(`Dropbox API ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }

  async function fetchViaPublic(link) {
    const res = await fetch(link)
    if (!res.ok) throw new Error(`Public ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }

  async function fetchOne(reel) {
    for (const [label, fn] of [['api', fetchViaApi], ['public', fetchViaPublic]]) {
      try {
        const buf = await fn(reel.url)
        // Sanity check: video files should be at least a few hundred KB and
        // not start with HTML
        if (buf.length > 50_000) {
          const head = buf.slice(0, 16).toString('utf8')
          if (!head.includes('<!DOCTYPE') && !head.includes('<html')) {
            return { name: safeName(reel.title), buffer: buf }
          }
        }
        console.warn(`[inspo bulk-download] ${reel.id} via ${label}: ${buf.length} bytes, suspicious`)
      } catch (err) {
        console.warn(`[inspo bulk-download] ${reel.id} via ${label} failed: ${err.message}`)
      }
    }
    return null
  }

  const archive = archiver('zip', { zlib: { level: 0 }, store: true })
  const downloadedIds = []

  ;(async () => {
    const pending = []
    let nextIdx = 0
    for (; nextIdx < Math.min(CONCURRENCY, reels.length); nextIdx++) {
      pending.push(fetchOne(reels[nextIdx]))
    }
    for (let appendIdx = 0; appendIdx < reels.length; appendIdx++) {
      const result = await pending[appendIdx]
      if (result) {
        archive.append(result.buffer, { name: result.name })
        downloadedIds.push(reels[appendIdx].id)
      }
      pending[appendIdx] = null
      if (nextIdx < reels.length) {
        pending[nextIdx] = fetchOne(reels[nextIdx])
        nextIdx++
      }
    }
    archive.finalize()

    // Mark Downloaded By only for reels that actually made it into the zip.
    // If anything fails we don't want to lie about state. Done after
    // finalize() so the zip stream isn't blocked on Airtable writes.
    if (downloadedIds.length > 0) {
      try {
        await batchMarkDownloaded(downloadedIds, creatorOpsId)
      } catch (e) {
        console.error('[inspo bulk-download] mark Downloaded By failed (non-fatal):', e)
      }
    }
  })().catch((err) => {
    console.error('[inspo bulk-download] entry loop fatal:', err)
    archive.abort()
  })

  const webStream = Readable.toWeb(archive)
  const today = new Date().toISOString().slice(0, 10)
  const filename = `inspo-saved-${today}.zip`

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
