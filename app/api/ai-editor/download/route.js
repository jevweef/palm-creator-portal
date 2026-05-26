/**
 * POST /api/ai-editor/download
 * Body: { reelIds: string[] }
 *
 * Streams a single .zip of the selected pool reels' Dropbox videos,
 * foldered by source handle so the AI editor's files stay organized.
 * Downloading does NOT consume the reel — only an upload-back does.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { Readable } from 'node:stream'
import archiver from 'archiver'
import { requireAdminOrAiEditor, fetchAirtableRecords } from '@/lib/adminAuth'
import { getDropboxAccessToken } from '@/lib/dropbox'
import { quoteAirtableString } from '@/lib/airtableFormula'

const CONCURRENCY = 4

function rawLink(shareLink) {
  if (!shareLink) return null
  return String(shareLink).replace('dl=0', 'raw=1').replace('dl=1', 'raw=1')
}

export async function POST(request) {
  try {
    await requireAdminOrAiEditor()

    let reelIds
    try {
      reelIds = (await request.json()).reelIds
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    if (!Array.isArray(reelIds) || reelIds.length === 0) {
      return NextResponse.json({ error: 'reelIds required' }, { status: 400 })
    }
    if (!reelIds.every(id => /^rec[A-Za-z0-9]{14}$/.test(id))) {
      return NextResponse.json({ error: 'Invalid reel id' }, { status: 400 })
    }

    const rows = await fetchAirtableRecords('Recreate Reels', {
      fields: ['Reel ID', 'Source Handle', 'Dropbox Video Link'],
      filterByFormula: `OR(${reelIds.map(id => `RECORD_ID() = ${quoteAirtableString(id)}`).join(',')})`,
    })
    const reels = rows
      .map(r => ({
        id: r.id,
        name: `${(r.fields?.['Source Handle'] || 'account')}/${(r.fields?.['Reel ID'] || r.id)}.mp4`,
        url: rawLink(r.fields?.['Dropbox Video Link']),
      }))
      .filter(r => r.url)

    if (reels.length === 0) {
      return NextResponse.json({ error: 'No downloadable reels' }, { status: 404 })
    }

    const accessToken = await getDropboxAccessToken()

    async function fetchViaApi(link) {
      const res = await fetch('https://content.dropboxapi.com/2/sharing/get_shared_link_file', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Dropbox-API-Arg': JSON.stringify({ url: link }) },
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
          if (buf.length > 50_000) {
            const head = buf.slice(0, 16).toString('utf8')
            if (!head.includes('<!DOCTYPE') && !head.includes('<html')) {
              return { name: reel.name, buffer: buf }
            }
          }
        } catch (err) {
          console.warn(`[ai-editor download] ${reel.id} via ${label} failed: ${err.message}`)
        }
      }
      return null
    }

    const archive = archiver('zip', { zlib: { level: 0 }, store: true })

    ;(async () => {
      const pending = []
      let nextIdx = 0
      for (; nextIdx < Math.min(CONCURRENCY, reels.length); nextIdx++) {
        pending.push(fetchOne(reels[nextIdx]))
      }
      for (let appendIdx = 0; appendIdx < reels.length; appendIdx++) {
        const result = await pending[appendIdx]
        if (result) archive.append(result.buffer, { name: result.name })
        pending[appendIdx] = null
        if (nextIdx < reels.length) {
          pending[nextIdx] = fetchOne(reels[nextIdx])
          nextIdx++
        }
      }
      archive.finalize()
    })().catch(err => {
      console.error('[ai-editor download] fatal:', err)
      archive.abort()
    })

    const webStream = Readable.toWeb(archive)
    const today = new Date().toISOString().slice(0, 10)
    return new NextResponse(webStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="recreate-pool-${today}.zip"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
