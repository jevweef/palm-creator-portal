// Client-side Dropbox uploader that transparently handles files of ANY size.
//
// Dropbox's simple /files/upload endpoint has a hard 150 MB per-request cap.
// Files at or under SINGLE_SHOT_MAX go through it directly (one request);
// anything larger is streamed through an upload session
// (start -> append_v2 -> finish) in CHUNK_SIZE pieces, which removes the size
// ceiling entirely. The creator always picks ONE file and gets ONE whole file
// in Dropbox — the chunking is invisible plumbing.
//
// Bulletproofing for big files on phones (flaky networks, long transfers):
//   - every chunk request retries with exponential backoff (network blips/429/5xx);
//   - a lost-ack offset mismatch (incorrect_offset) is resynced, never fatal —
//     on BOTH append and finish;
//   - an expired token mid-upload (401) is refreshed via getToken() and the
//     transfer resumes from the same byte, the session id surviving the refresh.
//
// Uses XMLHttpRequest (not fetch) so we get real byte-level upload progress,
// which fetch cannot report. Designed to run in the browser, posting directly
// to content.dropboxapi.com with a short-lived token + team-root path-root.

const SINGLE_SHOT_MAX = 140 * 1024 * 1024 // stay safely under Dropbox's 150 MB cap
const CHUNK_SIZE = 32 * 1024 * 1024       // 32 MB per chunk (a multiple of 4 MB)
const MAX_TRIES = 8                        // per-request transient retries
const MAX_REFRESHES = 3                    // token refreshes allowed per request
const BASE = 'https://content.dropboxapi.com/2/files'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// 0.7s, 1.4s, 2.8s, 5.6s, then capped at 10s — ~50s of cover per chunk.
const backoff = (i) => Math.min(10000, 700 * 2 ** i)

// Low-level POST via XHR so we can surface upload progress per chunk.
function xhrPost(url, { accessToken, pathRoot, apiArg, body, onUploadProgress, signal }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`)
    xhr.setRequestHeader('Dropbox-API-Arg', JSON.stringify(apiArg))
    if (pathRoot) xhr.setRequestHeader('Dropbox-API-Path-Root', pathRoot)
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')

    if (xhr.upload && onUploadProgress) {
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onUploadProgress(e.loaded) }
    }
    xhr.onload = () => {
      let json = null
      try { json = xhr.responseText ? JSON.parse(xhr.responseText) : null } catch { /* non-JSON */ }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, json, text: xhr.responseText })
    }
    xhr.onerror = () => reject(new Error('Network error'))
    xhr.onabort = () => reject(new Error('Upload canceled'))
    if (signal) {
      if (signal.aborted) { xhr.abort(); return }
      signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }
    xhr.send(body)
  })
}

// Confirm Dropbox stored exactly the bytes we sent before we call it done.
function verify(meta, file) {
  if (meta && typeof meta.size === 'number' && meta.size !== file.size) {
    throw new Error(`Upload incomplete: Dropbox received ${meta.size} of ${file.size} bytes`)
  }
  return meta
}

/**
 * Upload a single File to Dropbox at `path`.
 * @param {File}     opts.file
 * @param {string}   opts.path        full Dropbox path
 * @param {string}   opts.accessToken short-lived Dropbox token (initial)
 * @param {string}   opts.pathRoot    JSON string for Dropbox-API-Path-Root (team root namespace)
 * @param {Function} [opts.getToken]  async () => fresh access token string; called on a 401 to
 *                                     refresh and resume mid-transfer. Without it, a 401 is fatal.
 * @param {Object}   [opts.commit]    overrides for commit args (mode/autorename/mute)
 * @param {Function} [opts.onProgress] called with a 0..1 fraction as bytes land
 * @param {AbortSignal} [opts.signal] cancel the in-flight upload
 * @returns Dropbox file metadata (path_display, size, content_hash, ...)
 */
export async function uploadFileToDropbox({ file, path, accessToken, pathRoot, getToken, commit = {}, onProgress, signal }) {
  const commitArg = { path, mode: 'add', autorename: true, mute: true, ...commit }
  let token = accessToken

  // Report overall file progress = (bytes already committed + bytes of current chunk) / size.
  const report = (committed, loadedInChunk = 0) =>
    onProgress?.(Math.min(1, (committed + loadedInChunk) / (file.size || 1)))

  // One Dropbox call, made resilient:
  //   - transient failures (network/429/5xx) retry with exponential backoff;
  //   - a 401 refreshes the token via getToken() and retries the same bytes;
  //   - an incorrect_offset response is RETURNED (not thrown) so the caller can resync;
  //   - any other 4xx fails fast (won't fix on retry).
  async function call(url, apiArg, body, onUploadProgress) {
    let lastErr
    let refreshes = 0
    for (let i = 0; i < MAX_TRIES; i++) {
      if (signal?.aborted) throw new Error('Upload canceled')
      let r
      try {
        r = await xhrPost(url, { accessToken: token, pathRoot, apiArg, body, onUploadProgress, signal })
      } catch (e) {
        if (e.message === 'Upload canceled') throw e
        lastErr = e
        await sleep(backoff(i))
        continue
      }
      if (r.ok) return r

      // Token expired mid-upload — refresh and retry the same bytes. The upload
      // session id is unaffected by a token swap. Refresh doesn't burn a try.
      if (r.status === 401 && getToken && refreshes < MAX_REFRESHES) {
        refreshes++
        const fresh = await getToken().catch(() => null)
        if (!fresh) throw new Error('Lost Dropbox authorization mid-upload')
        token = fresh
        i--
        continue
      }

      // Lost-ack offset mismatch — hand back to the caller to resync; not an error.
      if (r.json?.error?.['.tag'] === 'incorrect_offset' &&
          typeof r.json.error.correct_offset === 'number') {
        return r
      }

      lastErr = new Error(`Dropbox ${r.status}: ${r.text}`)
      // Other 4xx (bad path, no permission, …) won't fix on retry — fail fast.
      if (r.status >= 400 && r.status < 500 && r.status !== 429) throw lastErr
      await sleep(backoff(i))
    }
    throw lastErr
  }

  // Small file — one request.
  if (file.size <= SINGLE_SHOT_MAX) {
    const r = await call(`${BASE}/upload`, commitArg, file, (loaded) => report(0, loaded))
    if (!r.ok) throw new Error(`Dropbox upload failed: ${r.text}`)
    onProgress?.(1)
    return verify(r.json, file)
  }

  // Large file — chunked upload session.
  const first = file.slice(0, CHUNK_SIZE)
  const startRes = await call(`${BASE}/upload_session/start`, { close: false }, first, (loaded) => report(0, loaded))
  const sessionId = startRes.json?.session_id
  if (!sessionId) throw new Error('Dropbox did not return an upload session id')

  let offset = first.size
  report(offset)

  // Stream the rest. The LAST chunk goes through finish (which commits); every
  // chunk caps its window at CHUNK_SIZE so neither append nor finish can ever
  // exceed the 150 MB per-request limit, even after an offset resync.
  while (offset < file.size) {
    const end = Math.min(offset + CHUNK_SIZE, file.size)
    const isLast = end >= file.size
    const committed = offset
    const cursor = { session_id: sessionId, offset }
    const url = isLast ? `${BASE}/upload_session/finish` : `${BASE}/upload_session/append_v2`
    const apiArg = isLast ? { cursor, commit: commitArg } : { cursor, close: false }

    const r = await call(url, apiArg, file.slice(offset, end), (loaded) => report(committed, loaded))

    if (r.ok) {
      if (isLast) { onProgress?.(1); return verify(r.json, file) }
      offset = end
      report(offset)
      continue
    }

    // The only non-ok call() returns is an incorrect_offset resync (lost ack):
    // jump to the byte Dropbox actually holds and carry on — works for the
    // final chunk too, since the loop simply recomputes whether we're at the end.
    const correct = r.json?.error?.correct_offset
    if (typeof correct === 'number') { offset = correct; report(offset); continue }
    throw new Error(`Dropbox ${isLast ? 'finish' : 'append'} failed at byte ${offset}: ${r.text}`)
  }
}
