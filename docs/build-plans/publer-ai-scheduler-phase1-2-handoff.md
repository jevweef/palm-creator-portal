# Publer AI Scheduler — Phase 1 + 2 Handoff

**Built:** 2026-05-26.
**Status:** Code shipped. Draft-only round-trip awaits user-side prerequisites (Airtable table creation + Publer API key + Amelia's IG account connected in Publer).
**Predecessor doc:** `docs/build-plans/publer-ai-scheduler.md`

---

## What shipped

### `lib/publer.js`
Thin REST client. Public functions:
- `listAccounts()` → `GET /accounts`
- `importMediaFromUrl({ url, name, type })` → `POST /media/from-url`
- `schedulePosts(envelope)` → `POST /posts/schedule` (asserts `bulk.state` is explicit — no silent defaults per Publer gotcha)
- `getJobStatus(jobId)` → `GET /job_status/{id}`
- `summarizeJob(jobRes)` → `{ kind: 'ok'|'partial'|'failed'|'pending', failures, error }`

Auth header is `Authorization: Bearer-API ${KEY}` (hyphenated, per Publer docs — plain `Bearer` 401s). Single 429-retry with 2s wait built in.

### API routes

| Path | Method | Purpose |
|---|---|---|
| `app/api/admin/publer/accounts/route.js` | GET | Proxies Publer's `/accounts` with 5-min in-memory cache. `?fresh=1` bypasses. |
| `app/api/admin/publer/sync-accounts/route.js` | POST | Diff-updates `Publer Accounts` Airtable table from Publer. Inserts new, refreshes Account Name / Publer Picture / Channel / Last Synced. Never deletes. Never overwrites operator-set fields (Creator, Account Type, Status, AI Consent). |
| `app/api/admin/publer/mappings/route.js` | GET, PATCH | GET returns every `Publer Accounts` row plus the list of Active Palm Creators. PATCH updates one row's mapping; rejects 400 if Account Type='AI' but AI Consent on File is empty. |
| `app/api/admin/publer/enqueue/route.js` | POST | Bulk-marks Posts with Status='Queued for Publer' + Pipeline Target='Publer' + Publer Status='Pending'. Validator: rejects any Post whose Creator+Channel doesn't map to an Active+AI Publer Account. |

### Cron workers

| Path | Schedule | Purpose |
|---|---|---|
| `app/api/cron/publer-queue/route.js` | `* * * * *` (every minute) | Drains 1 post per tick. Validates media URL size ≤200MB (fails `MEDIA_OVERSIZE`), URL-imports each media to Publer, submits envelope with `state: 'draft'`, stamps `Publer Job ID` + `Publer Status='Submitted'`. Same claim-lock pattern as `telegram-queue` (Publer Sending Since), with 10-min stale-lock recovery. |
| `app/api/cron/publer-job-poll/route.js` | `*/5 * * * *` (every 5 min) | Polls `/job_status/{id}` for up to 25 in-flight Submitted posts. Parses `payload.failures[]` even on `status: 'complete'`. Transitions: ok → `Publer Status='Scheduled'`, `Status='Sent to Publer'`; partial/failed → `Publer Status='Failed'`, `Status='Publer Send Failed'`. 24h timeout escape hatch. |

Both registered in `vercel.json`.

### Admin UI
`app/admin/publer/page.js` — table view of every `Publer Accounts` row. Per row: dropdowns for Creator + Account Type + Status, free-text input for AI Consent on File. "Save" is disabled until a change is dirty AND (Account Type≠'AI' OR AI Consent is non-empty). Includes a "Sync from Publer" button calling `POST /api/admin/publer/sync-accounts`.

Added to `app/admin/layout.js` sidebar: `{ href: '/admin/publer', label: 'Publer', icon: '📅' }`.

---

## Deviations from the scoping doc (worth knowing)

1. **`Platform` doesn't exist as "array of accounts" on Posts.** The scoping doc described routing via a Platform list of account refs. Real code (May 2026 refactor — see `app/api/admin/grid-planner/route.js:171` "legacy Account-based topic routing was retired 2026-05") routes by `Posts.Channel` (singleSelect IG/FB) + `Posts.Creator` (link). The cron + enqueue look up the matching `Publer Accounts` row by `(Creator, Channel)`. "Mixed-Account-Type Posts" can't exist in this codebase, so the §6.5 enqueue validator collapses to a single guard: the target account must be `Account Type='AI'` and `Status='Active'` — Real-type accounts get rejected with a clear error.

2. **Env var is `AIRTABLE_PAT`, not `AIRTABLE_API_KEY`.** Truth-in-code: `lib/adminAuth.js:171`. The kickoff prompt's env section was wrong on this; all new code uses `AIRTABLE_PAT`.

3. **No `Pipeline Target` validator added to `telegram-queue`.** Scoping doc §6.5 said both enqueues should reject mixed types. Since the existing Telegram path doesn't currently look at `Pipeline Target`, and AI-content accounts can't even be mapped in `Palm Creators` without going through the new `Publer Accounts` flow, the practical risk is zero. Phase 3 should add a symmetric rejector to `telegram/enqueue` once the AI flow is proven.

4. **No carousel per-slide rejection UI (§6.4).** Scoped for Phase 2.5 in the kickoff prompt but explicitly out-of-scope for the Phase 1+2 deliverable. `app/admin/editor/CarouselSubmissionsReview.js` exists and is where that work will land.

5. **No anti-pattern hygiene in the draft cron.** Scoping doc §5.5 specifies caption-template rotation, hashtag pool rotation, schedule jitter. Phase 2 ships drafts only, so none of that fires yet. Phase 3 picks all of it up — see "What Phase 3 needs."

---

## User-side prerequisites (Phase 0) — required before this works end-to-end

These were always Phase 0 per the scoping doc, but flagging here so the next agent / operator knows what's required.

- [ ] Set Publer workspace to **Owner's API** mode in the Publer dashboard.
- [ ] Generate `PUBLER_API_KEY` and `PUBLER_WORKSPACE_ID`. Add to:
  - `.env.local` for local dev
  - Vercel project env (both Preview + Production environments)
- [ ] Confirm `AIRTABLE_PAT` is already in env (it is — used by every existing admin route).
- [ ] Connect Amelia's AI account (`briel.ai` per scoping doc §6.1) in the Publer dashboard via "Professional (via Facebook)."
- [ ] **Create the `Publer Accounts` Airtable table** in `applLIT2t83plMqNx` with these columns (REST API can't `CREATE TABLE`):
  | Field | Type | Notes |
  |---|---|---|
  | Account Name | Single line text | Display name from Publer |
  | Channel | Single select | Options: `IG`, `FB` |
  | Publer Account ID | Single line text | Publer's UUID — primary lookup key |
  | Publer Provider | Single line text | e.g. `instagram`, `facebook` |
  | Publer Picture | URL | Optional avatar |
  | Creator | Link to another record (Palm Creators) | Single |
  | Account Type | Single select | Options: `Real`, `AI` |
  | Status | Single select | Options: `Active`, `Reauth Required`, `Disabled` |
  | AI Consent on File | Single line text (or URL) | Reference to TGP consent record. Required when Account Type=AI. |
  | Connected At | Datetime | Stamped by sync |
  | Last Synced | Datetime | Stamped by sync |
- [ ] Add these new columns to the `Posts` table (will auto-create on first cron run via `typecast: true`, but operator may want to set field types ahead of time):
  - `Pipeline Target` — Single select (`Telegram`, `Publer`)
  - `Publer Job ID` — Single line text
  - `Publer Status` — Single select (`Pending`, `Submitting`, `Submitted`, `Scheduled`, `Published`, `Failed`)
  - `Publer Last Error` — Long text
  - `Publer Media ID` — Single line text (comma-joined for carousels)
  - `Publer Sending Since` — Datetime (for stale-lock recovery)

---

## End-to-end smoke test (when prerequisites are met)

1. **Sync** — visit `/admin/publer`, click "Sync from Publer." Amelia's connected account should appear as a new row.
2. **Map** — set Creator → Amelia, Account Type → AI, AI Consent on File → (TGP record ID or doc link), Status → Active. Click Save.
3. **Queue a test Post** — in Airtable, manually set an existing AI-generated Post's Channel=IG, Creator=Amelia, then POST to `/api/admin/publer/enqueue` with that post's ID:
   ```
   curl -X POST https://app.palm-mgmt.com/api/admin/publer/enqueue \
     -H 'Content-Type: application/json' \
     -H 'cookie: __session=...' \
     -d '{"postIds":["recXXX"]}'
   ```
4. **Wait ≤1 min** for `publer-queue` cron. Post should land at `Publer Status='Submitted'` with a Job ID.
5. **Wait ≤5 min** for `publer-job-poll`. Should flip to `Publer Status='Scheduled'`, `Status='Sent to Publer'`.
6. **Verify in Publer dashboard** — Amelia's account should show a new draft post with the caption + media. Nothing posts to Instagram (draft state).

If step 4 fails: check `Publer Last Error` on the post. Common cases — `MEDIA_OVERSIZE` (reel too big — render smaller), `No Active+AI Publer account for Creator+Channel=IG` (mapping not set), `Publer 403` (API key plan issue), `Publer 401` (wrong auth header — confirm `Bearer-API` hyphen).

If step 5 fails: usually a Publer-side issue. Check the Publer dashboard for whether the draft was created. If yes but our Airtable says Failed, the polling parsed `payload.failures[]` incorrectly — log payload for inspection.

---

## What Phase 3 needs

Per scoping doc §7:
- Flip cron `state: 'draft'` → `'scheduled'` with explicit `scheduled_at`. Single-line change in `app/api/cron/publer-queue/route.js` (`buildEnvelope` literal).
- Schedule jitter (±15-25 min) on each `accounts[].scheduled_at` per §5.5.
- Caption template rotation (8-12 hook templates per persona, draw without replacement).
- Hashtag pool rotation (5-10 named pools per pillar; stay under 5 hashtags per IG's Dec 2025 cap).
- Banned hashtag denylist (#alone, #brain, #pushups currently — quarterly refresh).
- Monitoring dashboard per §3.3 — per-account scheduled/published/failed counts, last failure reason, reach trend, token expiry countdown.
- Slack/email alerts — failed publish, reach drop ≥40%/24h, token expiring <7d.
- Symmetric `Pipeline Target` validator on `telegram/enqueue` (see deviation #3).
- Add carousel per-slide reject UI to `CarouselSubmissionsReview.js` per §6.4.

Plus the Phase 0/3 ops items the scoping doc enumerates (TGP consent agreement check, bio template lock-in, Katie Rosie's account in Phase 4).

---

## Files touched / created

```
NEW  lib/publer.js
NEW  app/api/admin/publer/accounts/route.js
NEW  app/api/admin/publer/sync-accounts/route.js
NEW  app/api/admin/publer/mappings/route.js
NEW  app/api/admin/publer/enqueue/route.js
NEW  app/api/cron/publer-queue/route.js
NEW  app/api/cron/publer-job-poll/route.js
NEW  app/admin/publer/page.js
EDIT vercel.json  (added 2 cron entries)
EDIT app/admin/layout.js  (added Publer sidebar link)
NEW  docs/build-plans/publer-ai-scheduler-phase1-2-handoff.md  (this doc)
```

No tests added. Existing project has no test suite for API routes — same convention applies here. Smoke-test via the manual flow above once prerequisites are in place.
