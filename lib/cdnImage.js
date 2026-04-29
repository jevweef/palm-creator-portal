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
