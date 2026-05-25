/**
 * GET /api/admin/recreate-rooms/stage-b/outputs/zip?id=<stageBOutputId>
 *
 * Streams a .zip that's the complete "TJP batch" for one Stage B still:
 *   {slug}.zip
 *     {slug}/
 *       {slug}.jpg         — the canonical still
 *       {slug}_reel.mp4    — the source reel (the "dance")
 *       {slug}_O01.jpg     — outfit variant 1 (if any)
 *       {slug}_O02.jpg     — outfit variant 2
 *       ...
 *
 * Files are named with the canonical slug so the editor's local
 * directory mirrors what gets uploaded back. Pre-slug records fall
 * back to the legacy "{Creator} - Reel {N}" name.
 *
 * Rejected outfit variants are excluded — only Pending / Approved
 * variants make the bundle.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { Readable } from 'node:stream'
import archiver from 'archiver'
import { requireAdminOrAiEditor, fetchAirtableRecords, OPS_BASE } from '@/lib/adminAuth'
import { getDropboxAccessToken } from '@/lib/dropbox'
import { quoteAirtableString } from '@/lib/airtableFormula'

const OUTPUTS = 'Stage B Outputs'
const OUTFIT_SWAP_OUTPUTS = 'Outfit Swap Outputs'
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
    const slug = f.Slug || ''
    const photoUrl = rawLink(f['Dropbox Link']) || (Array.isArray(f.Image) && f.Image[0]?.url)
    if (!photoUrl) return NextResponse.json({ error: 'Output has no image yet (still transcoding?)' }, { status: 400 })

    // Resolve a stable label for the ZIP. Slug is preferred; pre-slug
    // records keep the legacy "{Creator} - Reel {N}" filename.
    let bundleName = slug
    if (!bundleName) {
      let aka = 'Creator', idx = 1
      if (creatorId) {
        const [cRecs, allOut] = await Promise.all([
          fetchAirtableRecords(PALM_CREATORS, { fields: ['AKA', 'Creator'], filterByFormula: `RECORD_ID() = ${quoteAirtableString(creatorId)}`, maxRecords: 1 }),
          fetchAirtableRecords(OUTPUTS, { fields: ['Creator'] }),
        ])
        aka = cRecs[0]?.fields?.AKA || cRecs[0]?.fields?.Creator || 'Creator'
        const mine = allOut
          .filter(o => (o.fields?.Creator || []).includes(creatorId))
          .sort((a, b) => (a.createdTime || '').localeCompare(b.createdTime || ''))
        const pos = mine.findIndex(o => o.id === id)
        if (pos >= 0) idx = pos + 1
      }
      bundleName = `${aka} - Reel ${idx}`.replace(/[^\w .-]/g, '').trim() || `Reel ${idx}`
    }

    // Fetch the source reel + every outfit variant that hangs off this
    // Stage B parent. Rejected variants are filtered out.
    const [variants, reelLookup] = await Promise.all([
      fetchAirtableRecords(OUTFIT_SWAP_OUTPUTS, {
        fields: ['Stage B Parent', 'Variant #', 'Status', 'Slug', 'Outfit', 'Image', 'Dropbox Link'],
      }),
      reelId
        ? fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(REELS)}/${reelId}`,
            { headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` }, cache: 'no-store' })
            .then(r => r.ok ? r.json() : null)
        : Promise.resolve(null),
    ])
    const videoUrl = rawLink(reelLookup?.fields?.['Dropbox Video Link'])
    const reelHandle = reelLookup?.fields?.['Source Handle'] || ''
    const reelInstaId = reelLookup?.fields?.['Reel ID'] || ''

    const myVariants = variants
      .filter(v => (v.fields?.['Stage B Parent'] || []).includes(id))
      .filter(v => {
        const s = v.fields?.Status?.name || v.fields?.Status
        return s !== 'Rejected' && s !== 'Failed' && s !== 'Generating'
      })
      .sort((a, b) => (a.fields?.['Variant #'] || 0) - (b.fields?.['Variant #'] || 0))

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

    const archive = archiver('zip', { zlib: { level: 0 }, store: true })

    ;(async () => {
      try {
        // 0. Manifest — tells the editor which slug corresponds to
        //    which outfit prompt, so they aren't matching O01/O02/O03
        //    against memory after a long TJP session.
        const manifestLines = [
          `Bundle: ${bundleName}`,
          slug ? `Stage B still: ${slug}.jpg` : `Stage B still: photo.jpg`,
          videoUrl ? `Source reel: ${slug ? slug + '_reel.mp4' : 'reel.mp4'}${reelHandle ? `  (from @${reelHandle}${reelInstaId ? ' / ' + reelInstaId : ''})` : ''}` : `Source reel: (not available)`,
          ``,
          `Outfit variants (${myVariants.length}):`,
          ...myVariants.map(v => {
            const vf = v.fields || {}
            const vSlug = vf.Slug || `outfit_${vf['Variant #'] || ''}`
            return `  ${vSlug}.jpg  —  ${vf.Outfit || '(no outfit prompt recorded)'}`
          }),
          ``,
          `Generated by Palm Creator Portal on ${new Date().toISOString()}.`,
        ]
        archive.append(Buffer.from(manifestLines.join('\n'), 'utf8'), { name: `${bundleName}/manifest.txt` })

        // 1. Canonical still
        const photo = await fetchBytes(photoUrl)
        const photoName = slug ? `${slug}.jpg` : 'photo.jpg'
        archive.append(photo, { name: `${bundleName}/${photoName}` })

        // 2. Source reel (the dance)
        if (videoUrl) {
          try {
            const vid = await fetchBytes(videoUrl)
            const reelName = slug ? `${slug}_reel.mp4` : 'reel.mp4'
            archive.append(vid, { name: `${bundleName}/${reelName}` })
          } catch (e) {
            console.warn(`[stage-b zip] video failed: ${e.message}`)
          }
        }

        // 3. Outfit variants (Pending + Approved)
        for (const v of myVariants) {
          const vf = v.fields || {}
          const vUrl = rawLink(vf['Dropbox Link']) || vf.Image?.[0]?.url
          if (!vUrl) continue
          try {
            const vBytes = await fetchBytes(vUrl)
            const vSlug = vf.Slug || `outfit_${vf['Variant #'] || ''}`
            archive.append(vBytes, { name: `${bundleName}/${vSlug}.jpg` })
          } catch (e) {
            console.warn(`[stage-b zip] outfit ${v.id} failed: ${e.message}`)
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
        'Content-Disposition': `attachment; filename="${bundleName}.zip"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
