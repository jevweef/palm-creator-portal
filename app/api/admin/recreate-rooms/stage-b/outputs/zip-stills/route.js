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
const OUTFIT_SWAP_OUTPUTS = 'Outfit Swap Outputs'
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

    const [allStills, allVariants] = await Promise.all([
      fetchAirtableRecords(OUTPUTS, {
        fields: ['Creator', 'Source Reel', 'Image', 'Dropbox Link', 'Slug', 'Status', 'Reel #'],
      }),
      // Outfit variants under each Stage B parent. Empty today but
      // gets populated once outfit fan-out lands; we want the ZIP to
      // pick them up automatically when they appear.
      fetchAirtableRecords(OUTFIT_SWAP_OUTPUTS, {
        fields: ['Stage B Parent', 'Variant #', 'Status', 'Slug', 'Image', 'Dropbox Link'],
      }),
    ])

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

    // Group outfit variants by their Stage B parent so we can fan
    // them out under each still in the ZIP.
    const stillIds = new Set(stills.map(s => s.id))
    const variantsByParent = {}
    for (const v of allVariants) {
      const pid = (v.fields?.['Stage B Parent'] || [])[0]
      if (!pid || !stillIds.has(pid)) continue
      const st = v.fields?.Status?.name || v.fields?.Status
      if (st === 'Rejected' || st === 'Failed' || st === 'Generating') continue
      ;(variantsByParent[pid] ||= []).push(v)
    }
    for (const arr of Object.values(variantsByParent)) {
      arr.sort((a, b) => (a.fields?.['Variant #'] || 0) - (b.fields?.['Variant #'] || 0))
    }

    ;(async () => {
      try {
        for (const s of stills) {
          const sf = s.fields || {}
          const slug = sf.Slug
          const photoUrl = rawLink(sf['Dropbox Link']) || sf.Image?.[0]?.url
          if (photoUrl) {
            try {
              const bytes = await fetchBytes(photoUrl)
              archive.append(bytes, { name: `${slug}.jpg` })
            } catch (e) { console.warn(`[zip-stills] ${slug} failed:`, e.message) }
          }
          // Outfit variants under this still — naming follows the
          // existing slug convention: Amelia_R002_S03_O01.jpg.
          const vs = variantsByParent[s.id] || []
          for (const v of vs) {
            const vf = v.fields || {}
            const vUrl = rawLink(vf['Dropbox Link']) || vf.Image?.[0]?.url
            const vSlug = vf.Slug || `${slug}_O${String(vf['Variant #'] || 0).padStart(2, '0')}`
            if (!vUrl) continue
            try {
              const vBytes = await fetchBytes(vUrl)
              archive.append(vBytes, { name: `${vSlug}.jpg` })
            } catch (e) { console.warn(`[zip-stills] variant ${vSlug} failed:`, e.message) }
          }
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
