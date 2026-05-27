// Publer REST API client.
//
// Auth model: workspace-scoped API key + workspace ID, both required headers.
// Plan requirement: Business or Enterprise; Standard plans return 403.
// Rate limit: 100 requests / 2 minutes / user — we don't track headroom yet
// (Publer doesn't expose limit headers), so callers must rely on 429 retry.
//
// Publer-specific gotcha: POST /posts/schedule returns a job_id immediately
// but the actual publish runs async — must poll /job_status/{id}. Even on
// status='complete', payload.failures[] can be non-empty (per-account fails
// inside an otherwise-OK job). Always parse it.
//
// Async-but-not-webhooks: Publer has no public webhooks as of May 2026
// (third-party docs that claim otherwise are wrong; Publer's own help article
// confirms email-only notifications). Polling is the only signal.

const BASE = 'https://app.publer.com/api/v1'

function authHeaders() {
  const key = process.env.PUBLER_API_KEY
  const ws = process.env.PUBLER_WORKSPACE_ID
  if (!key || !ws) {
    throw new Error('PUBLER_API_KEY and PUBLER_WORKSPACE_ID env vars are required')
  }
  // The exact prefix is `Bearer-API` (hyphenated, not `Bearer`). Publer's
  // docs are emphatic on this — using plain `Bearer` 401s.
  return {
    Authorization: `Bearer-API ${key}`,
    'Publer-Workspace-Id': ws,
    'Content-Type': 'application/json',
  }
}

// Internal: handle 429 with one retry, normalize errors so callers don't
// have to inspect raw Response objects.
async function publerFetch(path, init = {}, { retries = 1 } = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`
  const res = await fetch(url, { ...init, headers: { ...authHeaders(), ...(init.headers || {}) } })

  if (res.status === 429 && retries > 0) {
    // Publer doesn't surface Retry-After consistently. Hard-wait 2s and try
    // once — cron callers should not retry past this; the next tick will
    // re-pick the post.
    await new Promise(r => setTimeout(r, 2000))
    return publerFetch(path, init, { retries: retries - 1 })
  }

  const text = await res.text()
  let data = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text.slice(0, 500) } }

  if (!res.ok) {
    const msg = data?.error || data?.message || `Publer ${res.status}: ${text.slice(0, 200)}`
    const err = new Error(msg)
    err.status = res.status
    err.publerBody = data
    throw err
  }
  return data
}

// GET /accounts — list all social accounts in the configured workspace.
// Each account: { id, provider, name, social_id, picture, type, ... }.
// `provider` is the social network ('instagram', 'facebook', etc).
export async function listAccounts() {
  return publerFetch('/accounts', { method: 'GET' })
}

// POST /media/from-url — Publer pulls the media from the URL itself, so we
// don't have to stream large files through our Vercel functions. The URL
// must be publicly reachable (Cloudflare Images URLs are; Dropbox preview
// links are NOT — convert ?dl=0 → ?raw=1 first).
//
// Per scoping doc §6.3: callers must validate media size ≤200MB BEFORE
// invoking this. The Publer side will 413 anything bigger.
//
// Returns: { id, path, thumbnail, validity, width, height, type, name }
// where `id` is the media_id we reference in subsequent post envelopes.
export async function importMediaFromUrl({ url, name, type = 'single' }) {
  if (!url) throw new Error('importMediaFromUrl: url required')
  return publerFetch('/media/from-url', {
    method: 'POST',
    body: JSON.stringify({
      type,
      direct_upload: false,
      in_library: true,
      media: [{ url, name: name || url.split('/').pop() || 'asset' }],
    }),
  })
}

// POST /posts/schedule — bulk schedule (up to 500 posts per call).
//
// envelope shape (per scoping doc §3.2 + Publer docs):
//   { bulk: { state: 'draft' | 'scheduled' | ...,
//             posts: [ { networks: { instagram: {...}, facebook: {...} },
//                       accounts: [ { id, scheduled_at } ] } ] } }
//
// Phase 2 hard rule: callers pass state='draft' only. Phase 3 will flip to
// 'scheduled'. Letting `state` default silently was a documented Publer
// gotcha — always pass it explicitly.
//
// Returns: { job_id, ... } — opaque, must be polled via getJobStatus.
export async function schedulePosts(envelope) {
  if (!envelope?.bulk?.state) {
    throw new Error('schedulePosts: bulk.state is required (no silent defaults)')
  }
  if (!Array.isArray(envelope?.bulk?.posts) || !envelope.bulk.posts.length) {
    throw new Error('schedulePosts: bulk.posts[] required')
  }
  return publerFetch('/posts/schedule', {
    method: 'POST',
    body: JSON.stringify(envelope),
  })
}

// GET /job_status/{job_id} — poll for the result of an async post submit.
//
// Critical: status='complete' does NOT mean every account succeeded. Always
// inspect payload.failures[] (array of { account_id, account_name, provider,
// message }). Empty array = full success.
export async function getJobStatus(jobId) {
  if (!jobId) throw new Error('getJobStatus: jobId required')
  return publerFetch(`/job_status/${encodeURIComponent(jobId)}`, { method: 'GET' })
}

// Helper: derive a stable failure summary from a job_status response.
// Returns { kind: 'ok' | 'partial' | 'failed', failures, error }.
// 'partial' means status=complete but some accounts in failures[].
// 'failed' means the whole job died (status=failed or unexpected shape).
export function summarizeJob(jobRes) {
  const status = jobRes?.status || jobRes?.data?.status || jobRes?.result?.status
  const payload = jobRes?.payload || jobRes?.data?.payload || jobRes?.result?.payload || {}
  const failures = Array.isArray(payload?.failures) ? payload.failures : []

  if (status === 'failed') {
    return { kind: 'failed', failures, error: jobRes?.error || jobRes?.message || 'job failed' }
  }
  if (status === 'complete') {
    return failures.length
      ? { kind: 'partial', failures, error: null }
      : { kind: 'ok', failures: [], error: null }
  }
  return { kind: 'pending', failures, error: null }
}
