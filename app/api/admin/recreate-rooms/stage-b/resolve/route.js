import { NextResponse } from 'next/server'
import { requireAdminOrAiEditor, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'
import { pollWaveSpeedTask } from '@/lib/wavespeed'
import sharp from 'sharp'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const OUTPUTS = 'Stage B Outputs'
const BATCH = 6

// POST — find Stage B Outputs still "Generating", check WaveSpeed by
// the stored Prediction ID, and finish any that are done: pull the
// image into Dropbox + Airtable and flip Status. Works regardless of
// how long inference took, because we no longer hold the request open
// (a 301s job that killed the old sync route is captured here).
export async function POST() {
  try {
    await requireAdminOrAiEditor()
    const rows = await fetchAirtableRecords(OUTPUTS, {
      fields: ['Name', 'Prediction ID', 'Status', 'Slug'],
      filterByFormula: `AND({Status}='Generating', NOT({Prediction ID}=''))`,
    })
    if (rows.length === 0) return NextResponse.json({ ok: true, checked: 0, completed: 0, failed: 0, pending: 0 })

    let tok, ns
    try { tok = await getDropboxAccessToken(); ns = await getDropboxRootNamespaceId(tok) } catch {}

    let completed = 0, failed = 0, pending = 0
    const results = []
    for (const r of rows.slice(0, BATCH)) {
      const id = r.fields?.['Prediction ID']
      if (!id) continue
      let d
      try { d = await pollWaveSpeedTask(id) }
      catch (e) { results.push({ id: r.id, err: `poll: ${e.message}` }); continue }
      const status = d?.status

      if (status === 'completed') {
        const outUrl = (d.outputs || [])[0]
        if (!outUrl) { pending++; continue }
        let dbxPath = '', dbxLink = ''
        if (tok && ns) {
          try {
            const ir = await fetch(outUrl)
            if (ir.ok) {
              const rawBuf = Buffer.from(await ir.arrayBuffer())
              // Coerce to JPEG. Wan and GPT return PNG bytes even when
              // we save the file as .jpg — macOS Finder catches the
              // extension/content mismatch and renders a broken-alias
              // icon, and TJP rejects the file as malformed. Same fix
              // we applied to the flatlay route earlier.
              let buf
              try {
                buf = await sharp(rawBuf).jpeg({ quality: 92, mozjpeg: true }).toBuffer()
              } catch (e) {
                console.warn(`[stage-b/resolve] jpeg re-encode failed for ${r.id}, using raw bytes:`, e.message)
                buf = rawBuf
              }
              // Use the canonical slug for the Dropbox filename so the
              // editor's local files match the slug end-to-end. Pre-slug
              // records (no Slug field set) fall back to the record-id
              // name they used to get.
              const slug = r.fields?.Slug || ''
              const akaFolder = (slug.split('_')[0] || 'misc')
              dbxPath = slug
                ? `/Palm Ops/Stage B Outputs/${akaFolder}/${slug}.jpg`
                : `/Palm Ops/Stage B Outputs/${r.id}-${Date.now()}.jpg`
              await uploadToDropbox(tok, ns, dbxPath, buf, { overwrite: true })
              try { dbxLink = await createDropboxSharedLink(tok, ns, dbxPath) } catch {}
            }
          } catch (e) { console.warn(`[stage-b/resolve] dropbox ${r.id}: ${e.message}`) }
        }
        await patchAirtableRecord(OUTPUTS, r.id, {
          Image: [{ url: outUrl }],
          ...(dbxPath ? { 'Dropbox Path': dbxPath } : {}),
          ...(dbxLink ? { 'Dropbox Link': dbxLink } : {}),
          Status: 'Pending',
        }, { typecast: true })
        completed++
        results.push({ id: r.id, status: 'completed' })
      } else if (status === 'failed') {
        const e = typeof d.error === 'string' && d.error ? d.error
          : d.error ? JSON.stringify(d.error) : 'WaveSpeed failed'
        await patchAirtableRecord(OUTPUTS, r.id, {
          Status: 'Failed',
          'Reject Reason': `WaveSpeed: ${e}`,
        }, { typecast: true })
        failed++
        results.push({ id: r.id, status: 'failed' })
      } else {
        pending++
        results.push({ id: r.id, status: status || 'unknown' })
      }
    }

    return NextResponse.json({
      ok: true,
      checked: Math.min(rows.length, BATCH),
      remaining: Math.max(0, rows.length - BATCH),
      completed, failed, pending, results,
    })
  } catch (err) {
    if (err instanceof Response) return err
    const msg = typeof err?.message === 'string' && err.message ? err.message : String(err)
    console.error('[stage-b/resolve] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
