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
import sharp from 'sharp'
import { requireAdminOrAiEditor, fetchAirtableRecords } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, downloadFromDropbox } from '@/lib/dropbox'

const OUTPUTS = 'Stage B Outputs'
const OUTFIT_SWAP_OUTPUTS = 'Outfit Swap Outputs'
const REELS = 'Recreate Reels'
const PHOTOS = 'Photos'
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

    const [allStills, allVariants, allReels] = await Promise.all([
      fetchAirtableRecords(OUTPUTS, {
        fields: ['Creator', 'Source Reel', 'Image', 'Dropbox Link', 'Slug', 'Status', 'Reel #'],
      }),
      // Outfit variants under each Stage B parent. Empty today but
      // gets populated once outfit fan-out lands; we want the ZIP to
      // pick them up automatically when they appear.
      fetchAirtableRecords(OUTFIT_SWAP_OUTPUTS, {
        fields: ['Stage B Parent', 'Variant #', 'Status', 'Slug', 'Image', 'Dropbox Link'],
      }),
      // Reel rows — needed to pull Selected Outfits for the reel(s)
      // represented by the stills, so we can bundle the outfit
      // reference photos alongside the scenes (TJP needs both).
      fetchAirtableRecords(REELS, { fields: ['Selected Outfits'] }),
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

    // Defensive PNG→JPEG coercion for legacy Stage B stills + flatlays.
    // Wan and GPT return PNG bytes; older outputs were saved as .jpg
    // without re-encoding so Finder / TJP flag them as malformed.
    // Sniff the magic bytes and re-encode when the extension lies.
    const coerceJpegIfNeeded = async (buf) => {
      if (!buf || buf.length < 8) return buf
      const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
      if (!isPng) return buf
      try {
        return await sharp(buf).jpeg({ quality: 92, mozjpeg: true }).toBuffer()
      } catch (e) {
        console.warn('[zip-stills] jpeg re-encode failed, keeping raw bytes:', e.message)
        return buf
      }
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

    // Collect outfit reference photos for the reel(s) in scope. The
    // editor needs the raw outfit images alongside the scenes so TJP
    // can use them as outfit-swap reference inputs. Pick-order from
    // Selected Outfits drives the filename index (matches what the
    // workflow strip shows). Across multi-reel ZIPs we union the
    // outfits, deduped by Photo id.
    const reelIdsInScope = new Set()
    for (const s of stills) {
      for (const id of (s.fields?.['Source Reel'] || [])) reelIdsInScope.add(id)
    }
    const reelById = Object.fromEntries(allReels.map(r => [r.id, r.fields || {}]))
    const orderedOutfitIds = []
    const seenOutfit = new Set()
    for (const rid of reelIdsInScope) {
      for (const oid of (reelById[rid]?.['Selected Outfits'] || [])) {
        if (seenOutfit.has(oid)) continue
        seenOutfit.add(oid); orderedOutfitIds.push(oid)
      }
    }
    let outfitPhotos = []
    if (orderedOutfitIds.length > 0) {
      const expr = orderedOutfitIds.map(id => `RECORD_ID() = '${id}'`).join(', ')
      const rows = await fetchAirtableRecords(PHOTOS, {
        fields: ['Source Handle', 'Source Post URL', 'Carousel Index', 'Dropbox Path', 'CDN URL', 'Image',
          'Flatlay Status', 'Flatlay Dropbox Path', 'Flatlay CDN URL', 'Flatlay Model'],
        filterByFormula: `OR(${expr})`,
      })
      const byId = Object.fromEntries(rows.map(r => [r.id, r]))
      outfitPhotos = orderedOutfitIds.map(id => byId[id]).filter(Boolean)
    }

    // Dropbox helpers — only initialized if we have any outfit photos
    // that need Dropbox fallback (CDN URL is preferred when present).
    let dbxToken = null, dbxNs = null
    const ensureDbx = async () => {
      if (dbxToken && dbxNs) return
      dbxToken = await getDropboxAccessToken()
      dbxNs = await getDropboxRootNamespaceId(dbxToken)
    }

    // Slug collisions happen when the editor regenerates against the
    // same scene number (e.g. two Amelia_R002_S03 records). Archiver
    // keys by filename, so duplicate appends drop silently. Track
    // seen names + suffix collisions _b, _c, _d so every record makes
    // it into the ZIP.
    const seenNames = new Map() // base.jpg -> count
    const uniqueName = (base) => {
      const n = (seenNames.get(base) || 0) + 1
      seenNames.set(base, n)
      if (n === 1) return base
      // base = "Amelia_R002_S03.jpg" → "Amelia_R002_S03_b.jpg"
      const dot = base.lastIndexOf('.')
      const stem = dot > 0 ? base.slice(0, dot) : base
      const ext = dot > 0 ? base.slice(dot) : ''
      return `${stem}_${String.fromCharCode(96 + n)}${ext}` // 97='a' so n=2 → 'b'
    }

    ;(async () => {
      try {
        for (const s of stills) {
          const sf = s.fields || {}
          const slug = sf.Slug
          const photoUrl = rawLink(sf['Dropbox Link']) || sf.Image?.[0]?.url
          if (photoUrl) {
            try {
              const raw = await fetchBytes(photoUrl)
              const bytes = await coerceJpegIfNeeded(raw)
              archive.append(bytes, { name: uniqueName(`${slug}.jpg`) })
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
              const raw = await fetchBytes(vUrl)
              const vBytes = await coerceJpegIfNeeded(raw)
              archive.append(vBytes, { name: uniqueName(`${vSlug}.jpg`) })
            } catch (e) { console.warn(`[zip-stills] variant ${vSlug} failed:`, e.message) }
          }
        }
        // Outfit reference photos under an outfits/ subfolder so TJP
        // can grab them as a batch without mixing them up with the
        // scene stills. Filename = NN_<handle>.{ext}, NN matches the
        // pick-order in the workflow strip; ext follows the actual
        // Dropbox file (Pinterest uploads may be png/webp).
        //
        // BYTE-FIDELITY: Dropbox first, NOT CDN. The Cloudflare Images
        // "public" variant compresses + can resize, which downsized
        // Pinterest uploads from 1.3 MB → 50 KB and broke TJP's pixel
        // minimum check. CDN is only the last-ditch fallback for rows
        // that somehow lack a Dropbox path.
        const extOf = (p) => {
          const m = String(p || '').toLowerCase().match(/\.([a-z0-9]+)$/)
          const e = m?.[1] || 'jpg'
          return e === 'jpeg' ? 'jpg' : e
        }
        for (let i = 0; i < outfitPhotos.length; i++) {
          const op = outfitPhotos[i]
          const f = op.fields || {}
          const handle = (f['Source Handle'] || 'creator').replace(/[^A-Za-z0-9_-]+/g, '')
          const idx = String(i + 1).padStart(2, '0')

          // PREFER FLATLAY when one exists. The editor picked outfits
          // in the modal seeing the flatlay thumbnails (clean product
          // shot on white) — they expect TJP to receive those, not the
          // contextual Pinterest photo with the model in it. Falls back
          // to the original photo if no flatlay has been generated.
          const flatlayReady = (f['Flatlay Status']?.name || f['Flatlay Status']) === 'Done'
          const flatlayDbx = f['Flatlay Dropbox Path'] || ''
          const flatlayCdn = f['Flatlay CDN URL'] || ''
          const useFlatlay = flatlayReady && (flatlayDbx || flatlayCdn)
          const sourceLabel = useFlatlay ? `flatlay-${f['Flatlay Model'] || 'nano'}` : 'original'
          const dbxPath = useFlatlay ? flatlayDbx : (f['Dropbox Path'] || '')
          const cdnUrl = useFlatlay ? flatlayCdn : (f['CDN URL'] || '')
          const ext = extOf(dbxPath || 'x.jpg')
          // Flat ZIP — no subfolder. Editor wanted outfits sitting
          // alongside the scene stills so TJP picks them up in a
          // single import without re-walking folders. "outfit-" prefix
          // keeps them visually grouped without isolating them.
          const name = `outfit-${idx}_${handle}_${sourceLabel}.${ext}`

          try {
            let bytes = null
            // Dropbox first — full-resolution original bytes (or the
            // flatlay's full-res when flatlay is chosen).
            if (dbxPath) {
              await ensureDbx()
              bytes = await downloadFromDropbox(dbxToken, dbxNs, dbxPath)
            }
            // CDN fallback only when Dropbox doesn't have it.
            // Warning: CF's public variant is compressed; this is a
            // safety net, not the preferred source.
            if (!bytes && cdnUrl) {
              try { bytes = await fetchBytes(cdnUrl) } catch {}
            }
            if (!bytes && f.Image?.[0]?.url) {
              bytes = await fetchBytes(f.Image[0].url)
            }
            if (bytes) archive.append(bytes, { name })
            else console.warn(`[zip-stills] outfit ${op.id} (${name}) had no bytes source`)
          } catch (e) {
            console.warn(`[zip-stills] outfit ${name} failed:`, e.message)
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
