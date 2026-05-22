import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'
import { pollWaveSpeedTask } from '@/lib/wavespeed'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox } from '@/lib/dropbox'
import { uploadImageBytes, buildDeliveryUrl, isCloudflareImagesConfigured } from '@/lib/cloudflareImages'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST { photoId } — recover a flatlay whose generation got abandoned.
//
// The /flatlay route holds the serverless function open for up to ~80s
// polling WaveSpeed. If WaveSpeed takes longer than that (heavy queues,
// big inputs, etc.) Vercel kills the function — the Airtable row stays
// pinned to "Flatlay Status = Generating" forever even though WaveSpeed
// usually completes successfully a few seconds later.
//
// This route reads the row's `Flatlay Prediction ID` (saved during
// submit), polls WaveSpeed directly, and finishes the job: download
// the output, re-encode JPEG, push to Dropbox + Cloudflare Images,
// patch the row to Done.
//
// Returns the same shape as the main flatlay route on success. On
// "still generating" returns 202 so the client can retry. On WaveSpeed
// failure, marks the row Failed and returns 502.
export async function POST(request) {
  try {
    await requireAdmin()
    const { photoId } = await request.json()
    if (!photoId || !/^rec[A-Za-z0-9]{14}$/.test(photoId)) {
      return NextResponse.json({ error: 'Valid photoId required' }, { status: 400 })
    }

    const rows = await fetchAirtableRecords('Photos', {
      fields: ['Source Handle', 'Source Post URL', 'Carousel Index', 'Flatlay Status', 'Flatlay Prediction ID', 'Flatlay Model', 'Flatlay Locked', 'Flatlay Variants'],
      filterByFormula: `RECORD_ID() = '${photoId}'`,
    })
    if (!rows.length) return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
    const f = rows[0].fields || {}
    if (f['Flatlay Locked']) {
      return NextResponse.json({ error: 'Flatlay is locked' }, { status: 409 })
    }
    const predictionId = f['Flatlay Prediction ID'] || ''
    if (!predictionId) {
      // No prediction saved — there's nothing to resume. Reset state so
      // the editor can run a fresh generation.
      await patchAirtableRecord('Photos', photoId, { 'Flatlay Status': 'None' }, { typecast: true })
      return NextResponse.json({ error: 'No prediction ID on row; reset to None — try generating again.' }, { status: 400 })
    }

    const modelKey = f['Flatlay Model'] || 'nano'
    const handle = (f['Source Handle'] || 'unknown').replace(/[^A-Za-z0-9_-]+/g, '-').toLowerCase()
    const idx = f['Carousel Index'] || 1
    const code = (f['Source Post URL'] || '').match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/)?.[1] || photoId.slice(3)

    // Poll once — caller can hit this endpoint repeatedly if the
    // prediction is still cooking.
    const d = await pollWaveSpeedTask(predictionId)

    if (d.status === 'failed') {
      const raw = d.error
      const errStr = typeof raw === 'string' ? raw : raw?.message ? raw.message : raw ? JSON.stringify(raw) : 'WaveSpeed reported failed'
      await patchAirtableRecord('Photos', photoId, { 'Flatlay Status': 'Failed' }, { typecast: true })
      return NextResponse.json({ error: errStr }, { status: 502 })
    }

    if (d.status !== 'completed') {
      // Still cooking — leave the row in Generating, tell the client to
      // try again.
      return NextResponse.json({ ok: false, status: d.status || 'pending', message: 'WaveSpeed still processing — retry in 10–30s.' }, { status: 202 })
    }

    const outputUrl = (d.outputs || [])[0]
    if (!outputUrl) {
      await patchAirtableRecord('Photos', photoId, { 'Flatlay Status': 'Failed' }, { typecast: true })
      return NextResponse.json({ error: 'WaveSpeed completed but returned no output URL' }, { status: 502 })
    }

    // Fetch the rendered bytes, coerce to JPEG (Wan/GPT often return PNG),
    // and finish the upload pipeline same as the main route does.
    const ir = await fetch(outputUrl)
    if (!ir.ok) {
      await patchAirtableRecord('Photos', photoId, { 'Flatlay Status': 'Failed' }, { typecast: true })
      return NextResponse.json({ error: `Couldn't fetch output bytes: HTTP ${ir.status}` }, { status: 502 })
    }
    const rawBuf = Buffer.from(await ir.arrayBuffer())
    let buf
    try { buf = await sharp(rawBuf).jpeg({ quality: 92, mozjpeg: true }).toBuffer() }
    catch { buf = rawBuf }

    const tok = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(tok)
    const dbxPath = `/Palm Ops/Photos/Flatlays/${handle}/${code}_${String(idx).padStart(2, '0')}_flatlay_${modelKey}.jpg`
    let dbxUploadOk = false
    try { await uploadToDropbox(tok, ns, dbxPath, buf, { overwrite: true }); dbxUploadOk = true }
    catch (e) { console.warn(`[photos/flatlay/resume] Dropbox upload failed:`, e.message) }

    let flatlayCdnUrl = null
    if (isCloudflareImagesConfigured()) {
      const cfId = `flatlay-${modelKey}-${handle}-${code}-${String(idx).padStart(2, '0')}`.toLowerCase().replace(/[^a-z0-9-]/g, '-')
      try {
        const r = await uploadImageBytes(buf, cfId)
        flatlayCdnUrl = buildDeliveryUrl(r.id, 'public')
      } catch (e) { console.warn(`[photos/flatlay/resume] CF upload failed:`, e.message) }
    }

    // Append to variant history (same logic as the main route).
    let variants = []
    try { variants = JSON.parse(f['Flatlay Variants'] || '[]') } catch {}
    if (!Array.isArray(variants)) variants = []
    variants = variants.filter(v => v && v.model !== modelKey)
    variants.unshift({
      model: modelKey,
      cdnUrl: flatlayCdnUrl || '',
      dropboxPath: dbxUploadOk ? dbxPath : '',
      predictionId,
      generatedAt: new Date().toISOString(),
    })
    variants = variants.slice(0, 6)

    const patch = {
      'Flatlay Status': 'Done',
      'Flatlay Model': modelKey,
      'Flatlay Variants': JSON.stringify(variants),
      ...(dbxUploadOk ? { 'Flatlay Dropbox Path': dbxPath } : { 'Flatlay Dropbox Path': '' }),
      ...(flatlayCdnUrl ? { 'Flatlay CDN URL': flatlayCdnUrl } : {}),
    }
    await patchAirtableRecord('Photos', photoId, patch, { typecast: true })

    return NextResponse.json({
      ok: true,
      photoId,
      flatlayCdnUrl,
      flatlayDropboxPath: dbxPath,
      predictionId,
      resumed: true,
    })
  } catch (err) {
    if (err instanceof Response) return err
    const msg = typeof err?.message === 'string' && err.message ? err.message : String(err)
    console.error('[photos/flatlay/resume] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
