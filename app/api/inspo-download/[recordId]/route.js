/**
 * Server-side proxy for inspo reel video downloads.
 *
 * Why this exists: fetching Dropbox dbRawLink directly from the browser
 * triggers a redirect to a different host (dl.dropboxusercontent.com) that
 * doesn't reliably set CORS headers, so the client-side blob fetch fails on
 * iOS Safari. We proxy the byte stream through our origin so the browser
 * sees a same-origin download and Web Share API + download anchor both work.
 */

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const BASE_ID = 'applLIT2t83plMqNx'
const INSPIRATION_TABLE = 'tblnQhATaMtpoYErb'

export const dynamic = 'force-dynamic'

function safeFilename(title) {
  const cleaned = (title || 'reel').replace(/[^a-zA-Z0-9-_ ]/g, '').trim()
  return (cleaned || 'reel') + '.mp4'
}

export async function GET(_request, { params }) {
  try {
    const { userId } = auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const recordId = params?.recordId
    if (!recordId || !/^rec[A-Za-z0-9]{14}$/.test(recordId)) {
      return NextResponse.json({ error: 'Invalid record ID' }, { status: 400 })
    }

    const atRes = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${INSPIRATION_TABLE}/${recordId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' },
    )
    if (!atRes.ok) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 })
    }
    const record = await atRes.json()
    const f = record.fields || {}
    const dbRaw = f['DB Raw = 1'] || ''
    const dbShare = f['DB Share Link'] || ''
    const url = dbRaw || (dbShare
      ? dbShare.replace('dl=0', 'raw=1').replace('dl=1', 'raw=1')
      : '')
    if (!url) {
      return NextResponse.json({ error: 'No video link on this record' }, { status: 404 })
    }

    const upstream = await fetch(url, { redirect: 'follow' })
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: `Upstream fetch failed (${upstream.status})` },
        { status: 502 },
      )
    }

    const filename = safeFilename(f['Title'])
    const headers = new Headers()
    headers.set('Content-Type', upstream.headers.get('content-type') || 'video/mp4')
    const len = upstream.headers.get('content-length')
    if (len) headers.set('Content-Length', len)
    headers.set('Content-Disposition', `attachment; filename="${filename}"`)
    // Encourage caching at the edge once a file is generated; the underlying
    // Dropbox content for a given record is immutable.
    headers.set('Cache-Control', 'private, max-age=3600')

    return new Response(upstream.body, { headers })
  } catch (err) {
    console.error('[inspo-download] error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
