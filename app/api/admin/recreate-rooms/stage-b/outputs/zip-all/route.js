/**
 * GET /api/admin/recreate-rooms/stage-b/outputs/zip-all?creatorId=<id>
 *
 * Streams ONE archive containing every approved Stage B still for the
 * creator + each still's reel + outfit variants, in slug-named folders:
 *
 *   {Aka}_TJP_Batch_{YYYY-MM-DD}.zip
 *     manifest.txt                       (master index)
 *     Amelia_R042_S01/
 *       manifest.txt
 *       Amelia_R042_S01.jpg
 *       Amelia_R042_S01_reel.mp4
 *       Amelia_R042_S01_O01.jpg
 *       ...
 *     Amelia_R047_S01/
 *       ...
 *
 * Replaces the "8 separate ZIP clicks" pain point. One click = the
 * whole day's TJP input set.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { Readable } from 'node:stream'
import archiver from 'archiver'
import { requireAdminOrAiEditor, fetchAirtableRecords, OPS_BASE } from '@/lib/adminAuth'
import { getDropboxAccessToken } from '@/lib/dropbox'

const OUTPUTS = 'Stage B Outputs'
const OUTFIT_SWAP_OUTPUTS = 'Outfit Swap Outputs'
const REELS = 'Recreate Reels'
const PALM_CREATORS = 'Palm Creators'
const rawLink = u => u ? String(u).replace('dl=0', 'raw=1').replace('dl=1', 'raw=1') : null

export async function GET(request) {
  try {
    await requireAdminOrAiEditor()
    const creatorId = new URL(request.url).searchParams.get('creatorId')
    if (!creatorId || !/^rec[A-Za-z0-9]{14}$/.test(creatorId)) {
      return NextResponse.json({ error: 'Valid creatorId required' }, { status: 400 })
    }

    // Resolve creator AKA for the archive filename.
    const cRecs = await fetchAirtableRecords(PALM_CREATORS, {
      filterByFormula: `RECORD_ID()='${creatorId}'`,
      fields: ['AKA', 'Creator'],
      maxRecords: 1,
    })
    const aka = (cRecs[0]?.fields?.AKA || cRecs[0]?.fields?.Creator || 'Creator').replace(/[^A-Za-z0-9_-]+/g, '')

    // Pull approved Stage B Outputs + every outfit variant + every reel
    // they reference. One table scan per table — beats N round-trips.
    const [allStills, allVariants, allReels] = await Promise.all([
      fetchAirtableRecords(OUTPUTS, {
        fields: ['Creator', 'Source Reel', 'Image', 'Dropbox Link', 'Slug', 'Status'],
      }),
      fetchAirtableRecords(OUTFIT_SWAP_OUTPUTS, {
        fields: ['Stage B Parent', 'Variant #', 'Status', 'Slug', 'Outfit', 'Image', 'Dropbox Link'],
      }),
      fetchAirtableRecords(REELS, {
        fields: ['Reel ID', 'Dropbox Video Link', 'Source Handle'],
      }),
    ])
    const reelById = Object.fromEntries(allReels.map(r => [r.id, r.fields || {}]))

    const myStills = allStills
      .filter(s => (s.fields?.Creator || []).includes(creatorId))
      .filter(s => {
        const st = s.fields?.Status?.name || s.fields?.Status
        return st === 'Approved'
      })
      .filter(s => s.fields?.Slug && (s.fields?.['Dropbox Link'] || s.fields?.Image?.[0]?.url))
      .sort((a, b) => (a.fields?.Slug || '').localeCompare(b.fields?.Slug || ''))

    if (!myStills.length) {
      return NextResponse.json({ error: `No approved Stage B stills for ${aka}. Approve some first.` }, { status: 400 })
    }

    const variantsByParent = {}
    for (const v of allVariants) {
      const pid = (v.fields?.['Stage B Parent'] || [])[0]
      if (!pid) continue
      const st = v.fields?.Status?.name || v.fields?.Status
      if (st === 'Rejected' || st === 'Failed' || st === 'Generating') continue
      ;(variantsByParent[pid] ||= []).push(v)
    }
    for (const arr of Object.values(variantsByParent)) {
      arr.sort((a, b) => (a.fields?.['Variant #'] || 0) - (b.fields?.['Variant #'] || 0))
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

    const bundleName = `${aka}_TJP_Batch_${new Date().toISOString().slice(0, 10)}`
    const archive = archiver('zip', { zlib: { level: 0 }, store: true })

    ;(async () => {
      try {
        // Master manifest — high-level index over the whole bundle.
        const totalVariants = myStills.reduce((n, s) => n + (variantsByParent[s.id]?.length || 0), 0)
        const masterLines = [
          `${aka} — TJP batch (${new Date().toISOString().slice(0, 10)})`,
          `${myStills.length} approved Stage B still${myStills.length === 1 ? '' : 's'}, ${totalVariants} outfit variant${totalVariants === 1 ? '' : 's'} total.`,
          ``,
          `Each subfolder is one Stage B still + its source reel + its outfit variants.`,
          `Upload finished motion videos via Batch Upload on /ai-editor.`,
          ``,
          ...myStills.map(s => {
            const vs = variantsByParent[s.id] || []
            return `  ${s.fields.Slug}/ — ${vs.length} outfit${vs.length === 1 ? '' : 's'}`
          }),
        ]
        archive.append(Buffer.from(masterLines.join('\n'), 'utf8'), { name: `${bundleName}/manifest.txt` })

        // Per-still folder. Each gets its own manifest, still, reel, variants.
        for (const s of myStills) {
          const sf = s.fields || {}
          const slug = sf.Slug
          const reelLookup = (sf['Source Reel'] || [])[0]
          const rf = reelLookup ? reelById[reelLookup] : null
          const videoUrl = rawLink(rf?.['Dropbox Video Link'])
          const photoUrl = rawLink(sf['Dropbox Link']) || sf.Image?.[0]?.url
          const vs = variantsByParent[s.id] || []

          // Per-still manifest
          const lines = [
            `Still: ${slug}.jpg`,
            videoUrl ? `Reel:  ${slug}_reel.mp4  (from @${rf?.['Source Handle'] || ''}${rf?.['Reel ID'] ? ' / ' + rf['Reel ID'] : ''})` : `Reel:  (not available)`,
            ``,
            `Outfit variants (${vs.length}):`,
            ...vs.map(v => {
              const vf = v.fields || {}
              const vSlug = vf.Slug || `outfit_${vf['Variant #'] || ''}`
              return `  ${vSlug}.jpg  —  ${vf.Outfit || '(no outfit prompt)'}`
            }),
          ]
          archive.append(Buffer.from(lines.join('\n'), 'utf8'), { name: `${bundleName}/${slug}/manifest.txt` })

          // Still
          if (photoUrl) {
            try {
              const photo = await fetchBytes(photoUrl)
              archive.append(photo, { name: `${bundleName}/${slug}/${slug}.jpg` })
            } catch (e) { console.warn(`[zip-all] still ${slug} failed:`, e.message) }
          }
          // Reel
          if (videoUrl) {
            try {
              const vid = await fetchBytes(videoUrl)
              archive.append(vid, { name: `${bundleName}/${slug}/${slug}_reel.mp4` })
            } catch (e) { console.warn(`[zip-all] reel ${slug} failed:`, e.message) }
          }
          // Variants
          for (const v of vs) {
            const vf = v.fields || {}
            const vUrl = rawLink(vf['Dropbox Link']) || vf.Image?.[0]?.url
            const vSlug = vf.Slug || `outfit_${vf['Variant #'] || ''}`
            if (!vUrl) continue
            try {
              const vBytes = await fetchBytes(vUrl)
              archive.append(vBytes, { name: `${bundleName}/${slug}/${vSlug}.jpg` })
            } catch (e) { console.warn(`[zip-all] variant ${vSlug} failed:`, e.message) }
          }
        }
      } catch (e) {
        console.error('[zip-all] fatal:', e.message)
      }
      archive.finalize()
    })().catch(err => { console.error('[zip-all] archive aborted:', err); archive.abort() })

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
