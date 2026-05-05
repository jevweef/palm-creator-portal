// In-process mirror triggers used by the upload routes.
//
// Why this changed: the original implementation fired a `keepalive: true`
// fetch to the /api/admin/mirror-asset webhook and returned immediately.
// Vercel's runtime doesn't actually keep those alive past the parent
// function's response — when an upload route returns, Vercel can kill any
// outstanding work. Concurrent bursts (7 uploads in 14 seconds) made it
// worse: the webhook calls raced each other, some got dropped, and the
// affected assets ended up missing Stream Raw IDs until the every-15-min
// sweep cron caught them.
//
// New approach: call the mirror logic directly in-process and hand it to
// Vercel's `waitUntil`, which is the canonical Vercel API for "do this
// after the response returns, but actually keep the function warm for it."
// No HTTP indirection, no auth dance, no keepalive guesswork.
//
// The /api/admin/mirror-asset webhook still exists for external callers
// (Airtable Automations, Make.com) — it just calls the same `mirrorAsset`
// function under the hood now.

import { waitUntil } from '@vercel/functions'
import { mirrorAsset } from '@/lib/mirrorAsset'

export function triggerAssetMirror(assetId) {
  if (!assetId) return
  const work = mirrorAsset(assetId).catch((err) => {
    // Don't crash the host function on mirror failure — the every-15-min
    // mirror-stream cron is the safety net for anything that fails here.
    console.warn(`[triggerMirror] mirror failed for ${assetId}:`, err.message)
  })
  // waitUntil tells Vercel "this work is part of this request, keep the
  // function alive until it finishes" — the response still goes back
  // immediately, but the mirror actually runs to completion.
  try {
    waitUntil(work)
  } catch {
    // waitUntil throws if not in a Vercel runtime context (e.g. local dev).
    // Just await inline as a fallback so the work still happens.
    work.catch(() => {})
  }
}

// Inspiration mirror still goes through the webhook for now since the only
// caller is the inspo save flow and that's not bursty. Could be migrated
// to the same in-process pattern if it starts dropping events.
function getBaseUrl() {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

export function triggerInspirationMirror(recordId) {
  if (!recordId) return
  const secret = process.env.MIRROR_WEBHOOK_SECRET || process.env.CRON_SECRET
  if (!secret) return
  const url = `${getBaseUrl()}/api/admin/mirror-inspiration?secret=${encodeURIComponent(secret)}`
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recordId }),
    keepalive: true,
  }).catch((err) => console.warn('[triggerMirror] mirror-inspiration failed:', err.message))
}
