export const dynamic = 'force-dynamic'
// Each video extraction is download (~5–15s) + ffmpeg (~1–3s) + upload (<1s)
// + Airtable patch (<1s) — call it ~10–20s per asset. With maxDuration=300s
// (Pro plan ceiling) we have headroom for ~12 videos per run before hitting
// the wall. Cap a little under that to leave buffer for slow Dropbox fetches.
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { fetchAirtableRecords } from '@/lib/adminAuth'
import { mirrorVideoFrameToCloudflare, isCloudflareImagesConfigured } from '@/lib/cloudflareImages'

const MAX_PER_RUN = 8

/**
 * GET /api/cron/mirror-video-frames
 *
 * Vercel-cron endpoint that ffmpeg-extracts a poster frame from each video
 * Asset that doesn't yet have a CDN URL, uploads the JPEG to Cloudflare
 * Images, and writes the delivery URL back to the Asset record.
 *
 * Companion to /api/cron/mirror-cloudflare. That cron handles photos and
 * any videos where Airtable already auto-generated a Thumbnail attachment
 * (rare for our ingest paths). This one handles the bulk of videos —
 * creator-uploaded clips and editor-edited finals — that have no source
 * thumbnail anywhere except inside the video file.
 *
 * Schedule lives in vercel.json. Hourly cadence is plenty: editors don't
 * submit edits constantly and the slot grid will fall back to inspo or
 * placeholder until the cron catches up.
 */
export async function GET(request) {
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  const actualAuth = request.headers.get('authorization')
  if (expectedAuth && actualAuth !== expectedAuth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isCloudflareImagesConfigured()) {
    return NextResponse.json({ error: 'CF Images not configured' }, { status: 500 })
  }

  const startedAt = Date.now()
  let processed = 0, succeeded = 0, skipped = 0, failed = 0
  const errors = []

  try {
    // Pick video assets with at least one playable link and no CDN URL yet.
    // Edited File Link wins over Dropbox Shared Link inside the helper, but
    // either is a valid trigger here.
    const candidates = await fetchAirtableRecords('Assets', {
      filterByFormula: `AND({Asset Type}='Video',OR(NOT({Edited File Link}=''),NOT({Dropbox Shared Link}='')),{CDN URL}='')`,
      fields: [
        'Asset Name',
        'Edited File Link',
        'Dropbox Shared Link',
        'CDN URL',
      ],
    })

    for (const asset of candidates.slice(0, MAX_PER_RUN)) {
      // Bail out early if we're getting close to the function timeout —
      // ffmpeg on a slow video can take longer than expected.
      if (Date.now() - startedAt > 270_000) break
      processed++
      try {
        const result = await mirrorVideoFrameToCloudflare(asset)
        if (result.ok && !result.skipped) succeeded++
        else if (result.skipped) skipped++
        else {
          failed++
          errors.push({ id: asset.id, name: asset.fields?.['Asset Name'] || '', error: result.error })
        }
      } catch (err) {
        failed++
        errors.push({ id: asset.id, name: asset.fields?.['Asset Name'] || '', error: err.message })
      }
    }

    const remaining = Math.max(0, candidates.length - processed)
    const elapsed = Math.round((Date.now() - startedAt) / 1000)

    console.log(
      `[cron/mirror-video-frames] processed=${processed} succeeded=${succeeded} ` +
      `skipped=${skipped} failed=${failed} remaining=${remaining} elapsed=${elapsed}s`
    )

    return NextResponse.json({
      ok: true, processed, succeeded, skipped, failed, remaining, elapsed,
      errors: errors.slice(0, 10),
    })
  } catch (err) {
    console.error('[cron/mirror-video-frames] fatal:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
