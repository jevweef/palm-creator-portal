export const dynamic = 'force-dynamic'
// Stream uploads return immediately — CF transcodes server-side after the
// kick. We just need time to walk N records and call the upload API for
// each, plus an Airtable PATCH per asset. Keep maxDuration modest.
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { fetchAirtableRecords } from '@/lib/adminAuth'
import { uploadVideoByUrl, isCloudflareStreamConfigured } from '@/lib/cloudflareStream'

const OPS_BASE = 'applLIT2t83plMqNx'
const ASSETS = 'Assets'

// Up to N video Assets per run get their Stream uploads kicked. Each call
// is ~1s round trip to CF + ~0.5s Airtable PATCH. 30 per run ≈ 45s
// wall-clock and gives the cron headroom under maxDuration.
const MAX_PER_RUN = 30

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
    // Pick video assets where at least one of (raw, edit) is missing its
    // Stream UID. Sorted by Airtable's natural order → newer-ish first
    // since the ingest cron creates new records at the end.
    const candidates = await fetchAirtableRecords(ASSETS, {
      filterByFormula: `AND({Asset Type}='Video',OR(NOT({Edited File Link}=''),NOT({Dropbox Shared Link}='')),OR({Stream Edit ID}='',{Stream Raw ID}=''))`,
      fields: [
        'Asset Name',
        'Edited File Link',
        'Dropbox Shared Link',
        'Stream Edit ID',
        'Stream Raw ID',
      ],
    })

    for (const asset of candidates.slice(0, MAX_PER_RUN)) {
      if (Date.now() - startedAt > 270_000) break
      processed++
      const f = asset.fields || {}
      const updates = {}

      // Edit upload
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

      // Raw upload
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
        try {
          await patchAsset(asset.id, updates)
        } catch (err) {
          // Stream uploads succeeded but Airtable patch failed — log and
          // keep going. Re-running the cron will re-discover and try again.
          errors.push({ id: asset.id, kind: 'patch', error: err.message })
        }
      }
    }

    const remaining = Math.max(0, candidates.length - processed)
    const elapsed = Math.round((Date.now() - startedAt) / 1000)
    console.log(
      `[cron/mirror-stream] processed=${processed} kicked=${kicked} ` +
      `failed=${failed} remaining=${remaining} elapsed=${elapsed}s`
    )

    return NextResponse.json({
      ok: true, processed, kicked, failed, remaining, elapsed,
      errors: errors.slice(0, 10),
    })
  } catch (err) {
    console.error('[cron/mirror-stream] fatal:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
