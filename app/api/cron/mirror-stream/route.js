export const dynamic = 'force-dynamic'
// Stream uploads return immediately — CF transcodes server-side after the
// kick. We just need time to walk N records and call the upload API for
// each, plus an Airtable PATCH per asset. Keep maxDuration modest.
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { fetchAirtableRecords } from '@/lib/adminAuth'
import {
  uploadVideoByUrl,
  mirrorInspirationToCloudflareStream,
  isCloudflareStreamConfigured,
} from '@/lib/cloudflareStream'

const OPS_BASE = 'applLIT2t83plMqNx'
const ASSETS = 'Assets'
const INSPIRATION = 'Inspiration'

// Up to N records per run get their Stream uploads kicked. Each call is ~1s
// round trip to CF + ~0.5s Airtable PATCH. Split between Assets (30) and
// Inspiration (15) so neither table starves the other when both have
// backlogs — ≈ 67s wall-clock with headroom under maxDuration.
const ASSETS_PER_RUN = 30
const INSPIRATION_PER_RUN = 15

function rawDropboxUrl(url) {
  if (!url) return ''
  const clean = url
    .replace(/[?&]dl=0/, '')
    .replace(/[?&]raw=1/, '')
    .replace(/[?&]dl=1/, '')
  return clean + (clean.includes('?') ? '&raw=1' : '?raw=1')
}

async function patchAsset(recordId, fields) {
  const res = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${ASSETS}/${recordId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_PAT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    }
  )
  if (!res.ok) throw new Error(`PATCH ${res.status}: ${await res.text()}`)
}

/**
 * GET /api/cron/mirror-stream
 *
 * Vercel cron — finds video Assets that are missing a Stream Edit ID and/or
 * Stream Raw ID and kicks the Cloudflare Stream copy-from-URL upload for
 * each one. Idempotent: skips assets already mirrored.
 *
 * Companion to /api/cron/mirror-cloudflare (photos + inspo) and
 * /api/cron/mirror-video-frames (poster JPEGs). This one handles the
 * heavy thing: full video files getting hosted on Stream for fast
 * playback.
 *
 * We don't poll for ready — uploads return a UID immediately, CF transcodes
 * in the background. Once transcoded the Stream URL just starts working.
 * The browse-side <iframe> will show a black frame until then; acceptable
 * given the cron interval.
 *
 * Schedule: lives in vercel.json. */
export async function GET(request) {
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  const actualAuth = request.headers.get('authorization')
  if (expectedAuth && actualAuth !== expectedAuth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isCloudflareStreamConfigured()) {
    return NextResponse.json({ error: 'CF Stream not configured' }, { status: 500 })
  }

  const startedAt = Date.now()
  let processed = 0, kicked = 0, failed = 0
  const errors = []

  try {
    // Fetch both Assets and Inspiration backlogs in parallel. Each table
    // has its own filter — Assets needs raw OR edit missing; Inspiration
    // is just one Stream UID per record.
    const [assetCandidates, inspoCandidates] = await Promise.all([
      fetchAirtableRecords(ASSETS, {
        filterByFormula: `AND({Asset Type}='Video',OR(NOT({Edited File Link}=''),NOT({Dropbox Shared Link}='')),OR({Stream Edit ID}='',{Stream Raw ID}=''))`,
        fields: ['Asset Name', 'Edited File Link', 'Dropbox Shared Link', 'Stream Edit ID', 'Stream Raw ID'],
      }),
      fetchAirtableRecords(INSPIRATION, {
        filterByFormula: `AND(OR(NOT({DB Share Link}=''),NOT({DB Raw = 1}='')),{Stream UID}='')`,
        fields: ['Title', 'DB Share Link', 'DB Raw = 1', 'Stream UID'],
      }),
    ])

    // ── Assets (raw + edit per record) ─────────────────────────────────
    for (const asset of assetCandidates.slice(0, ASSETS_PER_RUN)) {
      if (Date.now() - startedAt > 270_000) break
      processed++
      const f = asset.fields || {}
      const updates = {}

      if (f['Edited File Link'] && !f['Stream Edit ID']) {
        try {
          const { uid } = await uploadVideoByUrl(rawDropboxUrl(f['Edited File Link']), {
            airtableId: asset.id, kind: 'edit',
          })
          updates['Stream Edit ID'] = uid
          kicked++
        } catch (err) {
          failed++
          errors.push({ id: asset.id, kind: 'edit', error: err.message })
        }
      }
      if (f['Dropbox Shared Link'] && !f['Stream Raw ID']) {
        try {
          const { uid } = await uploadVideoByUrl(rawDropboxUrl(f['Dropbox Shared Link']), {
            airtableId: asset.id, kind: 'raw',
          })
          updates['Stream Raw ID'] = uid
          kicked++
        } catch (err) {
          failed++
          errors.push({ id: asset.id, kind: 'raw', error: err.message })
        }
      }
      if (Object.keys(updates).length) {
        try { await patchAsset(asset.id, updates) }
        catch (err) { errors.push({ id: asset.id, kind: 'patch', error: err.message }) }
      }
    }

    // ── Inspiration (one Stream UID per record) ────────────────────────
    for (const record of inspoCandidates.slice(0, INSPIRATION_PER_RUN)) {
      if (Date.now() - startedAt > 270_000) break
      processed++
      try {
        const result = await mirrorInspirationToCloudflareStream(record)
        if (result.ok && !result.skipped) kicked++
        else if (result.skipped) {/* already mirrored */}
        else { failed++; errors.push({ id: record.id, kind: 'inspo', error: result.error }) }
      } catch (err) {
        failed++
        errors.push({ id: record.id, kind: 'inspo', error: err.message })
      }
    }

    const remainingAssets = Math.max(0, assetCandidates.length - ASSETS_PER_RUN)
    const remainingInspo = Math.max(0, inspoCandidates.length - INSPIRATION_PER_RUN)
    const remaining = remainingAssets + remainingInspo
    const elapsed = Math.round((Date.now() - startedAt) / 1000)
    console.log(
      `[cron/mirror-stream] processed=${processed} kicked=${kicked} ` +
      `failed=${failed} remaining=${remaining} (assets=${remainingAssets}, inspo=${remainingInspo}) elapsed=${elapsed}s`
    )

    return NextResponse.json({
      ok: true, processed, kicked, failed, remaining, remainingAssets, remainingInspo, elapsed,
      errors: errors.slice(0, 10),
    })
  } catch (err) {
    console.error('[cron/mirror-stream] fatal:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
