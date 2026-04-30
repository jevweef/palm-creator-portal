// Fire-and-forget call to the mirror webhooks so any new Asset or
// Inspiration record gets pushed to Cloudflare Images / Stream the moment
// it's created, instead of waiting for the 15-min sweep cron.
//
// Used by the in-app upload routes (creator clip uploads, replace clip,
// content-request uploads, inspo saves) — anywhere a row appears that
// didn't come through the Make.com Dropbox-ingest path that already calls
// /api/admin/mirror-asset.
//
// Errors are swallowed: the cron is the safety net, so if this fails it
// just means a brief delay before the asset is on CDN.

function getBaseUrl() {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

function fireWebhook(path, payload) {
  const secret = process.env.MIRROR_WEBHOOK_SECRET || process.env.CRON_SECRET
  if (!secret) return
  const url = `${getBaseUrl()}${path}?secret=${encodeURIComponent(secret)}`
  // Don't await — let it run alongside the response. keepalive helps
  // Vercel not kill the in-flight request when the parent function returns.
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch((err) => console.warn(`[triggerMirror] ${path} failed:`, err.message))
}

export function triggerAssetMirror(assetId) {
  if (!assetId) return
  fireWebhook('/api/admin/mirror-asset', { assetId })
}

export function triggerInspirationMirror(recordId) {
  if (!recordId) return
  fireWebhook('/api/admin/mirror-inspiration', { recordId })
}
