export const dynamic = 'force-dynamic'
// Vercel functions default to 10s on Hobby, 60s on Pro. Mirroring is
// rate-limited by CF's URL-fetching speed (~1/sec) so 60s = ~50 photos
// per run. We cap MAX_PER_RUN at 40 to stay well under the limit.
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { fetchAirtableRecords } from '@/lib/adminAuth'
import {
  mirrorAssetToCloudflare,
  mirrorInspirationToCloudflare,
  isCloudflareImagesConfigured,
} from '@/lib/cloudflareImages'

// How many records to mirror per cron invocation. Both Assets and Inspiration
// share the budget — 40 total in 60s leaves headroom under Vercel's timeout
// even at the ~1/sec CF API rate. Splitting the budget evenly keeps either
// table from starving the other when both have backlogs.
const MAX_PER_RUN = 40
const ASSETS_PER_RUN = 25
const INSPIRATION_PER_RUN = MAX_PER_RUN - ASSETS_PER_RUN

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
    const [assetCandidates, inspoCandidates] = await Promise.all([
      fetchAirtableRecords('Assets', {
        filterByFormula: `AND(NOT({Dropbox Shared Link}=''),OR({Asset Type}='Photo',{Asset Type}='Image',{Asset Type}=BLANK()),{CDN URL}='')`,
        fields: [
          'Asset Name',
          'Dropbox Shared Link',
          'Asset Type',
          'File Extension',
          'CDN URL',
        ],
      }),
      fetchAirtableRecords('Inspiration', {
        filterByFormula: `AND(NOT({Thumbnail}=''),{CDN URL}='')`,
        fields: ['Title', 'Thumbnail', 'CDN URL'],
      }),
    ])

    // Mirror serially — keeps it predictable under CF rate limits and lets
    // a single failure not poison the whole batch. Stop at the per-table cap.
    for (const asset of assetCandidates.slice(0, ASSETS_PER_RUN)) {
      processed++
      try {
        const result = await mirrorAssetToCloudflare(asset)
        if (result.ok && !result.skipped) succeeded++
        else if (result.skipped) skipped++
        else {
          failed++
          errors.push({ id: asset.id, table: 'Assets', name: asset.fields?.['Asset Name'] || '', error: result.error })
        }
      } catch (err) {
        failed++
        errors.push({ id: asset.id, table: 'Assets', name: asset.fields?.['Asset Name'] || '', error: err.message })
      }
    }

    for (const record of inspoCandidates.slice(0, INSPIRATION_PER_RUN)) {
      processed++
      try {
        const result = await mirrorInspirationToCloudflare(record)
        if (result.ok && !result.skipped) succeeded++
        else if (result.skipped) skipped++
        else {
          failed++
          errors.push({ id: record.id, table: 'Inspiration', name: record.fields?.Title || '', error: result.error })
        }
      } catch (err) {
        failed++
        errors.push({ id: record.id, table: 'Inspiration', name: record.fields?.Title || '', error: err.message })
      }
    }

    const remainingAssets = Math.max(0, assetCandidates.length - ASSETS_PER_RUN)
    const remainingInspo = Math.max(0, inspoCandidates.length - INSPIRATION_PER_RUN)
    const remaining = remainingAssets + remainingInspo
    const elapsed = Math.round((Date.now() - startedAt) / 1000)

    console.log(
      `[cron/mirror-cloudflare] processed=${processed} succeeded=${succeeded} ` +
      `skipped=${skipped} failed=${failed} remaining=${remaining} ` +
      `(assets=${remainingAssets}, inspo=${remainingInspo}) elapsed=${elapsed}s`
    )

    return NextResponse.json({
      ok: true,
      processed,
      succeeded,
      skipped,
      failed,
      remaining,
      remainingAssets,
      remainingInspo,
      elapsed,
      errors: errors.slice(0, 10), // truncate so the response stays small in logs
    })
  } catch (err) {
    console.error('[cron/mirror-cloudflare] fatal:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
