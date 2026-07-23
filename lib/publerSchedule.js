// Publer Phase 3 scheduling helpers — pure functions, no I/O.
//
// These encode the "flip from draft to live" logic for the publer-queue cron:
//   - per-account live gate (Live Mode), with a global emergency kill-switch
//   - deterministic schedule jitter (anti-pattern-detection)
//   - scheduled_at computation from the Post's operator-set Scheduled Date
//   - banned/OF-adjacent hashtag stripping + IG's 5-tag cap
//
// Kept pure (and isolated from Airtable/Publer) so the scheduling math can be
// reasoned about and unit-tested without the network. The cron wires these in.

// ---------------------------------------------------------------------------
// Live gate
// ---------------------------------------------------------------------------
//
// Two layers of safety, both default-closed:
//   1. Per-account `Live Mode` field on Publer Accounts. Missing/'Draft' =>
//      drafts only. The operator flips ONE account to 'Scheduled' when it
//      graduates warmup (Day 23+), leaving every other account drafting.
//   2. Global `PUBLER_FORCE_DRAFT` env. When truthy, forces EVERY account back
//      to draft regardless of Live Mode — an emergency brake (e.g. a Meta
//      enforcement wave) that doesn't require touching Airtable.
//
// A brand-new account synced from Publer has no Live Mode set => treated as
// Draft => nothing it posts can go live until a human explicitly graduates it.
export function resolvePublerState(accountFields, { forceDraft } = {}) {
  if (forceDraft) return 'draft'
  const mode = accountFields?.['Live Mode']
  const modeName = typeof mode === 'string' ? mode : mode?.name
  return modeName === 'Scheduled' ? 'scheduled' : 'draft'
}

// Read the global force-draft kill-switch from env. Any of 1/true/yes (case-
// insensitive) trips it.
export function isForceDraft(env = process.env) {
  const v = String(env.PUBLER_FORCE_DRAFT || '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

// ---------------------------------------------------------------------------
// Schedule jitter
// ---------------------------------------------------------------------------

// Tiny deterministic string hash (djb2). We only need stable pseudo-randomness
// seeded by postId+date so re-running the cron on the same post yields the SAME
// jittered time (idempotent — never shifts an already-submitted slot).
export function hashString(str) {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0  // h*33 + c, kept in int32
  }
  return Math.abs(h)
}

// Deterministic offset in [-25, +25] minutes, in milliseconds. Seeded by
// postId + the calendar day so two posts on the same account/day don't share a
// time, and so :00/:15/:30/:45 round times never appear verbatim.
export function jitterOffsetMs(postId, dateIso) {
  const day = (dateIso || '').slice(0, 10)
  const seed = hashString(`${postId}-${day}`)
  const minutes = -25 + (seed % 51)  // -25 .. +25 inclusive
  return minutes * 60 * 1000
}

// Compute the final scheduled_at for a post.
//   target = the operator-set Scheduled Date (from grid planner / Post Prep).
//   If absent or already in the past, fall back to now + minLead so Publer
//   never receives a past timestamp (which it rejects / fires immediately).
//   Jitter is then applied, but the result is clamped to never fall before
//   now + minLead.
// Returns a Date.
export function computeScheduledAt(scheduledDateRaw, postId, { now = new Date(), minLeadMs = 10 * 60 * 1000 } = {}) {
  const floor = new Date(now.getTime() + minLeadMs)

  let base = null
  if (scheduledDateRaw) {
    const d = new Date(scheduledDateRaw)
    if (!isNaN(d.getTime())) base = d
  }
  // No usable operator time, or it's in the past → anchor at the floor.
  if (!base || base.getTime() < floor.getTime()) base = floor

  const jittered = new Date(base.getTime() + jitterOffsetMs(postId, base.toISOString()))
  // Clamp: jitter must not push us before the minimum lead.
  if (jittered.getTime() < floor.getTime()) return floor
  return jittered
}

// Publer's `scheduled_at` format. We emit full ISO-8601 UTC (…Z). Publer
// interprets the instant and renders it in the workspace timezone.
//
// NOTE (verify on first live post): the exact accepted format / timezone
// interpretation is NOT pinned in the scoping docs. Test plan step #1 is the
// check — enqueue a post for a known local time and confirm Publer's dashboard
// shows it in the expected window. Adjust here if Publer wants local wall-clock
// instead of UTC. Do not assume; verify.
export function formatPublerScheduledAt(date) {
  return date.toISOString()
}

// ---------------------------------------------------------------------------
// Hashtag hygiene
// ---------------------------------------------------------------------------

// OF-adjacent / reach-suppressing denylist. Sourced from the AI-account
// playbook (project_ai_account_creation memory). One banned tag can cut reach
// ~90%, so we strip rather than reject the whole post. This is a hardcoded
// floor; a future owner-editable `Hashtag Denylist` Airtable table (Batch 3)
// can layer on top without changing callers.
export const BANNED_HASHTAGS = new Set([
  '#onlyfans', '#linkinbio', '#nsfw', '#18plus', '#spicycontent',
  '#milf', '#curvy', '#beauty', '#models', '#alone',
  // generic reach-suppressors flagged in the scoping notes
  '#brain', '#pushups',
])

// IG capped hashtags at 5 per post (Dec 2025, per memory). Anything beyond is
// trimmed after denylist removal.
export const MAX_HASHTAGS = 5

// Normalize a single token to a comparable form: lowercase, leading '#'.
function normalizeTag(tag) {
  const t = tag.trim().toLowerCase()
  if (!t) return ''
  return t.startsWith('#') ? t : `#${t}`
}

// Strip banned tags and enforce the 5-tag cap. Preserves original ordering and
// the original casing of kept tags. Returns { cleaned, removed, capped }.
//   cleaned  — space-joined surviving tags (or '' if none)
//   removed  — banned tags that were dropped (normalized)
//   capped   — tags dropped purely for exceeding MAX_HASHTAGS (normalized)
export function stripBannedHashtags(hashtagsStr) {
  const raw = (hashtagsStr || '').split(/\s+/).map(s => s.trim()).filter(Boolean)
  const kept = []
  const removed = []
  const seen = new Set()
  for (const tok of raw) {
    const norm = normalizeTag(tok)
    if (!norm) continue
    if (BANNED_HASHTAGS.has(norm)) { removed.push(norm); continue }
    if (seen.has(norm)) continue  // dedupe
    seen.add(norm)
    kept.push(tok.startsWith('#') ? tok : `#${tok}`)
  }
  const capped = kept.slice(MAX_HASHTAGS).map(normalizeTag)
  const finalTags = kept.slice(0, MAX_HASHTAGS)
  return { cleaned: finalTags.join(' '), removed, capped }
}
