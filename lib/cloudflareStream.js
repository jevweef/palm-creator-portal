/**
 * Cloudflare Stream helpers — upload videos by URL, poll for ready, build
 * playback / poster URLs.
 *
 * Why this exists: Dropbox shared links aren't a CDN and certainly aren't a
 * video streaming service. Loading a 30s reel from Dropbox can take 5–10s
 * to first frame because the browser fetches the entire MP4 sequentially.
 * CF Stream serves HLS adaptive bitrate from the edge; first frame in
 * <500ms with a poster image visible instantly.
 *
 * Same idempotency model as Cloudflare Images: pass the Airtable record ID
 * + a discriminator (raw / edit) as the upload `meta` so we can tell at a
 * glance which Stream object goes with which Asset, and re-runs that find
 * an existing Stream entry can skip cleanly.
 *
 * Usage:
 *   import { uploadVideoByUrl, pollStreamReady, buildStreamHlsUrl,
 *            buildStreamPosterUrl, mirrorAssetToStream } from '@/lib/cloudflareStream'
 */

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const TOKEN = process.env.CLOUDFLARE_IMAGES_TOKEN
// Customer code is account-specific and constant. Surfaces in every Stream
// playback URL. Also obtainable from /accounts/{id}/stream/keys but it
// never changes for an account so hardcoding is fine.
const CUSTOMER_CODE = process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE || 's6evvwyakoxbda2u'

function assertConfigured() {
  if (!ACCOUNT_ID || !TOKEN) {
    throw new Error('Cloudflare Stream not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_IMAGES_TOKEN (with Stream:Edit permission).')
  }
}

export function isCloudflareStreamConfigured() {
  return !!(ACCOUNT_ID && TOKEN && CUSTOMER_CODE)
}

/**
 * Tell Cloudflare to fetch a video from a public URL (Dropbox raw link)
 * and ingest it into Stream. Returns immediately with the Stream UID;
 * the actual download + transcode happens server-side at CF and takes
 * 10–60s depending on video length. Use pollStreamReady to wait.
 *
 * @param {string} url - Public URL Cloudflare will fetch.
 * @param {object} [meta] - Stored as Stream metadata. We pass the Airtable
 *   record ID so a Stream listing is traceable back to its Asset.
 * @returns {Promise<{uid: string, raw: object}>}
 */
export async function uploadVideoByUrl(url, meta = null) {
  assertConfigured()
  if (!url) throw new Error('uploadVideoByUrl: url required')

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/stream/copy`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, meta: meta || undefined }),
    }
  )

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const errs = data?.errors || []
    const msg = errs.map(e => `${e.code}: ${e.message}`).join('; ') || `HTTP ${res.status}`
    throw new Error(`Cloudflare Stream upload failed: ${msg}`)
  }

  const uid = data?.result?.uid
  if (!uid) throw new Error('Cloudflare Stream upload: missing result.uid')
  return { uid, raw: data }
}

/**
 * Poll a Stream UID until it transitions out of `downloading`/`inprogress`
 * into `ready` (or fails). Returns the final result object.
 *
 * @param {string} uid
 * @param {object} [opts]
 * @param {number} [opts.intervalMs] - poll interval (default 4000)
 * @param {number} [opts.timeoutMs] - give up after (default 5 min)
 * @returns {Promise<object>}
 */
export async function pollStreamReady(uid, { intervalMs = 4000, timeoutMs = 300_000 } = {}) {
  assertConfigured()
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/stream/${uid}`,
      { headers: { Authorization: `Bearer ${TOKEN}` } }
    )
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`Stream poll failed: HTTP ${res.status}`)
    const result = data?.result
    const state = result?.status?.state
    if (result?.readyToStream || state === 'ready') return result
    if (state === 'error') {
      const reason = result?.status?.errorReasonText || result?.status?.errorReasonCode || 'unknown'
      throw new Error(`Stream encoding failed: ${reason}`)
    }
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error(`Stream poll timeout for uid=${uid}`)
}

/**
 * Delete a Stream video by UID. Used when an asset is replaced / cleaned up.
 */
export async function deleteStreamVideo(uid) {
  assertConfigured()
  if (!uid) throw new Error('deleteStreamVideo: uid required')
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/stream/${uid}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${TOKEN}` } }
  )
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '')
    throw new Error(`Stream delete failed: HTTP ${res.status} ${text}`)
  }
  return true
}

// ─── URL builders (no auth needed; public playback) ─────────────────────────

/** HLS manifest URL — works in Safari natively and via hls.js elsewhere. */
export function buildStreamHlsUrl(uid) {
  if (!uid) return null
  return `https://customer-${CUSTOMER_CODE}.cloudflarestream.com/${uid}/manifest/video.m3u8`
}

/** DASH manifest URL — alternative streaming protocol (needs dash.js). */
export function buildStreamDashUrl(uid) {
  if (!uid) return null
  return `https://customer-${CUSTOMER_CODE}.cloudflarestream.com/${uid}/manifest/video.mpd`
}

/** Iframe embed URL — a hosted CF Stream player. Drop-in for <iframe src=...>. */
export function buildStreamIframeUrl(uid, opts = {}) {
  if (!uid) return null
  const params = new URLSearchParams()
  if (opts.autoplay) params.set('autoplay', 'true')
  if (opts.muted) params.set('muted', 'true')
  if (opts.loop) params.set('loop', 'true')
  if (opts.controls === false) params.set('controls', 'false')
  if (opts.preload) params.set('preload', opts.preload)
  if (opts.poster) params.set('poster', opts.poster)
  const query = params.toString()
  return `https://customer-${CUSTOMER_CODE}.cloudflarestream.com/${uid}/iframe${query ? '?' + query : ''}`
}

/** Auto-generated thumbnail JPEG. Pass {time, width, height, fit} for variants. */
export function buildStreamPosterUrl(uid, { time = '1s', width = null, height = null, fit = 'crop' } = {}) {
  if (!uid) return null
  const params = new URLSearchParams()
  params.set('time', time)
  if (width) params.set('width', String(width))
  if (height) params.set('height', String(height))
  if (fit) params.set('fit', fit)
  return `https://customer-${CUSTOMER_CODE}.cloudflarestream.com/${uid}/thumbnails/thumbnail.jpg?${params}`
}

// ─── Asset-record-aware mirror ─────────────────────────────────────────────

const OPS_BASE = 'applLIT2t83plMqNx'
const ASSETS_TABLE = 'tblAPl8Pi5v1qmMNM'

function rawDropboxUrl(url) {
  if (!url) return ''
  const clean = url
    .replace(/[?&]dl=0/, '')
    .replace(/[?&]raw=1/, '')
    .replace(/[?&]dl=1/, '')
  return clean + (clean.includes('?') ? '&raw=1' : '?raw=1')
}

/**
 * Mirror the editor's edit and/or the creator's raw clip for an Asset to
 * Cloudflare Stream. Idempotent — checks existing Stream Edit ID / Stream
 * Raw ID before re-uploading.
 *
 * @param {object} asset - Airtable Assets record. Must have:
 *   id, fields: { Edited File Link?, Dropbox Shared Link?, Stream Edit ID?, Stream Raw ID? }
 * @param {object} [opts]
 * @param {boolean} [opts.waitReady] - if true (default), polls until both
 *   uploads transcode. Set false to fire-and-forget.
 * @returns {Promise<{ ok, edit?: {uid, alreadyExisted}, raw?: {uid, alreadyExisted}, error? }>}
 */
export async function mirrorAssetToStream(asset, { waitReady = true } = {}) {
  if (!isCloudflareStreamConfigured()) {
    return { ok: false, error: 'CF Stream not configured' }
  }
  const f = asset?.fields || {}

  const editLink = f['Edited File Link']
  const rawLink = f['Dropbox Shared Link']
  const editExisting = f['Stream Edit ID']
  const rawExisting = f['Stream Raw ID']

  const fieldsToWrite = {}
  let editResult = editExisting ? { uid: editExisting, alreadyExisted: true } : null
  let rawResult = rawExisting ? { uid: rawExisting, alreadyExisted: true } : null

  // Edit upload
  if (editLink && !editExisting) {
    try {
      const { uid } = await uploadVideoByUrl(rawDropboxUrl(editLink), {
        airtableId: asset.id,
        kind: 'edit',
      })
      fieldsToWrite['Stream Edit ID'] = uid
      editResult = { uid, alreadyExisted: false }
    } catch (err) {
      return { ok: false, error: `edit upload: ${err.message}` }
    }
  }

  // Raw upload
  if (rawLink && !rawExisting) {
    try {
      const { uid } = await uploadVideoByUrl(rawDropboxUrl(rawLink), {
        airtableId: asset.id,
        kind: 'raw',
      })
      fieldsToWrite['Stream Raw ID'] = uid
      rawResult = { uid, alreadyExisted: false }
    } catch (err) {
      // Don't lose a successful edit upload because raw failed — write what
      // we have, then surface the raw error.
      if (Object.keys(fieldsToWrite).length) {
        await patchAssetFields(asset.id, fieldsToWrite).catch(() => {})
      }
      return { ok: false, error: `raw upload: ${err.message}`, edit: editResult }
    }
  }

  if (Object.keys(fieldsToWrite).length) {
    try {
      await patchAssetFields(asset.id, fieldsToWrite)
    } catch (err) {
      return { ok: false, error: `Airtable PATCH: ${err.message}`, edit: editResult, raw: rawResult }
    }
  }

  if (waitReady) {
    try {
      if (editResult && !editResult.alreadyExisted) await pollStreamReady(editResult.uid)
      if (rawResult && !rawResult.alreadyExisted) await pollStreamReady(rawResult.uid)
    } catch (err) {
      return { ok: false, error: `poll: ${err.message}`, edit: editResult, raw: rawResult }
    }
  }

  return { ok: true, edit: editResult, raw: rawResult }
}

async function patchAssetFields(recordId, fields) {
  const res = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${ASSETS_TABLE}/${recordId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_PAT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    }
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`PATCH ${res.status}: ${text}`)
  }
}
