export const dynamic = 'force-dynamic'
// Vercel functions default to 10s on Hobby, 60s on Pro. Mirroring is
// rate-limited by CF's URL-fetching speed (~1/sec) so 60s = ~50 photos
// per run. We cap MAX_PER_RUN at 40 to stay well under the limit.
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { fetchAirtableRecords } from '@/lib/adminAuth'
import { mirrorAssetToCloudflare, isCloudflareImagesConfigured } from '@/lib/cloudflareImages'

// How many assets to process per cron invocation. Stays under Vercel's
// 60s function timeout while making meaningful progress.
const MAX_PER_RUN = 40

/**
 * GET /api/cron/mirror-cloudflare
 *
 * Vercel-cron endpoint that mirrors any image Asset records still missing
 * a CDN URL to Cloudflare Images. Schedule lives in vercel.json.
 *
 * Auth: Vercel automatically sends `Authorization: Bearer ${CRON_SECRET}`
 * on cron requests. We verify against env to keep this endpoint from being
 * publicly callable (which would let anyone burn through CF API quota).
 *
 * Behavior:
 *   - Scans Assets where Dropbox Shared Link is set, Asset Type is Photo
 *     or blank (skipping videos), and CDN URL is empty
 *   - Mirrors up to MAX_PER_RUN of them per run (oldest first)
 *   - Idempotent — re-runs on the same record are no-ops via custom CF ID
 *   - Returns a summary so we can monitor in Vercel logs
 */
export async function GET(request) {
  // Auth — Vercel cron sends this header automatically when CRON_SECRET is set.
  // Without verification any public caller could trigger this endpoint and
  // hammer CF API quota.
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  const actualAuth = request.headers.get('authorization')
  if (expectedAuth && actualAuth !== expectedAuth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isCloudflareImagesConfigured()) {
    return NextResponse.json({ error: 'CF Images not configured' }, { status: 500 })
  }

  const startedAt = Date.now()
  let processed = 0
  let succeeded = 0
  let skipped = 0
  let failed = 0
  const errors = []

  try {
    // Server-side narrow filter so we don't pull thousands of unrelated
    // records over the wire. Photo / Image / blank Asset Type, must have a
    // Dropbox link, and CDN URL must be empty.
    const candidates = await fetchAirtableRecords('Assets', {
      filterByFormula: `AND(NOT({Dropbox Shared Link}=''),OR({Asset Type}='Photo',{Asset Type}='Image',{Asset Type}=BLANK()),{CDN URL}='')`,
      fields: [
        'Asset Name',
        'Dropbox Shared Link',
        'Asset Type',
        'File Extension',
        'CDN URL',
      ],
    })

    // Mirror serially — keeps it predictable under CF rate limits and lets
    // a single failure not poison the whole batch. Stop at MAX_PER_RUN.
    for (const asset of candidates.slice(0, MAX_PER_RUN)) {
      processed++
      try {
        const result = await mirrorAssetToCloudflare(asset)
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

    const remaining = Math.max(0, candidates.length - MAX_PER_RUN)
    const elapsed = Math.round((Date.now() - startedAt) / 1000)

    console.log(
      `[cron/mirror-cloudflare] processed=${processed} succeeded=${succeeded} ` +
      `skipped=${skipped} failed=${failed} remaining=${remaining} elapsed=${elapsed}s`
    )

    return NextResponse.json({
      ok: true,
      processed,
      succeeded,
      skipped,
      failed,
      remaining,
      elapsed,
      errors: errors.slice(0, 10), // truncate so the response stays small in logs
    })
  } catch (err) {
    console.error('[cron/mirror-cloudflare] fatal:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
