/**
 * GET /api/admin/recreate-rooms/stage-b/outputs/zip?id=<outputId>
 *
 * Streams a .zip with the two things the off-site motion-control step
 * needs: the Stage B still (photo.jpg) + the source reel (reel.mp4).
 * Named "{Creator} - Reel {N}.zip" where N is that creator's 1-based
 * Stage B output index (oldest = 1).
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { Readable } from 'node:stream'
import archiver from 'archiver'
import { requireAdminOrAiEditor, fetchAirtableRecords, OPS_BASE } from '@/lib/adminAuth'
import { getDropboxAccessToken } from '@/lib/dropbox'

const OUTPUTS = 'Stage B Outputs'
const REELS = 'Recreate Reels'
const PALM_CREATORS = 'Palm Creators'
const rawLink = u => u ? String(u).replace('dl=0', 'raw=1').replace('dl=1', 'raw=1') : null

export async function GET(request) {
  try {
    await requireAdminOrAiEditor()
    const id = new URL(request.url).searchParams.get('id')
    if (!id || !/^rec[A-Za-z0-9]{14}$/.test(id)) {
      return NextResponse.json({ error: 'Valid id required' }, { status: 400 })
    }

    const recRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(OUTPUTS)}/${id}`,
      { headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` }, cache: 'no-store' })
    if (!recRes.ok) return NextResponse.json({ error: 'Output not found' }, { status: 404 })
    const f = (await recRes.json()).fields || {}
    const creatorId = (f.Creator || [])[0]
    const reelId = (f['Source Reel'] || [])[0]
    const photoUrl = rawLink(f['Dropbox Link']) || (Array.isArray(f.Image) && f.Image[0]?.url)
    if (!photoUrl) return NextResponse.json({ error: 'Output has no image yet (still transcoding?)' }, { status: 400 })

    // Creator AKA + this output's 1-based index among that creator's
    // outputs (oldest first), so the label is stable.
    let aka = 'Creator', idx = 1
    if (creatorId) {
      const [cRecs, allOut] = await Promise.all([
        fetchAirtableRecords(PALM_CREATORS, { fields: ['AKA', 'Creator'], filterByFormula: `RECORD_ID()='${creatorId}'`, maxRecords: 1 }),
        fetchAirtableRecords(OUTPUTS, { fields: ['Creator'] }),
      ])
      aka = cRecs[0]?.fields?.AKA || cRecs[0]?.fields?.Creator || 'Creator'
      const mine = allOut
        .filter(o => (o.fields?.Creator || []).includes(creatorId))
        .sort((a, b) => (a.createdTime || '').localeCompare(b.createdTime || ''))
      const pos = mine.findIndex(o => o.id === id)
      if (pos >= 0) idx = pos + 1
    }

    let videoUrl = null
    if (reelId) {
      const rRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(REELS)}/${reelId}`,
        { headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` }, cache: 'no-store' })
      if (rRes.ok) videoUrl = rawLink((await rRes.json()).fields?.['Dropbox Video Link'])
    }

    const accessToken = await getDropboxAccessToken()
    const fetchBytes = async (link) => {
      // Dropbox shared-link API first (handles private links), then public.
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

    const safe = `${aka} - Reel ${idx}`.replace(/[^\w .-]/g, '').trim() || `Reel ${idx}`
    const archive = archiver('zip', { zlib: { level: 0 }, store: true })

    ;(async () => {
      try {
        const photo = await fetchBytes(photoUrl)
        archive.append(photo, { name: `${safe}/photo.jpg` })
        if (videoUrl) {
          try {
            const vid = await fetchBytes(videoUrl)
            archive.append(vid, { name: `${safe}/reel.mp4` })
          } catch (e) {
            console.warn(`[stage-b zip] video failed: ${e.message}`)
          }
        }
      } catch (e) {
        console.error('[stage-b zip] photo failed:', e.message)
      }
      archive.finalize()
    })().catch(err => { console.error('[stage-b zip] fatal:', err); archive.abort() })

    return new NextResponse(Readable.toWeb(archive), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${safe}.zip"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
