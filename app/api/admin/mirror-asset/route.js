export const dynamic = 'force-dynamic'
// Pull-from-URL Stream upload returns the UID in <2s; CF Images upload-from-
// URL is similar; ffmpeg poster extract for videos can take 15s. Pad for
// slow Dropbox fetches and a safety margin under the Pro plan ceiling.
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { mirrorAsset } from '@/lib/mirrorAsset'

/**
 * POST /api/admin/mirror-asset
 *
 * Webhook endpoint for external callers (Airtable Automations, Make.com)
 * to mirror a single Asset to Cloudflare immediately. The actual mirror
 * logic lives in lib/mirrorAsset.js — this route is just the auth +
 * argument-parsing shell.
 *
 * Auth: pass `?secret=<MIRROR_WEBHOOK_SECRET>` as a query param.
 *
 * Body OR query: { assetId: "rec..." }
 *
 * Returns a small summary so the caller can see which steps ran. Does NOT
 * wait for Stream transcoding to finish — that's server-side at CF and
 * takes longer than any reasonable webhook timeout.
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
  const assetId = searchParams.get('id') || searchParams.get('assetId') || body.assetId || body.id
  if (!assetId || typeof assetId !== 'string' || !assetId.startsWith('rec')) {
    return NextResponse.json({ error: 'assetId required (must start with rec...)' }, { status: 400 })
  }

  try {
    const summary = await mirrorAsset(assetId)
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// GET handler is the same — Airtable Automations default to GET on webhooks.
export const GET = POST
