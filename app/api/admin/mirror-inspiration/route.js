export const dynamic = 'force-dynamic'
// CF Images upload-from-URL: ~1-2s. Stream copy-from-URL: ~1-2s. Pad for
// slow Dropbox / Airtable signed URL fetches.
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { fetchAirtableRecords } from '@/lib/adminAuth'
import {
  mirrorInspirationToCloudflare,
  isCloudflareImagesConfigured,
} from '@/lib/cloudflareImages'
import {
  mirrorInspirationToCloudflareStream,
  isCloudflareStreamConfigured,
} from '@/lib/cloudflareStream'

const OPS_BASE = 'applLIT2t83plMqNx'
const INSPIRATION_TABLE = 'tblnQhATaMtpoYErb'

/**
 * POST /api/admin/mirror-inspiration
 *
 * Sibling to /api/admin/mirror-asset — same pattern but for the Inspiration
 * table. Wired up via an Airtable Automation that fires on record creation
 * (or update). Cuts the 15-min cron lag down to "by the time a creator
 * lands on the inspo board, the new reel is on Stream + CF Images."
 *
 * Auth: ?secret=<MIRROR_WEBHOOK_SECRET> (falls back to CRON_SECRET) — same
 * as the asset webhook.
 *
 * Body OR query: { recordId: "rec..." } | { id: "rec..." } | { assetId: "rec..." }
 *   (assetId accepted so the same Airtable Automation pattern works for
 *   either table without renaming variables.)
 *
 * Mirrors the inspo's Thumbnail attachment to CF Images (records the
 * delivery URL on `CDN URL`) and kicks a CF Stream upload of the
 * `DB Share Link` video (records the UID on `Stream UID`). Idempotent —
 * skips whichever side is already mirrored.
 */
export async function POST(request) {
  const expectedSecret = process.env.MIRROR_WEBHOOK_SECRET || process.env.CRON_SECRET
  const { searchParams } = new URL(request.url)
  const providedSecret = searchParams.get('secret') || request.headers.get('x-mirror-secret')
  if (expectedSecret && providedSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body = {}
  try { body = await request.json() } catch {}
  const recordId = searchParams.get('id') || searchParams.get('recordId') || searchParams.get('assetId')
    || body.recordId || body.id || body.assetId
  if (!recordId || typeof recordId !== 'string' || !recordId.startsWith('rec')) {
    return NextResponse.json({ error: 'recordId required (must start with rec...)' }, { status: 400 })
  }

  // Pull the Inspiration record once with every field either helper might
  // need so neither has to re-fetch.
  const records = await fetchAirtableRecords(INSPIRATION_TABLE, {
    filterByFormula: `RECORD_ID()='${recordId}'`,
    fields: [
      'Title',
      'Thumbnail',
      'CDN URL',
      'CDN Image ID',
      'DB Share Link',
      'DB Raw = 1',
      'Stream UID',
    ],
  })
  const record = records[0]
  if (!record) {
    return NextResponse.json({ error: `Inspiration record ${recordId} not found` }, { status: 404 })
  }

  const summary = { recordId, title: record.fields?.Title || '', actions: [] }

  // ── Cloudflare Images: mirror the Airtable Thumbnail attachment ──────
  if (isCloudflareImagesConfigured() && !record.fields?.['CDN URL']) {
    try {
      const result = await mirrorInspirationToCloudflare(record)
      summary.actions.push({ step: 'cf-images', ...result })
    } catch (err) {
      summary.actions.push({ step: 'cf-images', error: err.message })
    }
  }

  // ── Cloudflare Stream: kick upload of DB Share Link video ────────────
  if (isCloudflareStreamConfigured() && !record.fields?.['Stream UID']) {
    try {
      const result = await mirrorInspirationToCloudflareStream(record)
      summary.actions.push({ step: 'cf-stream', ...result })
    } catch (err) {
      summary.actions.push({ step: 'cf-stream', error: err.message })
    }
  }

  return NextResponse.json({ ok: true, ...summary })
}

// Some webhook providers default to GET — accept either.
export const GET = POST
