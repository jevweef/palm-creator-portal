/**
 * GET /api/admin/recreate-rooms/stage-b/outputs/zip-stills?creatorId=<id>&reelId=<id>
 *
 * Flat ZIP of just the Stage B stills for one (creator, reel) project.
 * No source reel video, no per-slug subfolders, no manifest — only
 * what TJP needs as image-to-image inputs for the next pass.
 *
 *   Amelia_R002_stills_<date>.zip
 *     Amelia_R002_S01.jpg
 *     Amelia_R002_S02.jpg
 *     ...
 *
 * Includes any image-bearing status (Pending / Approved / Rejected).
 * The "approval" workflow doesn't gate this — the editor's already
 * looked at the scenes and clicked Download, that's signal enough.
 *
 * Optional ?statuses=Pending,Approved (comma list) narrows it.
 * Optional ?ids=rec1,rec2,... bypasses the reelId filter and grabs
 * exactly the listed records (max 50).
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 180

import { NextResponse } from 'next/server'
import { Readable } from 'node:stream'
import archiver from 'archiver'
import { requireAdminOrAiEditor, fetchAirtableRecords } from '@/lib/adminAuth'
import { getDropboxAccessToken } from '@/lib/dropbox'

const OUTPUTS = 'Stage B Outputs'
const PALM_CREATORS = 'Palm Creators'
const rawLink = u => u ? String(u).replace('dl=0', 'raw=1').replace('dl=1', 'raw=1') : null

export async function GET(request) {
  try {
    await requireAdminOrAiEditor()
    const u = new URL(request.url)
    const creatorId = u.searchParams.get('creatorId')
    const reelId = u.searchParams.get('reelId')
    const idsParam = u.searchParams.get('ids')
    const statusesParam = u.searchParams.get('statuses')
    const wantedStatuses = statusesParam
      ? new Set(statusesParam.split(',').map(s => s.trim()).filter(Boolean))
      : new Set(['Pending', 'Approved', 'Rejected'])

    if (!creatorId || !/^rec[A-Za-z0-9]{14}$/.test(creatorId)) {
      return NextResponse.json({ error: 'Valid creatorId required' }, { status: 400 })
    }

    const cRecs = await fetchAirtableRecords(PALM_CREATORS, {
      filterByFormula: `RECORD_ID()='${creatorId}'`,
      fields: ['AKA'],
      maxRecords: 1,
    })
    const aka = (cRecs[0]?.fields?.AKA || 'Creator').replace(/[^A-Za-z0-9_-]+/g, '')

    const allStills = await fetchAirtableRecords(OUTPUTS, {
      fields: ['Creator', 'Source Reel', 'Image', 'Dropbox Link', 'Slug', 'Status', 'Reel #'],
    })

    let stills = allStills.filter(s => (s.fields?.Creator || []).includes(creatorId))
    if (idsParam) {
      const wantedIds = new Set(idsParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, 50))
      stills = stills.filter(s => wantedIds.has(s.id))
    } else if (reelId && /^rec[A-Za-z0-9]{14}$/.test(reelId)) {
      stills = stills.filter(s => (s.fields?.['Source Reel'] || []).includes(reelId))
    }
    stills = stills.filter(s => {
      const st = s.fields?.Status?.name || s.fields?.Status
      return wantedStatuses.has(st)
    })
    stills = stills.filter(s => s.fields?.Slug && (s.fields?.['Dropbox Link'] || s.fields?.Image?.[0]?.url))
    stills.sort((a, b) => (a.fields?.Slug || '').localeCompare(b.fields?.Slug || ''))

    if (!stills.length) {
      return NextResponse.json({ error: 'No matching scenes to zip' }, { status: 400 })
    }

    const accessToken = await getDropboxAccessToken()
    const fetchBytes = async (link) => {
      try {
        const r = await fetch('https://content.dropboxapi.com/2/sharing/get_shared_link_file', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Dropbox-API-Arg': JSON.stringify({ url: link }) },
        })
        if (r.ok) return Buffer.from(await r.arrayBuffer())
      } catch {}
      const r2 = await fetch(link)
      if (!r2.ok) throw new Error(`fetch ${r2.status}`)
      return Buffer.from(await r2.arrayBuffer())
    }

    // Bundle name: prefer slug-derived reel id if all stills share one;
    // fall back to creator + date when the request spanned multiple reels.
    const reelNums = new Set(stills.map(s => s.fields?.['Reel #']).filter(Boolean))
    const oneReel = reelNums.size === 1 ? [...reelNums][0] : null
    const bundleName = oneReel
      ? `${aka}_R${String(oneReel).padStart(3, '0')}_stills_${new Date().toISOString().slice(0, 10)}`
      : `${aka}_stills_${new Date().toISOString().slice(0, 10)}`

    const archive = archiver('zip', { zlib: { level: 0 }, store: true })

    ;(async () => {
      try {
        for (const s of stills) {
          const sf = s.fields || {}
          const slug = sf.Slug
          const photoUrl = rawLink(sf['Dropbox Link']) || sf.Image?.[0]?.url
          if (!photoUrl) continue
          try {
            const bytes = await fetchBytes(photoUrl)
            archive.append(bytes, { name: `${slug}.jpg` })
          } catch (e) { console.warn(`[zip-stills] ${slug} failed:`, e.message) }
        }
      } catch (e) {
        console.error('[zip-stills] fatal:', e.message)
      }
      archive.finalize()
    })().catch(err => { console.error('[zip-stills] archive aborted:', err); archive.abort() })

    return new NextResponse(Readable.toWeb(archive), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${bundleName}.zip"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
