/**
 * Cloudflare Images helpers — upload an image by URL and build delivery URLs.
 *
 * Why this exists: Dropbox shared links are not CDN-backed and load slowly.
 * For browse-heavy views (chat wall, editor library, inspo board) we keep
 * Dropbox as source-of-truth but mirror each photo to Cloudflare Images and
 * serve from imagedelivery.net. ~50ms global delivery vs multi-second Dropbox.
 *
 * Usage:
 *   import { uploadImageByUrl, buildDeliveryUrl } from '@/lib/cloudflareImages'
 *   const { id } = await uploadImageByUrl(rawDropboxUrl(asset.dropboxLink), asset.id)
 *   const url = buildDeliveryUrl(id, 'public')
 */

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const HASH = process.env.CLOUDFLARE_IMAGES_HASH
const TOKEN = process.env.CLOUDFLARE_IMAGES_TOKEN

function assertConfigured() {
  if (!ACCOUNT_ID || !HASH || !TOKEN) {
    throw new Error(
      'Cloudflare Images not configured. Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_IMAGES_HASH, CLOUDFLARE_IMAGES_TOKEN.'
    )
  }
}

/**
 * Upload an image to Cloudflare Images by giving Cloudflare a public URL to
 * fetch from. Cloudflare downloads the bytes itself — no streaming through us.
 *
 * @param {string} url - Public URL Cloudflare will fetch (e.g. raw Dropbox).
 * @param {string} [idHint] - Optional custom ID. Asset record IDs make the
 *   upload idempotent: a re-run won't create a duplicate, it'll fail with
 *   IMAGE_ALREADY_EXISTS which we treat as a non-error and look up the URL.
 * @param {object} [metadata] - Arbitrary JSON metadata stored with the image.
 * @returns {Promise<{id: string, alreadyExisted: boolean, raw: object}>}
 */
export async function uploadImageByUrl(url, idHint = null, metadata = null) {
  assertConfigured()
  if (!url) throw new Error('uploadImageByUrl: url is required')

  // Cloudflare wants multipart/form-data — Node 18+ has FormData & Blob built in.
  const form = new FormData()
  form.append('url', url)
  if (idHint) form.append('id', idHint)
  if (metadata) form.append('metadata', JSON.stringify(metadata))
  // requireSignedURLs=false → image is publicly accessible at the delivery URL.
  // We don't need signed URLs for chat-wall photos (admin-only auth lives on
  // the page, not the image).
  form.append('requireSignedURLs', 'false')

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/images/v1`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: form,
    }
  )

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    // CF returns errors[].code === 5409 when an image with the same custom ID
    // already exists. Treat that as a successful idempotent re-run.
    const errs = data?.errors || []
    const isDuplicate = errs.some(e => e.code === 5409 || /already exists/i.test(e.message || ''))
    if (isDuplicate && idHint) {
      return { id: idHint, alreadyExisted: true, raw: data }
    }
    const msg = errs.map(e => `${e.code}: ${e.message}`).join('; ') || `HTTP ${res.status}`
    throw new Error(`Cloudflare Images upload failed: ${msg}`)
  }

  const id = data?.result?.id
  if (!id) throw new Error('Cloudflare Images upload: missing result.id')
  return { id, alreadyExisted: false, raw: data }
}

/**
 * Delete an image from Cloudflare Images by its ID.
 */
export async function deleteImage(id) {
  assertConfigured()
  if (!id) throw new Error('deleteImage: id required')
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/images/v1/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TOKEN}` },
    }
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Cloudflare Images delete failed: HTTP ${res.status} ${text}`)
  }
  return true
}

/**
 * Build the public delivery URL for a Cloudflare Image.
 *
 * Variants are configured in the CF Images dashboard. The default `public`
 * variant is roughly 1500px on the long side with auto webp/avif. For our
 * chat-wall thumbnails that's a good default — lighter than full Dropbox
 * originals while still sharp on retina displays.
 *
 * Add custom variants in CF dashboard (e.g. `thumb` at 400px) and pass that
 * variant name here when you want smaller sizes for grid views.
 */
export function buildDeliveryUrl(imageId, variant = 'public') {
  if (!imageId) return null
  if (!HASH) {
    throw new Error('CLOUDFLARE_IMAGES_HASH not set — cannot build delivery URL')
  }
  return `https://imagedelivery.net/${HASH}/${imageId}/${variant}`
}

/**
 * Rewrite a stored Cloudflare Images delivery URL to a smaller size.
 *
 * We store URLs ending in `/public` (the full ~1500px variant) on the Airtable
 * `CDN URL` field. The browse views render at 64px–600px on screen, so
 * fetching the full variant burns 100KB+ per thumbnail for no visible gain.
 *
 * Flexible Variants (enabled via API on the account) lets us swap `/public`
 * for an inline transform like `/w=200,fit=cover,quality=85`. The same
 * stored ID is reused — no re-upload, no extra storage.
 *
 * Pass-through for null, non-CF, or already-transformed URLs.
 *
 * @param {string|null|undefined} url - Stored CDN URL (or anything else).
 * @param {number} width - Target rendered width in CSS pixels. CF generates
 *   2x for retina automatically when fit=cover. Use the visible width; ~200
 *   for slot thumbs, ~600 for grid cards, ~1200 for modal previews.
 * @returns {string|null|undefined} URL with size transform applied.
 */
export function cdnUrlAtSize(url, width) {
  if (!url || typeof url !== 'string') return url
  if (!width || width <= 0) return url
  if (!url.includes('imagedelivery.net')) return url
  // Only rewrite the canonical /public variant; leave anything else alone so
  // callers that already specified a transform aren't double-rewritten.
  return url.replace(/\/public$/, `/w=${width},fit=cover,quality=85`)
}

export function isCloudflareImagesConfigured() {
  return !!(ACCOUNT_ID && HASH && TOKEN)
}

/**
 * Mirror a single Asset record to Cloudflare Images and update the Airtable
 * record with the resulting CDN URL. Idempotent — uses the Airtable record
 * ID as the CF image ID, so re-runs on the same asset are no-ops.
 *
 * Skip rules (returns { skipped: true, reason }):
 *   - already has CDN URL set
 *   - missing Dropbox Shared Link
 *   - asset type is not an image
 *
 * On hard failure (oversized file, bad source), returns { skipped: false,
 * error }. Caller decides whether to log/retry. Does NOT throw.
 *
 * @param {object} asset - Airtable Assets record. Must have:
 *   id, fields: { Asset Name, Dropbox Shared Link, File Extension?,
 *   Asset Type?, CDN URL? }
 * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string,
 *   error?: string, cdnUrl?: string, imageId?: string }>}
 */
export async function mirrorAssetToCloudflare(asset) {
  if (!isCloudflareImagesConfigured()) {
    return { ok: false, error: 'CF Images not configured' }
  }
  const f = asset?.fields || {}

  // Skip if already mirrored
  if (f['CDN URL']) {
    return { ok: true, skipped: true, reason: 'already mirrored' }
  }

  // Skip if no source link
  const link = f['Dropbox Shared Link']
  if (!link) {
    return { ok: false, skipped: true, reason: 'no Dropbox Shared Link' }
  }

  // Asset-type detection. Photos mirror the Dropbox file directly (the actual
  // displayable image). Videos mirror the Airtable-generated Thumbnail —
  // we can't put a video into CF Images, but we CAN put its poster frame
  // there so the browse-view <img> renders from imagedelivery.net even for
  // video assets.
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tiff', 'tif']
  const imageRe = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)/i
  const ext = (f['File Extension'] || '').toLowerCase()
  const typeRaw = f['Asset Type']
  const type = (typeof typeRaw === 'string' ? typeRaw : typeRaw?.name || '').toLowerCase()
  const isImage = imageExts.includes(ext) || imageRe.test(link) || type === 'photo' || type === 'image'
  const isVideo = type === 'video' || /\.(mp4|mov|avi|webm|mkv|m4v)/i.test(link)

  let sourceUrl
  if (isImage) {
    // Convert Dropbox shared link to a raw fetchable URL (?raw=1 forces bytes,
    // not the HTML preview page).
    const cleanLink = link
      .replace(/[?&]dl=0/, '')
      .replace(/[?&]raw=1/, '')
      .replace(/[?&]dl=1/, '')
    sourceUrl = cleanLink + (cleanLink.includes('?') ? '&raw=1' : '?raw=1')
  } else if (isVideo) {
    // For videos, mirror the Airtable-generated poster frame. Skip if Airtable
    // hasn't generated one yet (rare; happens briefly after upload).
    const thumb = (f['Thumbnail'] || [])[0]
    sourceUrl = thumb?.thumbnails?.large?.url || thumb?.url
    if (!sourceUrl) {
      return { ok: false, skipped: true, reason: 'video has no Thumbnail attachment yet' }
    }
  } else {
    return { ok: false, skipped: true, reason: 'unsupported asset type' }
  }

  let imageId
  let alreadyExisted = false
  try {
    const result = await uploadImageByUrl(sourceUrl, asset.id)
    imageId = result.id
    alreadyExisted = result.alreadyExisted
  } catch (err) {
    return { ok: false, error: err.message }
  }

  const cdnUrl = buildDeliveryUrl(imageId, 'public')

  // Update Airtable. We patch directly with fetch instead of importing from
  // adminAuth to keep this lib free of Next.js / route-only dependencies
  // (so it can also be called from cron handlers cleanly).
  const OPS_BASE = 'applLIT2t83plMqNx'
  const res = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/Assets/${asset.id}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_PAT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: { 'CDN URL': cdnUrl, 'CDN Image ID': imageId },
      }),
    }
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, error: `Airtable PATCH ${res.status}: ${text}` }
  }
  return { ok: true, cdnUrl, imageId, alreadyExisted }
}

/**
 * Mirror an Inspiration record's Thumbnail to Cloudflare Images. Source is the
 * Airtable native attachment (created by Apify ingest or Make.com upload), not
 * a Dropbox link — we feed Cloudflare the `large` thumbnail variant URL so the
 * stored image is browse-sized rather than the full-resolution original.
 *
 * Same idempotency model as mirrorAssetToCloudflare: uses the Inspiration
 * record ID as the CF image ID so duplicate runs no-op.
 *
 * @param {object} record - Airtable Inspiration record. Must have:
 *   id, fields: { Thumbnail (attachment array), CDN URL? }
 * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string,
 *   error?: string, cdnUrl?: string, imageId?: string }>}
 */
export async function mirrorInspirationToCloudflare(record) {
  if (!isCloudflareImagesConfigured()) {
    return { ok: false, error: 'CF Images not configured' }
  }
  const f = record?.fields || {}

  if (f['CDN URL']) {
    return { ok: true, skipped: true, reason: 'already mirrored' }
  }

  const thumb = (f['Thumbnail'] || [])[0]
  // Prefer the large auto-resized variant (~512px) to keep CF storage small
  // and downloads fast. Fall back to the full attachment URL.
  const sourceUrl = thumb?.thumbnails?.large?.url || thumb?.url
  if (!sourceUrl) {
    return { ok: false, skipped: true, reason: 'no Thumbnail attachment' }
  }

  let imageId
  let alreadyExisted = false
  try {
    const result = await uploadImageByUrl(sourceUrl, record.id)
    imageId = result.id
    alreadyExisted = result.alreadyExisted
  } catch (err) {
    return { ok: false, error: err.message }
  }

  const cdnUrl = buildDeliveryUrl(imageId, 'public')

  const OPS_BASE = 'applLIT2t83plMqNx'
  const res = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/Inspiration/${record.id}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_PAT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: { 'CDN URL': cdnUrl, 'CDN Image ID': imageId },
      }),
    }
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, error: `Airtable PATCH ${res.status}: ${text}` }
  }
  return { ok: true, cdnUrl, imageId, alreadyExisted }
}
