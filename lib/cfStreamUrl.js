/**
 * Client-safe Cloudflare Stream URL helpers.
 *
 * Splits out the pure URL-builders from lib/cloudflareStream.js so client
 * components can import them without dragging server-only API helpers into
 * the bundle. The customer code is account-specific and constant.
 */

const CUSTOMER_CODE = 's6evvwyakoxbda2u'

/** HLS manifest URL — works in Safari natively, needs hls.js for Chrome/FF. */
export function buildStreamHlsUrl(uid) {
  if (!uid) return null
  return `https://customer-${CUSTOMER_CODE}.cloudflarestream.com/${uid}/manifest/video.m3u8`
}

/**
 * Hosted CF Stream player iframe URL. Drop-in replacement for <video src=...>
 * via <iframe src=...>. Handles HLS playback automatically across all
 * browsers (no hls.js needed).
 *
 * Options forward to Stream player URL params:
 *   autoplay, muted, loop, controls (default true), preload, poster
 *
 * For autoplay-in-card: { autoplay: true, muted: true, loop: true, controls: false }
 * For modal playback:    { autoplay: true, controls: true }
 */
export function buildStreamIframeUrl(uid, opts = {}) {
  if (!uid) return null
  const params = new URLSearchParams()
  if (opts.autoplay) params.set('autoplay', 'true')
  if (opts.muted) params.set('muted', 'true')
  if (opts.loop) params.set('loop', 'true')
  if (opts.controls === false) params.set('controls', 'false')
  if (opts.preload) params.set('preload', opts.preload)
  if (opts.poster) params.set('poster', opts.poster)
  if (opts.startTime) params.set('startTime', String(opts.startTime))
  const query = params.toString()
  return `https://customer-${CUSTOMER_CODE}.cloudflarestream.com/${uid}/iframe${query ? '?' + query : ''}`
}

/**
 * Auto-generated thumbnail JPEG. CF generates frame at any timestamp on
 * the fly. For browse-grid posters request a small width — these are
 * cheap and load instantly.
 *
 * @param {string} uid
 * @param {object} [opts]
 * @param {string} [opts.time] - default '1s'
 * @param {number} [opts.width]
 * @param {number} [opts.height]
 * @param {string} [opts.fit] - 'crop' | 'scale-down' (default 'crop')
 */
export function buildStreamPosterUrl(uid, { time = '1s', width = null, height = null, fit = 'crop' } = {}) {
  if (!uid) return null
  const params = new URLSearchParams()
  params.set('time', time)
  if (width) params.set('width', String(width))
  if (height) params.set('height', String(height))
  if (fit) params.set('fit', fit)
  return `https://customer-${CUSTOMER_CODE}.cloudflarestream.com/${uid}/thumbnails/thumbnail.jpg?${params}`
}
