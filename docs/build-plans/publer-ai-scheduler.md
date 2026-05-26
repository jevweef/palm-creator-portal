# Publer AI Scheduler — Scoping Document

**Status:** Draft, awaiting evan greenlight.
**Author:** research session 2026-05-26.
**Scope:** Build an internal "AI social media manager" feature that auto-schedules AI-generated content into Publer for AI-exclusive Instagram and Facebook accounts. Real-creator content stays on the current Telegram → human-SMM flow for now; this is additive, not a replacement of that path.

---

## 1. Executive summary

We have an in-flight AI editor ("TJP" — The Job Pool) that produces three content types: AI reels (with thumbnails), AI carousels, and AI single images. Today this content would still hit our existing pipeline (approve → grid planner → Telegram → human SMM posts manually). For AI-exclusive accounts, we replace the Telegram-out step with **Publer-out**, server-to-server via Publer's REST API. The grid planner stays. The approval gate stays. The new piece is a `/api/admin/publer/*` route family + a cron worker that drains a "Queued for Publer" status into Publer's scheduling endpoint, mirroring the existing Telegram cron almost 1:1.

**Why Publer wins:** bulk-of-500 scheduling, recycling/recurring/auto-schedule built in, URL-import for media (no multipart uploads from our server), supports IG carousels/reels/stories/single + FB equivalents, has its own UI for the new internal hire to use as a calendar. We stay on Publer; Ayrshare is the only credible swap if we ever go fully headless.

**Why this isn't tiny:** Publer's API only lists/posts — it can't connect Instagram accounts programmatically. Account onboarding is a one-time UI step (Professional via Facebook preferred). The cron worker has to handle async job polling, per-account failures inside otherwise-"complete" jobs, Meta token expiry, and aspect-ratio rejections. Plus the operational playbook for AI accounts (warmup, jitter, originality score) is the difference between a working pipeline and a shadowbanned ghost-town.

---

## 2. Current-state map

### 2.1 AI content generation (already shipped)
- `app/api/admin/ai-gen/route.js` (lines 81–225): Free-form image generation playground — Nano-Banana 2, Wan 2.7, GPT-Image-2 via WaveSpeed. Output lands in Dropbox `/Palm Ops/AI Generations/{date}/`, mirrored to Cloudflare Images, and `Photos` table (Airtable) with `Source Type='AI Generated'`.
- `app/api/admin/carousel-projects/route.js` (lines 18–106): Bulk-creates carousel projects from scraped IG posts. Status='Planning' → admin approval.
- `app/admin/creators/AISuperClonePanel.js` + `app/api/admin/creator-ai-clone/route.js`: per-creator AI clone provisioning.

### 2.2 AI editor UI (TJP)
- `app/ai-editor/page.js` (1242 lines) — three tabs: Workspace (in-flight Stage B projects + batch upload + revision queue), Create Scene (portal-rendered scenes), Carousel (carousel reference library + upload linking).
- Role: `ai_editor` (Clerk metadata) via `requireAdminOrAiEditor()`.
- Workflow: editor picks creator → downloads inspiration reel (triggers `/api/admin/recreate-rooms/stage-b/start`) → does TJP image-to-image work → uploads finished video via `/api/ai-editor/upload/route.js` → creates `Assets` record (`Pipeline Status='In Review'`) + `Tasks` record (`Admin Review Status='Pending Review'`).

### 2.3 Admin approval / post-prep
- `app/api/admin/editor/review/route.js` (lines 12–67): Fetches Tasks with `Status='Done'` + `Admin Review Status='Pending Review'`. Side-by-side reference reel surfaced for AI assets.
- Approval flips Task → Approved, Asset → `Pipeline Status='Approved'`, then a Post record is created (often N siblings — one per managed IG account).
- "Post-ready" = Post record with: Caption, Hashtags, Thumbnail (JPEG), Scheduled Date (opaque ordering token, not human time), Status (`Prepping` → `Sent to Telegram` → `Posted`), Creator, Asset, Task, Platform (array of accounts), Admin Notes.

### 2.4 Grid planner
- `components/GridPlanner.js` — IG profile-grid simulator filtered by creator + account.
- `app/api/admin/grid-planner/route.js` (1–165): Normalizes unsent queue into canonical slots (today 11am + 7pm ET; tomorrow same — 2 slots/day).
- Scheduled Date is used as an ordering token by the Telegram cron; not exposed as a real scheduled time to the SMM.

### 2.5 Telegram send mechanism (the seam)
- `app/api/admin/telegram/enqueue/route.js` (16–44): Bulk-marks Posts `Status='Queued for Telegram'`. Browser enqueues only — no in-request send (avoids 504s).
- `/api/cron/telegram-queue` worker (referenced): every minute, drains 2 posts at a time, calls Telegram Bot API to the creator's `Telegram Thread ID`, stamps `Telegram Sent At`.
- This is exactly the pattern the Publer worker copies.

### 2.6 Auth model
- `admin` / `super_admin` — full access
- `ai_editor` — AI workspace only
- `editor` — real-creator editor queue only
- `social_media` — grid planner + Telegram send

### 2.7 Data layer (Airtable, OPS_BASE `applLIT2t83plMqNx`)
Key tables: `Posts`, `Assets`, `Tasks`, `Photos`, `Carousel Projects`, `Recreate Reels`. Already has the columns we need; we add three new ones (see §4).

---

## 3. Target-state architecture

```
AI Editor (TJP) ─────► Tasks (Pending Review)
                              │
                              ▼
                   Admin Review queue
                              │
                              ▼
                ┌─────────────┴─────────────┐
                │                           │
        Post(creator=real)          Post(creator=AI-persona)
        platform=[real_acct]         platform=[ai_acct_1, ai_acct_2…]
                │                           │
                ▼                           ▼
        Status='Queued for Telegram'  Status='Queued for Publer'   ← NEW
                │                           │
        ┌───────┴───────┐           ┌───────┴───────┐
        │ telegram-queue│           │ publer-queue  │              ← NEW
        │ cron (existing)│          │ cron (new)    │
        └───────┬───────┘           └───────┬───────┘
                ▼                           ▼
        Telegram Bot API            Publer REST API
        → human SMM                 → scheduled on IG/FB
```

### 3.1 The new pieces
1. **Airtable schema additions** (Posts table):
   - `Pipeline Target` (single-select: `Telegram`, `Publer`) — set at Post creation based on creator's persona type
   - `Publer Job ID` (text) — populated when the cron submits to Publer
   - `Publer Account Map` (long text JSON) — Palm account ID → Publer account ID lookup (or store as workspace-level table; see §6 open Q)
   - `Publer Status` (single-select: `Pending`, `Submitted`, `Scheduled`, `Published`, `Failed`)
   - `Publer Last Error` (long text)

2. **New Airtable table: `Publer Accounts`** (recommended over per-creator JSON):
   - Account Name, Platform (IG/FB), Publer Account ID (from `GET /accounts`), Workspace ID, Creator (link), Persona Type (`AI` / `Real`), Connected At, Last Token Refresh, Status (`Active`, `Reauth Required`, `Disabled`)
   - This becomes the SoT for "which Publer account is this AI persona."

3. **New AI persona model in `Palm Creators`** — flag `Is AI Persona` (boolean), `Publer Workspace ID` if multi-workspace.

4. **API routes** (mirroring existing patterns):
   - `POST /api/admin/publer/enqueue` — bulk-mark Posts as `Queued for Publer`. Same shape as the Telegram enqueue.
   - `GET /api/admin/publer/accounts` — proxy `GET /accounts` from Publer, cached 5min, used by admin UI to map persona ↔ Publer account.
   - `POST /api/admin/publer/sync-accounts` — admin-triggered refresh of `Publer Accounts` table from Publer's `/accounts`.
   - `GET /api/cron/publer-queue` — Vercel cron, every minute, drains up to N posts from `Queued for Publer`.
   - `GET /api/cron/publer-job-poll` — Vercel cron, every 5 min, polls `/job_status/{job_id}` for posts in `Submitted` state, updates to `Scheduled` / `Failed`.

5. **Admin UI surface** (small):
   - Persona ↔ Publer-account mapping screen (one-time setup per persona).
   - Add a "Send to Publer" button next to "Send to Telegram" in `app/admin/posts/page.js`, conditioned on creator's `Is AI Persona`.
   - Dashboard row per AI account: scheduled / published / failed / last error / reach trend (see §3.3).

### 3.2 The cron worker contract

```
publer-queue (every minute, drain ≤2):
  posts = Airtable.find(Posts where Status='Queued for Publer' AND Pipeline Target='Publer')
  for each post:
    1. resolve mediaUrl from post.asset.cdnUrl (or Dropbox direct link)
    2. POST /api/v1/media/from-url with media[{url, name}]
        → store returned media_id on post (Publer Media ID column)
    3. build envelope:
        bulk.state = 'scheduled'
        bulk.posts[0].networks.instagram = {
          type, text: caption, media: [{id: media_id, type}],
          firstComment: hashtags,
          details: {type: 'reel'|'story'} if applicable
        }
        bulk.posts[0].accounts = lookupPublerAccountIds(post.platform).map(id => ({
          id,
          scheduled_at: jitter(post.scheduledDate)  // ±15-25min, see §5.5
        }))
    4. POST /api/v1/posts/schedule
        → returns { job_id }
    5. Airtable.update(post, { Publer Job ID, Publer Status='Submitted' })
  if rateLimitHit: requeue, backoff

publer-job-poll (every 5min):
  posts = Airtable.find(Posts where Publer Status='Submitted')
  for each post:
    res = GET /api/v1/job_status/{post.Publer Job ID}
    if res.status === 'complete':
      if res.payload.failures.length === 0:
        Publer Status='Scheduled' (or 'Published' if state was 'publish')
      else:
        Publer Status='Failed'; Publer Last Error = JSON(failures)
    if res.status === 'failed':
      Publer Status='Failed'; Publer Last Error = res.error
```

### 3.3 Monitoring dashboard (operational must-have)
The whole point of replacing the human SMM is that we have to *see* what they used to see. Per AI account: scheduled (next 7d), published (last 7d), failed (last 7d) + last-failure reason, reach 7d vs trailing-28d baseline (engagement-rate trend optional, can pull from Publer analytics), follower delta, token-expiry countdown. System-level: Publer API rate-limit headroom, per-persona content backlog (days of approved content remaining), approval queue age. Alerts (Slack/email): failed publish, reach drop ≥40% in 24h, token expiring in <7d, approval queue >24h old.

---

## 4. Publer integration playbook (the specifics that matter)

### 4.1 Media — use URL import, not multipart
`POST /api/v1/media/from-url` body:
```json
{ "type": "single", "direct_upload": false, "in_library": true,
  "media": [{ "url": "https://cdn.palm.../asset.mp4", "name": "post-123-reel" }] }
```
We host on Cloudflare Images / Dropbox direct link → Publer fetches it. Saves us from streaming 1GB reels through our serverless functions. Max sizes Publer enforces: 200MB direct, network caps follow Meta (IG Reels ≤1GB, FB Reels ≤2GB). Validate aspect ratio + duration *before* upload — IG rejects 9:16-violating Reels server-side and the failure surfaces as a per-account failure in the job payload.

### 4.2 Async pattern — always
Every POST to `/posts/schedule` returns `{ job_id }` immediately. Polling is the only signaling channel (Publer has no public webhooks despite some third-party docs claiming otherwise). Recommended: 2–5s start, exponential backoff, 60s ceiling. `status: 'complete'` does **not** mean all accounts succeeded — always parse `payload.failures[]`.

### 4.3 State choices for our use case
- `scheduled` with explicit `scheduled_at` — our default for grid-planner-driven posts.
- `scheduled` + `auto: true` + `range.start_date`/`end_date` — use sparingly for evergreen filler content; algorithm is opaque.
- `recurring` — use for "Motivation Monday"-style fixed-cadence content per persona. **Not allowed in bulk** — one-at-a-time.
- `scheduled` + `recycling` — for hand-picked evergreen pool with `expire_count` (never omit, or it runs forever).
- `draft` — staging for admin double-check before going live.

### 4.4 Per-network field cheatsheet
| Field | IG | FB |
|---|---|---|
| Caption limit | 2,200 | 10,000 |
| Carousel | ≤10 slides | ≤10 slides (link carousels too) |
| Reel | type=video + details.type=reel + details.feed=true to share to grid | type=reel, 3–90s |
| Story | type=video/photo + details.type=story (Business acct only, single media via API) | type=story (single media) |
| First comment for hashtags | `comments[]` per account | not idiomatic |
| Location / user / product tags | not supported via API | not supported via API |
| Reel cover | `default_thumbnail` (frame index) — no timestamp; pre-render custom cover for grid coherence | same |

### 4.5 Cross-posting one post to multiple accounts
One request, multiple `accounts[]` entries on the same post object. Each account gets its own `scheduled_at` → critical for **anti-duplicate-detection jitter** (see §5.5). Combined with bulk-of-500, one POST handles a month of multi-persona content.

### 4.6 Failure modes to defensively handle
1. **Per-account failure in a "complete" job** — most common. Parse `payload.failures[]` even on success.
2. **Meta token expiry** — surfaces as a per-account failure with provider message. Reauth is manual in Publer UI. Surface as `Reauth Required` on the `Publer Accounts` row and alert.
3. **Reel rejected for spec violation** — 9:16, 3s–15min, audio: IG-in-app licensed music is *never* API-publishable. Validate at render time.
4. **Carousel rejection** — mixed media types or one slide failing 320×320 / 8MB. Validate every slide pre-submit.
5. **"Draft created but never published"** — happens when `state` defaults silently. Always assert returned `state` matches what we sent.
6. **Notifications are email-only** from Publer — until/unless we ship webhooks, email forwarding to a Slack channel is the cheap monitoring fallback.

### 4.7 Pricing reality (May 2026)
Business: ~$8/mo annual or $10/mo monthly billing for 1 account + 1 user. Each extra account ~$5.60–7/mo; extra seat ~$2.40–3/mo. **API access requires Business in good standing.** For 10 AI personas × 2 networks = 20 accounts ≈ $128/mo before seats. Enterprise is custom-quote, mostly worth it for negotiated higher rate limits or SLA. **Start on Business**, upgrade only if we hit the 100 req/2min ceiling (we won't at this scale).

---

## 5. AI-content operational playbook

### 5.1 Meta AI-content policy (May 2026)
Self-disclose on upload (Publer exposes the "AI-generated content" toggle). Reach penalty for the *label* alone is modest (15–25% for non-photorealistic). Reach penalty for *being detected after not disclosing* is severe (60–80% for deepfake-style face/body manipulation) and retroactive. **Rule: always disclose.** [Meta Transparency Center — Labeling AI Content](https://transparency.meta.com/governance/tracking-impact/labeling-ai-content/)

### 5.2 FTC disclosure (May 2026 update)
For personas that function as influencers: two-part disclosure required when sponsored — (a) persona is AI, (b) any sponsorship — "clear, close to claim, instantly understandable." Non-sponsored: clear bio-level disclosure ("AI character") is reputational floor. State overlays live (CA AB 3211, NY synthetic-performer law, TN ELVIS Act). Brand-creator liability waivers don't bind FTC.

### 5.3 Account hygiene
- **One Business Portfolio per "brand cohort."** Don't mix AI personas with real creators in the same BM — one ToS strike cascades.
- **Server-side publishing via Publer API is the safe architecture** — our Vercel servers' IPs never log into Meta's UI, so device fingerprinting is moot. Critical: never log into AI account dashboards from the same machine that has real-creator accounts open. If a human ever has to touch the AI account UI, use a dedicated browser profile.

### 5.4 Posting cadence
- **Warmup (days 1–30):** Days 1–3 no posting, just browse/like. Days 4–7: 1 post/day + light Stories. Days 8–21: 1/day + 2–3 Stories. Days 22–30: 1–2/day. **Stories from day 4** — accounts with zero Stories read as inactive in 2026's trust score. No links, no offers, no aggressive hashtags during warmup.
- **Steady state (90+ days):** 1 feed/day or 5–6/week ceiling. 2–5 Stories/day.
- **Format mix:** **~50% Reels** (reach driver, 2.25× single-image reach), **~35% carousels** (engagement driver, 1.92% ER vs reels 0.50%, static 0.45%), **~10–15% single image** (grid aesthetic only), **Stories daily for trust score**.
- **Best windows:** Wed/Thu 9am–noon and 6–9pm; Tue mornings. Avoid Fri/Sat.

### 5.5 Anti-pattern hygiene (build into the cron)
- **Jitter every `scheduled_at` by ±15–25min** — never :00/:15/:30/:45 exactly. Build into the worker, not just into grid planner.
- **Caption template rotation** — 8–12 hook templates per persona, draw without replacement.
- **Hashtag pools** — 5–10 named pools per pillar, rotate. **Stay under 5 hashtags** (IG capped from 30 in Dec 2025).
- **Never repost** — 2026 Originality Score swaps your post for the original in recs.
- **Banned hashtag list** — currently includes #alone, #brain, #pushups. Maintain a denylist; refresh quarterly.

### 5.6 Reels-specific (matters most for our pipeline)
- **Custom cover always.** Auto-frame thumbnails land on transitions/blurs. Render 1080×1920 PNG at the AI generation step, store alongside the reel asset.
- **Duration:** 30–90s for engagement, 7–15s for discovery; retention beats length. 10s @ 80% retention > 60s @ 30%.
- **Audio:** **Use original audio / voiceovers** — automated pipelines can't pick trending music in real time, and IG's Originality Score penalizes recycled audio anyway. If we want trending sounds, ingest daily trending-sounds feed and have a human pick per persona.
- **Captions:** first 125 chars are all most viewers see. Short (30–90) for discovery; medium (100–220) for framing.

### 5.7 Carousels
- **8–10 slides** is the winner — engagement curves dip slide 3, recover slide 8+. Design for "stop ≤3 or commit to 8+."
- **Slide 1 is a hook, not a design** — specific number, contrarian claim, framing question.
- **Add music** (since 2024 feature) — pushes carousels into Reels feed for extra reach.
- Per-slide captions are decorative; IG only indexes the main caption.

### 5.8 Stories
Publer can auto-publish via Meta Graph API but: **Business accounts only**, **one media item per auto-publish**, no stickers/links/polls/mentions via API (must add in-app), no insights via API, no story sync-back. Worth automating **one daily story per persona for trust-score purposes** — don't over-invest the pipeline in story richness; the API ceiling is too low.

### 5.9 Human-in-the-loop gates worth keeping
Keep humans on the **publish gate** only — automate everything upstream:
1. **Face/identity check** for any photorealistic persona frame (deepfake suppression risk = worst on the platform).
2. **Caption first-line + CTA approval.**
3. **Thumbnail approval for Reels** (grid-level coherence, easy to batch).
4. **Any post mentioning a real person/brand/event.**

Target: 5-minute morning queue per persona, batched. **Skip approval on Stories** — low blast radius, ephemeral; let automation run hot there.

---

## 6. Open questions for evan (need answers before build)

1. **Publer workspace topology.** One workspace for all AI personas, or workspace-per-persona? One workspace means one API key, one rate-limit pool, simpler. Workspace-per-persona means cleaner billing/audit if we ever sell a persona to a client.
2. **AI persona creator records.** Do AI personas get rows in `Palm Creators` (with a new `Is AI Persona` flag), or a new `AI Personas` table? Sharing the table means the grid planner / post pipeline "just works"; a new table means the schema stays clean. Recommendation: extend `Palm Creators` — less plumbing.
3. **Media URL longevity.** Publer pulls media from URL once via `/media/from-url`. Cloudflare Images URLs are stable. Dropbox shared links can expire. For reels >200MB that won't fit Publer's direct upload cap, we need Cloudflare R2 or a refreshing Dropbox link. Which?
4. **Approval-pipeline shortcut for AI?** Currently every post passes through `Tasks` → admin review. For AI content, do we keep that gate or short-circuit (admin approves the *batch* in the AI editor, not each Post)? Recommendation: keep individual review for now; tighten later once we trust the AI editor's hit rate.
5. **Telegram vs Publer per Post.** Is `Pipeline Target` exclusive (Telegram XOR Publer) or can a Post go both ways? Recommendation: exclusive — derived from creator's `Is AI Persona` flag. Avoids accidental double-posting.
6. **Failure routing.** When a Publer post fails, does it route back to the AI editor's revision queue (like real-creator rejects) or to admin only? Different fail modes (token expiry vs caption violation vs aspect-ratio reject) deserve different handlers.
7. **First persona launch plan.** Are we launching 1 persona (warmup, measure, iterate) or N? Strongly recommend **1 first** — debug the pipeline against one persona's Publer account before fanning out. Picks up most operational bugs at lowest cost.

---

## 7. Phased rollout

### Phase 0 — Account prep (manual, evan + ops)
- [ ] Decide workspace topology (Q1 above).
- [ ] Create 1st AI persona IG account (Creator/Business), linked FB Page.
- [ ] In Publer dashboard: connect via "Professional (via Facebook)." Set workspace to **Owner's API** mode.
- [ ] Generate Publer API key + workspace ID. Drop in env: `PUBLER_API_KEY`, `PUBLER_WORKSPACE_ID`.
- [ ] Add `Is AI Persona` to `Palm Creators`. Create `Publer Accounts` table.

### Phase 1 — Read-side integration
- [ ] `GET /api/admin/publer/accounts` proxy + cache.
- [ ] `POST /api/admin/publer/sync-accounts` — populate `Publer Accounts` from Publer.
- [ ] Admin UI: persona ↔ Publer account mapping screen.
- [ ] Verify auth headers, rate-limit handling, basic error surface.

### Phase 2 — Write-side, draft-only
- [ ] Add `Pipeline Target`, `Publer Job ID`, `Publer Status`, `Publer Last Error` to `Posts` table.
- [ ] `POST /api/admin/publer/enqueue` — bulk-mark posts.
- [ ] `publer-queue` cron — drain queue, submit as `state: 'draft'` first. Logs job IDs. No real posting yet.
- [ ] `publer-job-poll` cron — polls job status, writes back to Airtable.
- [ ] Verify the round-trip: enqueue → draft appears in Publer dashboard → status updates in Airtable.

### Phase 3 — Live scheduling, 1 persona
- [ ] Flip cron to `state: 'scheduled'` with `scheduled_at`.
- [ ] Build jitter (`±15-25min`) + caption-template rotation + hashtag pool rotation.
- [ ] Wire up monitoring dashboard (scheduled / published / failed / reach trend).
- [ ] Run for 30 days on 1 persona. Track failures, fix the worst three.

### Phase 4 — Fanout + stories
- [ ] Add 2nd–Nth AI persona.
- [ ] Add story automation (1/day/persona).
- [ ] Tune cadence based on per-persona reach data.

### Phase 5 — Move grid planner UI to drive Publer for AI personas
- [ ] (Eventually, as user mentioned.) Grid planner becomes the primary UI surface for AI Posts, and the new internal hire uses it daily.

---

## 8. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Mixing AI + real content on same account | High (account ban) | `Is AI Persona` flag is the gate; cross-check at enqueue time |
| Token expiry breaking the entire pipeline silently | High | Daily token-age check, alert at T-7 days |
| Publer changing API without warning | Medium | Pin to documented endpoints; nightly contract test against `/accounts` |
| AI reel rejected en masse for aspect ratio | Medium | Validate 9:16 + duration at render, not upload |
| Hashtag denylist drift | Low | Quarterly refresh, fail loud if a banned tag is used |
| One-workspace-rate-limit pool exhausted at scale | Low (at our scale) | If hit, move to per-persona workspaces |
| Dropbox shared link expiry mid-pipeline | Low | Use Cloudflare Images URLs as canonical for Publer |
| 2026 Originality Score penalizing identical reuploads | Medium | Caption + hashtag + jitter rotation built into cron |

---

## 9. Notes the session captured but didn't deserve a section

- Publer's "Owner's API vs Member's API" is a workspace-permission setting, not a separate API surface. We use **Owner's API** mode for centralized control.
- "Professional (via Facebook)" connection path is preferred over "via Instagram" for agency-managed AI accounts — broader feature set, more mature reauth UX, and our AI personas will have FB Pages anyway since we want both networks.
- Publer's docs claim auto-schedule timing is per-account learned, not workspace-level. We don't depend on it for hero launches.
- No public webhooks. Polling is the only signaling. Email-only failure notifications from Publer until that changes.
- Ayrshare is the only credible swap if we ever want a fully-headless social API. Stay on Publer.

---

## 10. What's needed from evan to greenlight

1. Answers to §6 questions 1–7 (or "your call, pick the recommendation").
2. Confirmation that Phase 0 is in your court (account creation, Publer plan upgrade, API key gen).
3. Greenlight to start Phase 1 build.

I'll wait for that before touching code.
