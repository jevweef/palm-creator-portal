/**
 * Read-side helper for the AI Recreate pipeline's image storage migration.
 *
 * Architecture: Dropbox = canonical source of truth, CF Images = downsized
 * delivery cache, Airtable = metadata only.
 *
 * During the transition some legacy records still have only the Airtable
 * attachment. New writes drop the attachment entirely, so every read site
 * needs to gracefully fall back when the attachment field is empty.
 *
 * Usage:
 *   import { recreateImageUrl, toDropboxRaw } from '@/lib/recreateImageUrl'
 *
 *   // Stage B Output / Recreate Room Variation / Outfit Swap Output
 *   const url = recreateImageUrl(record.fields)
 *
 *   // Recreate Rooms (different field names)
 *   const url = recreateImageUrl(record.fields, {
 *     linkField: 'Base Dropbox Link',
 *     attField:  'Base Image',
 *   })
 */

/**
 * Convert any Dropbox shared link into a raw streamable URL. Idempotent —
 * safe to call on URLs that already have ?raw=1.
 */
export function toDropboxRaw(sharedLink) {
  if (!sharedLink) return null
  const cleaned = String(sharedLink)
    .replace(/[?&]dl=[01]/g, '')
    .replace(/[?&]raw=1/g, '')
    .replace(/\?$/, '')
  return cleaned + (cleaned.includes('?') ? '&raw=1' : '?raw=1')
}

/**
 * Resolve the best image URL for a record from the AI Recreate tables.
 *
 * Priority order:
 *   1. Dropbox raw URL (canonical full-res source — future-proof)
 *   2. CF Images URL if the table has one (fast browse-view delivery)
 *   3. Airtable attachment URL (legacy fallback — works during transition,
 *      will be empty once Phase 4 mass-clear runs)
 *
 * Returns null if the record has no image in any of these sources.
 *
 * @param {object} fields - record.fields (or the record itself)
 * @param {object} [opts]
 * @param {string} [opts.linkField='Dropbox Link']  - the field holding the
 *   Dropbox shared link
 * @param {string} [opts.cdnField=null] - optional CF Images URL field
 *   (e.g. 'CDN URL' for Photos). Used when full-res isn't required and
 *   browse-view speed matters more.
 * @param {string} [opts.attField='Image'] - legacy attachment field name
 * @param {boolean} [opts.preferCdn=false] - true → prefer CF over Dropbox
 *   when both exist (browse views). Default false (full-res first).
 * @returns {string|null}
 */
export function recreateImageUrl(fields, opts = {}) {
  const {
    linkField = 'Dropbox Link',
    cdnField = null,
    attField = 'Image',
    preferCdn = false,
  } = opts
  if (!fields) return null

  const dropboxUrl = toDropboxRaw(fields[linkField])
  const cdnUrl = cdnField ? (fields[cdnField] || null) : null
  const att = fields[attField]
  const attUrl = (Array.isArray(att) && att[0])
    ? (att[0].thumbnails?.large?.url || att[0].url || null)
    : null

  if (preferCdn) {
    return cdnUrl || dropboxUrl || attUrl || null
  }
  return dropboxUrl || cdnUrl || attUrl || null
}

/**
 * Same chain but returns the SMALL/thumbnail variant when available.
 * Useful for tight grid views where the legacy attachment's auto-thumbnail
 * is actually preferable to a full-res Dropbox download. Falls back to
 * full-size if no thumbnail variant exists.
 */
export function recreateThumbUrl(fields, opts = {}) {
  const { attField = 'Image' } = opts
  if (!fields) return null
  const att = fields[attField]
  if (Array.isArray(att) && att[0]) {
    const a = att[0]
    return a.thumbnails?.small?.url || a.thumbnails?.large?.url || a.url || null
  }
  // No attachment — fall through to the full chain (no thumbnail variant
  // available, browser/CF can handle the resize on the full image).
  return recreateImageUrl(fields, opts)
}
