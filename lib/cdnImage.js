/**
 * Client-safe Cloudflare Images URL helpers.
 *
 * Stored CDN URLs end in `/public` (the ~1500px full variant). Browse views
 * render at much smaller sizes — fetching the full variant for a 64px slot
 * thumb burns ~100KB per image. Cloudflare Flexible Variants (enabled on
 * the account) lets us swap `/public` for an inline transform like
 * `/w=200,fit=cover,quality=85` and serve a tiny image instead.
 *
 * No env vars or fetch calls in here — safe to import from any client
 * component without dragging the server-only mirror functions into the
 * bundle.
 */

/**
 * Rewrite a stored Cloudflare Images delivery URL to a smaller size.
 *
 * Pass-through for null, non-CF, or already-transformed URLs.
 *
 * @param {string|null|undefined} url - Stored CDN URL (or anything else).
 * @param {number} width - Target rendered width in CSS pixels. CF emits
 *   the JPEG/WebP at this size — use roughly the visible width times your
 *   target devicePixelRatio (2 for retina). 200 for slot thumbs, 600 for
 *   grid cards, 1200 for modal previews.
 * @returns {string|null|undefined}
 */
export function cdnUrlAtSize(url, width) {
  if (!url || typeof url !== 'string') return url
  if (!width || width <= 0) return url
  if (!url.includes('imagedelivery.net')) return url
  return url.replace(/\/public$/, `/w=${width},fit=cover,quality=85`)
}

/**
 * Wrap a thumbnail URL with our /api/admin/thumb-proxy so the browser hits
 * a stable Vercel-served URL instead of Airtable's flaky signed-URL CDN.
 * Pass-through for already-Cloudflare-Images URLs (those serve fast from
 * CF edge directly, no proxy needed).
 *
 * Why: the grid renders ~63 thumbnails simultaneously. Airtable's CDN
 * (v5.airtableusercontent.com) randomly 502s on a subset under that burst
 * load — different cells go black on every refresh. The proxy retries
 * server-side and adds a 1-day cache, so once a thumb loads successfully
 * it's cached and never has to hit Airtable again.
 *
 * @param {string|null|undefined} url
 * @returns {string|null|undefined}
 */
export function proxyThumbUrl(url) {
  if (!url || typeof url !== 'string') return url
  // Cloudflare Images URLs are already on a fast CDN — no point proxying.
  if (url.includes('imagedelivery.net')) return url
  // Data URLs (optimistic preview from upload) — render directly.
  if (url.startsWith('data:')) return url
  // Blob URLs (local preview) — render directly.
  if (url.startsWith('blob:')) return url
  // Same-origin already (shouldn't happen but cheap to check) — pass through.
  if (typeof window !== 'undefined' && url.startsWith(window.location.origin)) return url
  return `/api/admin/thumb-proxy?url=${encodeURIComponent(url)}`
}
