# Audit B — Warm-Up, Content Strategy, Amin Bridge, Publer End-State

**Auditor:** B (independent of Auditor A)
**Date:** 2026-05-27
**Scope:** Four dimensions of the SMM consolidation — warm-up flow, content strategy engine, Amin manual-post bridge, Publer Phase 3 gaps.

---

## Executive Summary

There is **zero warm-up scaffolding in the codebase today** — the 90-day playbook exists as a markdown doc with no Airtable table, no UI, no day-counter, no per-account task surface. Three AI accounts are about to enter Day 1 and the operator has nothing structured to lean on. Likewise, **no "content strategy engine" exists** — the operator currently scrolls the AI Recreate Pool (in `app/ai-editor/page.js`) manually to pick the next reel; `Recreate Reels`, `Carousel Projects`, `Inspiration`, and `Photos` are all rich but uncoordinated, with no pillar/category metadata and no per-creator calendar. The **Amin Telegram bridge works for real-creator accounts only** — `telegram-queue` resolves `Telegram IG/FB Topic ID` off `Palm Creators`, but the three new AI accounts are `Publer Accounts` rows, not `Palm Creators`, so Amin literally cannot be sent a warm-up post today. Recommended path: one new **`Warmup Tasks`** Airtable table instantiated from a template on account creation, three new fields on `Publer Accounts` (Account Created Date, Warmup Status, Warmup Telegram Topic ID), and a new **Today's Tasks** page that becomes the operator's home view for warm-up days.

---

## A. Warm-Up Flow

### A1. Operator questions this must answer

Per the owner brief, the system must answer ten questions per day per warming-up account:

1. **Where do I store account credentials** (IG handle, IG password, FB Profile under which login, Gmail address, Gmail password, recovery email/phone, Beacons login, Mint SIM number, GrapheneOS profile name, Pixel device label)?
2. **How do I mark "account created"** (sets Day 0, starts the counter)?
3. **Today's bio step** — what should the bio currently say? Has the operator updated it to today's target string?
4. **Today's profile-picture step** — is a profile picture set yet? Day 1 says yes; if missing, flag.
5. **Today's engagement quota** — likes, comments, follows, stories watched, time-on-app. Per the playbook this varies: Days 1-7 = 5-8 likes / 8-10 stories / ≤5 follows / 0 comments; Days 8-14 = 10-15 likes / 1-2 comments / 3-5 follows; Days 15-21 = 15-25 likes / 3-5 comments / 5-10 follows.
6. **When do I add the link-in-bio** (Beacons URL) — Day 10 per playbook. System should pop a one-shot reminder card.
7. **Today's posting cadence** — how many posts and what type? Days 1-7 = 1-2 lifestyle total, no AI yet, daily stories from Day 4. Days 8-14 = 2-3 posts, first AI-of-creator content lands Day 8. Days 15-30 = 3-4 posts/week, mix reels + feed.
8. **Today's specific posts** — which clip/photo/carousel to post, with caption and hashtag set and AI label checkbox. Operator should be able to mark each one "sent to Amin" or "posted" with one click.
9. **When do I hook Publer in** — Day 21 (FB Additional Profile + Page + Business Portfolio + IG link via Account Center), Day 23 (authorize Publer), Day 25 (begin Publer scheduling). System should surface these as discrete tasks with a checkbox to flip the account from "Warmup, Telegram path" to "Active, Publer path."
10. **When do I add OF CTA to Beacons** — Day 45. Day 60 = bio swap to softer monetization language. Day 75-90 = evaluate moving to Reels-primary cadence.

### A2. What exists today

Nothing. Confirmed via:
- Grep for `warmup`, `warm-up`, `warm_up`, `Warm Up`, `WarmUp` across `/app`, `/lib` — zero matches.
- `app/admin/onboarding/` is creator-KYC onboarding (signed agreements, contracts), not account warm-up.
- The 90-day playbook lives only in `docs/build-plans/publer-ai-account-creation-playbook.md` — not exposed to the operator UI in any form.
- `Publer Accounts` (`tblGDhVY73UT2gLSW`) has Account Name, Channel, Publer Account ID, Publer Provider, Publer Picture, Creator (link), Account Type (Real/AI), Status (Active/Reauth Required/Disabled), AI Consent on File, Connected At, Last Synced. **No Account Created Date. No Warmup Status. No day counter. No Bio text. No credentials.**

The system literally cannot answer "what day is Brielle on?" because there's no Account Created Date field on her `Publer Accounts` row.

### A3. Proposed Airtable schema

**Two new tables + three new fields on `Publer Accounts`.** All additive per the hard constraint in `00-research-scope.md`.

#### A3.1 New table: `AI Account Profile` (`tblAIAcctProfile` — Airtable will assign the real ID)

One row per AI account, sibling to `Publer Accounts`. Reason for not piling all of this onto `Publer Accounts`: Publer Accounts is synced from Publer (sync route rewrites several fields) and adding 20 manual-only fields there makes the sync logic brittle. Profile is operator-curated, never touched by sync.

| Field | Type | Notes |
|---|---|---|
| Account Handle | Single line text | e.g. `briel.ai` — primary key for lookup |
| Persona Name | Single line text | e.g. `Brielle` — display name |
| Linked Real Creator | Link → Palm Creators | Single — `Amelia`, `Gracie`, or empty for standalone |
| Linked Publer Account (IG) | Link → Publer Accounts | Single — populated Day 23 once Publer is connected |
| Linked Publer Account (FB) | Link → Publer Accounts | Single — populated Day 23 |
| Account Type | Single select: `AI` only | Sanity column for views; mirrors Publer Accounts.Account Type |
| Account Created Date | Date | The Day 0 anchor. Sets the day counter. Stays null until operator marks "Account Created" — pre-creation accounts show as Day −7 etc using a separate Hardware Prep Started Date if needed |
| Hardware Prep Started Date | Date | Optional, for Day −7 through Day 0 pre-launch |
| Days Paused | Number | Defaults 0. Incremented when a flag/incident pauses the warmup; subtracted from elapsed-days calc |
| Warmup Status | Single select | `Hardware Prep` / `Active Warmup` / `Paused — Flagged` / `Paused — Operator` / `Warmup Complete` / `Live` / `Retired` |
| Bio (Current) | Long text | What the bio actually says right now. Free text. Operator updates as they edit it on the phone |
| Bio (Target for Today) | Formula → Long text | Driven by day counter + WarmupBioTemplates lookup. Not strictly necessary — could live in the Warmup Tasks row instead. Optional |
| IG Handle | Single line text | e.g. `briel.ai` |
| IG Password (encrypted ref) | Single line text | NOT raw — store a Bitwarden/1Password ref ID. Owner's call: see Open Questions |
| FB Profile Name | Single line text | Which Additional Profile under the agency FB account |
| Gmail Address | Single line text | e.g. `amelia.briel.creator@gmail.com` |
| Gmail Password (encrypted ref) | Single line text | Same as IG — vault ref |
| Recovery Email | Single line text | |
| Recovery Phone | Single line text | The Mint SIM number |
| Mint SIM (Provider/Plan) | Single line text | "Mint $15 5GB" |
| Pixel Device Label | Single line text | "Pixel 8a #1" — physical device label, helps when running multiple Pixels |
| GrapheneOS Profile Name | Single line text | "Amelia profile" |
| Beacons URL | URL | https://beacons.ai/briel.ai |
| TGP Consent Record ID | Single line text | The same value that goes into `Publer Accounts.AI Consent on File` |
| Notes | Long text | Freeform operator notes (incidents, flags, anomalies) |
| Created At | Created time | Auto |

**On credentials:** the right answer is store a vault reference, not the password. Airtable is not a secrets manager. Recommend Bitwarden Family ($40/yr) or 1Password Team ($8/mo per user) — owner already operates at agency scale. The Airtable field becomes a Bitwarden item URL or 1Password URL; clicking it opens the vault. See Open Question 1.

#### A3.2 New table: `Warmup Tasks` (`tblWarmupTasks`)

One row per (Account × Day × Task). For Brielle alone, 90 days × ~5-8 tasks/day = ~600 rows. Three accounts → ~1800 rows on instantiation. Airtable trial supports 50k rows on Business, fine.

| Field | Type | Notes |
|---|---|---|
| Task Name | Single line text | e.g. "Day 10 — Add Beacons link to IG bio" |
| AI Account | Link → AI Account Profile | Single, required |
| Day Number | Number | 1-90 (or −7 to 0 for hardware prep). Drives sorting |
| Task Type | Single select | `Hardware` / `Account Setup` / `Bio Update` / `Profile Pic` / `Engagement` / `Post` / `Story` / `Reminder` / `Publer Setup` / `Beacons` / `Monetization` / `Hygiene Check` |
| Posting Channel | Single select | `IG` / `FB` / `Both` / `—` (blank for non-posting tasks) |
| Window Start | Single line text or datetime | e.g. "13:00 ET" or "2026-06-05T17:00:00Z" — when the task should be done. For posts, the post-window |
| Window End | Single line text or datetime | "15:00 ET" — gives Amin a 2-hour window to post |
| Quota Target | Number | e.g. 15 (likes), 5 (follows), 1 (post). Optional |
| Quota Actual | Number | What the operator did. Optional |
| Task Detail | Long text | The how. For Bio Update: the target bio string. For Engagement: "Like 15 posts on fashion/lifestyle accounts you already follow. 2 thoughtful comments." For Post: link or rec ID of the asset to post |
| Linked Asset | Link → Assets | For Post tasks — which clip/photo to send to Amin |
| Linked Carousel Project | Link → Carousel Projects | For Post tasks of type Carousel |
| Caption (Suggested) | Long text | Pre-generated caption for this post task |
| Hashtags (Suggested) | Long text | Pre-generated hashtag pool |
| Status | Single select | `Pending` / `In Progress` / `Done` / `Skipped` / `Failed` / `Sent to Amin` |
| Completed At | Datetime | Auto-stamped on Status → Done |
| Completed By | Single line text | Clerk userId / email |
| Operator Notes | Long text | Per-task freeform |
| Telegram Sent At | Datetime | If task = Post and operator pushed to Amin via Telegram, stamped by the new warmup-telegram-enqueue route |
| Telegram Message ID | Single line text | For receipt/tracing |
| Amin Confirmed | Checkbox | Set manually if Amin confirms back, OR auto-set via a `/posted` reply hook (future) |
| Created At | Created time | Auto |

**Why one table per (account × day × task) rather than per (account × day) with a checklist field:** lets each task have its own asset link, caption, status, and per-task notes. A "Day 10" row with a JSON blob of tasks would force every UI write to be a read-modify-write on long-text JSON. Real fields are cheaper to read, write, filter, group, and report on.

#### A3.3 New table: `Warmup Playbook Templates` (`tblWarmupTemplates`)

One row per (Day × Task Type) — the canonical 90-day playbook in structured form. ~150-200 rows total. Used to instantiate `Warmup Tasks` rows when a new account is marked Created.

| Field | Type | Notes |
|---|---|---|
| Template Name | Single line text | "Day 1 — Lifestyle Post #1" |
| Day Number | Number | -7 to 90 |
| Task Type | Single select | Same options as Warmup Tasks |
| Task Detail | Long text | The how, with `{persona}`, `{real_handle}`, `{beacons_url}` template variables |
| Posting Channel | Single select | IG / FB / Both / — |
| Window Start | Single line text | "13:00 ET" — wall-clock target |
| Window End | Single line text | "15:00 ET" |
| Quota Target | Number | Default for that day |
| Bio Target | Long text | If this is a Bio Update task, the target bio string with `{real_handle}` and `{persona}` placeholders |
| Active | Checkbox | Owner can toggle a template row off without deleting (e.g. Day 7 twin account — skip for now) |

Owner edits this table once; new accounts get the latest playbook on instantiation.

#### A3.4 Three new fields on existing `Publer Accounts` (`tblGDhVY73UT2gLSW`)

| Field | Type | Notes |
|---|---|---|
| Warmup Telegram Topic ID | Single line text | The Telegram forum topic ID inside the SMM master group where Amin receives warm-up posts FOR THIS ACCOUNT. Created on account setup via `createSmmTopicForHandle` (lib/telegramTopics.js already exists). Distinct from `Palm Creators.Telegram IG/FB Topic ID` which is for the real-creator account |
| AI Account Profile | Link → AI Account Profile | Backlink, single |
| Warmup Day (Formula) | Formula | `IF({AI Account Profile}, {Days Since Created} - {Days Paused}, BLANK())` — exposes the day counter directly on Publer Accounts for quick scanning |

These three are pure-additive; no rename of existing fields.

### A4. Proposed UI surface

**Three pages.** All gated by `requireAdmin` or `requireAdminOrSocialMedia` (the role evan said will eventually take over warmup). All live under the new Social Media Management parent in the sidebar.

#### A4.1 `/admin/smm/warmup` — Today's Tasks (the home view)

**Default landing page when the operator opens the SMM section during warmup era.** This IS the zero-mental-load surface.

Layout: vertical list grouped by AI Account. Each account is a collapsible card showing:
- **Header row**: persona name, handle, current Warmup Day (`Day 12 / 90`), Warmup Status badge, "View Full Profile →" link.
- **Today's tasks**: list of `Warmup Tasks` where `AI Account = thisAccount AND Day Number = today's day AND Status != Done`. Sorted by Window Start. Each row shows task name, channel, window time, status pill, and a primary action button:
  - Engagement task: "Mark Done" + optional quota actual input.
  - Bio update task: shows the current bio (from `AI Account Profile.Bio (Current)`) and the target bio side by side, with "Mark bio updated" button (auto-copies the target bio into the Current bio field).
  - Profile pic task: simple "Profile pic set?" checkbox.
  - Post task: thumbnail preview of `Linked Asset`, caption, hashtags, "Send to Amin" button (POSTs to new `/api/admin/warmup/send-to-amin` route). After send, shows "Sent to Amin — awaiting post" with timestamp.
  - Publer Setup task (Day 21/23/25): step-by-step checklist with deep links to relevant Publer UI.
- **Yesterday's incomplete**: a smaller block below today's tasks showing anything still Pending from prior days, so nothing falls through cracks.

This is the only page evan opens daily. He sees three account cards, runs through today's tasks, done.

#### A4.2 `/admin/smm/warmup/[accountId]` — Per-Account Full View

Five tabs in a tab strip:
1. **Today** — same as A4.1 but filtered to this one account.
2. **Schedule** — all 90 days as an accordion. Today highlighted. Past days collapsed (with completion %). Future days expandable for "what's coming." Lets the operator look ahead.
3. **Credentials & Profile** — read-only display of all `AI Account Profile` fields. Edit-in-place for vault refs, bio current, notes. Deep link to Bitwarden/1Password for each credential.
4. **History / Audit log** — every task ever completed on this account, with timestamp and operator. Just `Warmup Tasks` filtered by account, sorted desc.
5. **Incidents** — flagged events. New surface; uses `Warmup Status` flips + `Notes` to render a timeline. For warmup completion, also shows when Publer was activated.

#### A4.3 `/admin/smm/warmup/template` — Playbook Editor (owner-only)

`requireAdmin` gated. CRUD on `Warmup Playbook Templates`. Owner toggles tasks on/off, edits the Day 30 caption template, etc. Changes ONLY affect newly-created accounts (we instantiate at creation, not at runtime — see A6).

### A5. Day-counter logic

Server-side formula. Reusable as either an Airtable formula field or a JS helper called by the Today page:

```
warmupDay = floor(
  (today_in_ET_midnight - account_created_date_in_ET_midnight) / 1 day
) - days_paused
```

`Account Created Date` is the anchor. Day-1 = the day operator marked the account created. Pre-Day-1 = negative numbers (Day -3, -2, -1) used for Hardware Prep tasks. `Days Paused` is a manual counter — when the operator flags an incident and pauses warmup for 48-72h (per the playbook's shadowban-fix path), they bump `Days Paused` by 2 or 3 when resuming.

Edge cases:
- Daylight Saving: use ET-midnight floor, not UTC-midnight. The playbook is tracked in operator-local terms.
- Account created late in the day (e.g. 11pm ET): the playbook treats Day 1 as the calendar day of creation, not 24-hours-after. So a creation at 11pm ET counts as Day 1 immediately, and the operator only has 1 hour of "Day 1" — fine, Day 1 is mostly just account creation itself.
- Status = `Paused — Operator` or `Paused — Flagged`: the Today view shows "Warmup paused — Day frozen at N" and doesn't render any tasks. Operator can resume manually.

Implement as a small helper in `lib/warmupSchedule.js`:

```
export function getWarmupDay(accountProfile, now = new Date()) { ... }
export function getTodaysTasks(accountId, day) { ... }
```

### A6. Playbook template → per-account task instantiation

**Recommendation: instantiate all 90 days at Account Created time, with template references for late-bound content.**

When operator clicks "Mark Account Created" on `/admin/smm/warmup/[accountId]`:
1. Server reads every Active row from `Warmup Playbook Templates`.
2. For each template row, creates a `Warmup Tasks` row with:
   - `AI Account` = this account
   - `Day Number`, `Task Type`, `Posting Channel`, `Window Start/End`, `Quota Target` — copied verbatim
   - `Task Detail`, `Bio Target` — string-substituted (`{persona}` → `Brielle`, `{real_handle}` → `amelia`, `{beacons_url}` → from AI Account Profile)
   - `Status` = `Pending`
   - `Linked Asset`, `Caption`, `Hashtags` left null — filled in later by the Content Strategy Engine (see Section B) when the day approaches
3. Account Profile `Account Created Date` = today, `Warmup Status` = `Active Warmup`.

**Why instantiate all 90 days up front rather than lazily:**
- Operator can scroll the Schedule tab and see what's coming next week. Lazy instantiation = "today exists, tomorrow is a question mark."
- If owner edits the template later, those edits only land in newly-created accounts — existing in-flight accounts keep their playbook frozen, which is correct. Mid-warmup playbook changes would be operationally chaotic.
- Cost is negligible. 200 records per account, three accounts = 600 records. Airtable Business can swallow 50k rows. We can rebuild from template if needed (delete + reinstantiate).

**For posts specifically:** the Linked Asset is filled in by the content strategy engine ~24h before the task fires (Section B7). The post task row exists from Day 1 but it doesn't know WHICH asset until the engine picks one. This separation matters because asset availability changes — we don't want to lock in Day 67's reel on Day 1.

### A7. Pause / extend / retire flows

**Pause:** Operator opens the account's Profile tab, clicks "Pause Warmup" with a dropdown reason (`Flagged` / `Operator hold` / `Hardware issue`). Sets `Warmup Status` accordingly. Today's view shows the pause banner with a `[Resume]` button. While paused, the day counter is held — the `Days Paused` field is incremented when they resume, by `today - pause_start`.

**Extend:** Just continue posting. No "Day 91" — once Warmup Status flips to `Live` (manual operator action around Day 90), the account graduates out of the Warmup table entirely. Their tasks just stop showing up on the Today view because `Warmup Status != Active Warmup` filters them out.

**Retire / abandon:** Operator sets `Warmup Status` = `Retired`. Per the playbook's recovery section, day-7 suspension without successful appeal → abandon and start fresh. A new `AI Account Profile` row is created with a new handle; the old row is preserved for audit. Linked `Warmup Tasks` rows are NOT deleted (audit trail) but stop appearing in Today via the status filter.

**Hardware prep:** Days −7 to 0 are real template rows with negative day numbers. `Hardware Prep Started Date` triggers their visibility (separately from Account Created Date). Once operator marks Account Created, the negative-day tasks should already be `Done` or move automatically to `Skipped`. Recommend a soft enforcement: a pre-flight check on "Mark Account Created" that confirms all `Day Number < 0` tasks are `Done` or explicitly skipped.

---

## B. Content Strategy Engine

### B1. Content library inventory

Six libraries scoped to "stuff that can become a post." Confirmed from the codebase:

| Library | Airtable Table | Table ID | What's in it | Key Fields |
|---|---|---|---|---|
| **Recreate Reels** | `Recreate Reels` | `tblgKIecr9rdn8M60` | Scraped IG reels from competitor handles, downloaded to Dropbox, used as inspo for TJP recreations. ~100s-1000s of records | Reel ID, Source Handle, Reel URL, Caption, Dropbox Video Path, Dropbox Video Link, Stream UID, Status (Available / Ready / Error), Posted At, Views, Produced For (link → Palm Creators), Added Via (Admin Scrape / Editor Upload), Source (link → Recreate Sources) |
| **Recreate Sources** | `Recreate Sources` | unknown | Handles being scraped for inspo | Handle, Status, Max Reels, Reels Found, Reels Stored, Last Scraped, Error |
| **Inspiration** | `Inspiration` | `tblnQhATaMtpoYErb` | Curated inspo board entries — admin-vetted reels to inspire content | Title, Username, On-Screen Text, Thumbnail, Notes, Status (Complete), Views, Reel Embedding, Semantic Scores (per-creator) |
| **Inspo Sources** | `Inspo Sources` | unknown | Handles seeding Inspiration | Handle, Status |
| **Carousel Projects** | `Carousel Projects` | `tblU1yON9P7zQljYM` | Carousel concepts pulled from competitor IG carousels — Status: Planning / Submitted / Approved / Rejected / Archived | Project Name, Source Post URL, Source Handle, Source Photos (link → Photos), Creator (link), Status, Submission Batch ID, Uploaded Photos, Notes |
| **Photos** | `Photos` | `tblUXDbaZGYGf2E5O` | Photo-type Assets, including AI-generated singles (Source Type = "AI Generated") and carousel slides | Source Handle, Carousel Index, Source Type, CDN URL, Image, Dropbox Link |
| **Assets** | `Assets` | `tblAPl8Pi5v1qmMNM` | The canonical "finished AI content ready to post" — video reels, photo singles, carousel slide sets | Asset Name, Asset Type, Pipeline Status (In Review / Approved / Posted), CDN URL, Edited File Link, Compressed File Link, Dropbox Shared Link, Approved Thumbnail (checkbox), Palm Creators (link), Thumbnail |
| **Tasks** | `Tasks` | `tblXMh2UznOJMgxl6` | The post-by-post review workflow shell | Status (Done), Admin Review Status (Pending Review / Approved), linked Asset, Revision History |

### B2. Existing metadata

**There are essentially no content-strategy tags.** Confirmed via grep for "Pillar", "Content Pillar", "Category" across `/app/api/admin/` and `/lib/`:
- `Inbox/chats.Category` — labels for support tickets, not posts.
- `Photos.Source Type` — `AI Generated` / `Real` distinction only.
- `Assets.Pipeline Status` — workflow state, not theme.
- `Carousel Projects.Source Handle` — provenance, not theme.

**There is NO content pillar field. There is NO content category. There is NO "Theme" tag.** Today, if you wanted to ask "which Recreate Reels are flirty vs lifestyle vs fitness for Amelia?" you couldn't — Recreate Reels only knows the source handle and posting metadata.

There IS one piece of latent strategy data: `Inspiration.Reel Embedding` + `Inspiration.Semantic Scores` per creator. The embeddings/compute-creator route scores each Inspiration reel against each Palm Creator's vector, producing a 0-1 similarity score. **This is usable as a recommender signal — "next reel for Amelia" = highest semantic score Amelia hasn't yet recreated.** But it doesn't cover Recreate Reels, Carousel Projects, or any pillar-level rotation.

### B3. Current "what's next" process today

Manual. Specifically:
1. Operator opens `/ai-editor` (TJP).
2. Picks creator (Brielle for Amelia's AI account, say).
3. Scrolls the `AI Recreate Pool` grid — every Recreate Reel where Produced For doesn't include this creator. Cards are sorted by Posted At desc (newest first).
4. Picks one based on gut/aesthetics. Clicks `↓ Raw` to download it AND auto-create a Stage B project.
5. Does the TJP image-to-image work, uploads finished AI clip via Batch Upload, lands in Pending Review.
6. Carousel reference library is a separate tab — pull a `Carousel Projects` row by hand.

No coordination across accounts. If two AI accounts both could use the same source reel, nothing flags that. No pillar rotation. No caption template. No hashtag pool. No calendar — the cron's "scheduled date" is an opaque ordering token only.

This is the exact friction the owner is solving for.

### B4. Proposed engine architecture

**Build the engine as one new admin route + one new Airtable table + four new fields across existing tables.** Keep it dumb and cron-driven. Smart UI on top can come later.

#### B4.1 New table: `Creator Content Plan`

One row per (Creator/AI-Account × Pillar × Channel × Day-of-Week × Slot). Defines the calendar:

| Field | Type | Notes |
|---|---|---|
| Plan Name | Single line text | "Brielle IG — Mon AM Lifestyle" |
| AI Account Profile | Link → AI Account Profile | Required for AI accounts |
| Palm Creator | Link → Palm Creators | For real accounts (Telegram path), required |
| Account Mode | Single select | `AI Account (Warmup)` / `AI Account (Live)` / `Real Account` — determines downstream routing |
| Channel | Single select | `IG` / `FB` |
| Pillar | Single select | `Lifestyle` / `Fitness` / `Flirty` / `Behind-the-Scenes` / `Fashion` / `Trend Reaction` / `Q&A` — owner-editable |
| Post Type | Single select | `Reel` / `Carousel` / `Photo` / `Story` |
| Day of Week | Single select | `Mon` / `Tue` / `Wed` / `Thu` / `Fri` / `Sat` / `Sun` |
| Window Start (ET) | Single line text | "11:00" |
| Window End (ET) | Single line text | "13:00" |
| Active | Checkbox | Toggle on/off without delete |
| Last Selected At | Datetime | When the engine last filled this slot — for round-robin tracking |

For Brielle, this might be 5-6 rows total: Mon AM Lifestyle Reel, Wed PM Flirty Carousel, Fri AM Fitness Reel, Sat PM BTS Story, Sun PM Lifestyle Photo. Owner edits these.

#### B4.2 Add Pillar + Pillar Confidence to source tables

Two new fields on each of `Recreate Reels`, `Carousel Projects`, `Inspiration` (and `Assets` for already-produced content):

| Field | Type | Notes |
|---|---|---|
| Pillar | Single select | Same options as Creator Content Plan.Pillar |
| Pillar Source | Single select | `Manual` / `AI-Tagged` / `Heuristic` — provenance |

Pillar gets seeded:
- **Manual**: operator clicks "Tag" on a reel card.
- **AI-Tagged**: a one-off backfill script runs every Recreate Reel through GPT-4o with the caption + on-screen text + thumbnail to classify it. ~$0.005/reel × 5000 reels = ~$25 one-time. Re-runs on new reels.
- **Heuristic**: source-handle-based defaults (e.g. fitness IG accounts → Fitness pillar).

#### B4.3 New `/api/admin/content-engine/next` route

Stateless query. Given `(accountId, channel, postType, pillar, slotDateTime)`, returns the best candidate:

```
INPUT: {
  accountProfileId: 'recXXX',
  channel: 'IG',
  postType: 'Reel',
  pillar: 'Lifestyle',
  slotDateTime: '2026-06-05T15:00:00Z'
}

LOGIC:
  1. Pull Recreate Reels where:
     - Pillar = requested pillar
     - Status = 'Available' or 'Ready'
     - NOT already in Produced For for this account (anti-repeat)
     - Posted At > 30 days ago (recency)
  2. Score by:
     - Inspiration semantic score against this account's creator (if AI account links a real creator)
     - Views (volume signal)
     - Recency
  3. Return top 5 candidates with thumbnails + scores
```

#### B4.4 Caption + Hashtag pools

Two new tables. Per-account pools so Brielle's "Hook 3" and Lily's "Hook 3" can differ:

**`Caption Templates`** (one row per template per persona):
| Field | Type | Notes |
|---|---|---|
| Template Name | Single line text | "Brielle Hook 1 — coffee morning" |
| AI Account Profile | Link → AI Account Profile | Multi-link allowed (template reusable across accounts) |
| Palm Creator | Link → Palm Creators | For real-account use |
| Pillar | Single select | Same options |
| Post Type | Single select | Reel / Carousel / Photo |
| Caption Body | Long text | The text. May include `{persona}` placeholder |
| Used At | Datetime | Last time the engine pulled this |
| Active | Checkbox | |

**`Hashtag Pools`** (one row per pool):
| Field | Type | Notes |
|---|---|---|
| Pool Name | Single line text | "Lifestyle Safe — 2026 Q2" |
| Pillar | Single select | |
| Tags | Long text | Comma- or newline-separated, e.g. `#lifestyleblogger,#contentcreator,#sundayvibes` |
| Active | Checkbox | |
| Banned Tags Check | Formula or external | Validates none of the playbook's hashtag denylist (#alone, #brain, #pushups, #onlyfans, etc.) are in this pool |

Hard cap of 5 tags per post (per IG's Dec 2025 cap noted in `project_publer_ai_pipeline.md`).

### B5. Per-creator content calendar shape

Owner defines the **week template** in `Creator Content Plan`. Engine instantiates it daily.

Concrete shape for Brielle once live (post-Day-90):

| Slot | Channel | Type | Pillar | Window |
|---|---|---|---|---|
| Mon | IG | Reel | Lifestyle | 11:00-13:00 ET |
| Tue | IG | Story | Behind-the-Scenes | anytime |
| Wed | IG | Carousel | Flirty | 18:00-21:00 ET |
| Thu | IG | Reel | Fitness | 09:00-12:00 ET |
| Fri | IG | Story | Trend Reaction | anytime |
| Sat | IG | Photo | Fashion | 12:00-15:00 ET |
| Sun | IG | Reel | Lifestyle | 18:00-21:00 ET |

That's 7 posts/week for live state. During warmup, the Warmup Tasks table dictates cadence (much lower — 1-2/week in Days 8-14, etc.) and the engine still fills the post slot but with the warmup posting frequency.

### B6. Selection logic — pillar/hashtag/caption rotation, variations

**Selection algorithm (per slot):**

1. **Pillar rotation:** read directly from Creator Content Plan slot. No randomization at this layer.
2. **Asset selection:**
   - Filter Recreate Reels (or other source) by `(Pillar = slot.Pillar) AND (Status in Available/Ready) AND (this AI Account not in Produced For)`.
   - Score: `0.5 * semanticScore + 0.3 * viewsNormalized + 0.2 * recencyFactor`.
   - Tiebreak: oldest unused first (rotate the library top-down).
   - Return top candidate.
3. **Caption rotation:** filter Caption Templates by `(AI Account contains this account) AND (Pillar = slot.Pillar) AND (Post Type = slot.Post Type) AND Active`. Sort by `Used At ASC` (oldest first = round-robin). Pick first. Stamp `Used At = now`.
4. **Hashtag rotation:** filter Hashtag Pools by `(Pillar = slot.Pillar) AND Active`. Pick pseudo-randomly weighted by inverse-recent-use. Cap to 5 tags. Validate none on the banned list.
5. **Output:** a `Warmup Tasks` row update (during warmup) or a `Posts` row create (post-warmup, live state), with the chosen Linked Asset, Caption, Hashtags, and Scheduled Date.

**Variations management:** the same source `Recreate Reel` can produce N `Assets` (one per AI recreation attempt). To avoid posting two derivations of the same source reel back-to-back, add `Source Reel` (link → Recreate Reels) to `Assets`. Engine then filters: no Asset whose Source Reel was used by this account in last 30 days.

**Cross-account variation:** Brielle and Lily are both AI accounts. Could legitimately both post derivatives of the same source reel. The system shouldn't block that, but should **stagger them by ≥3 days** to avoid pattern detection. Implement as: when picking for account B, exclude source reels used by sibling AI accounts in last 3 days.

### B7. Plug-in points (Telegram warmup vs Publer live)

**Pre-Day-90 (warmup, Telegram via Amin):**

The engine runs as a daily cron: `/api/cron/warmup-content-fill` — fires at, say, 06:00 ET. For each `Warmup Tasks` row where:
- `Day Number == today + 1` (fill TOMORROW's posts so operator can review tonight)
- `Task Type == Post`
- `Linked Asset == null`

The cron runs the selection logic and PATCHes the task with the chosen Linked Asset, Caption (Suggested), Hashtags (Suggested). Operator sees tomorrow's posts pre-filled when they open the Today view. They can override before sending to Amin.

**Post-Day-90 (live, Publer via API):**

The same engine fires as `/api/cron/content-engine-fill` — daily at 06:00 ET, but instead of populating `Warmup Tasks` rows, it CREATES `Posts` rows directly with:
- `Status = Prepping`, `Pipeline Target = Publer`, `Channel`, `Creator`, `Asset`, `Caption`, `Hashtags`, `Type`, `Scheduled Date` (within slot window + jitter from Publer Phase 3)

Then the existing Publer enqueue flow takes them through to the cron. Owner reviews the day's Prepping posts in `/admin/smm/publer-pipeline` (new view), clicks "Approve All for Today" → bulk enqueue. Or skips review entirely if Auto-Approve flag is on for trusted accounts.

**The seam between Warmup-Telegram and Live-Publer is `Warmup Status`.** When operator flips an account from `Active Warmup` to `Live`, the engine stops writing to Warmup Tasks for that account and starts writing to Posts. Same engine code, different output table. This is the gradual-Amin-transition the owner wants — flip happens per-account, not flag-day.

---

## C. Amin Bridge — Manual Post Scheduling

### C1. Current Telegram flow

Confirmed by reading `app/api/cron/telegram-queue/route.js` and `app/api/admin/telegram/enqueue/route.js`:

**Enqueue path:**
1. `POST /api/admin/telegram/enqueue` — admin browser sends `{postIds:[...]}`.
2. Each Post is patched to `Status = 'Queued for Telegram'`. That's the entire enqueue — no further logic. typecast:true.

**Cron path** (`/api/cron/telegram-queue`, every minute):
1. Stale-lock recovery: any Post stuck at `Status = 'Sending'` for >10min gets reset to `Queued for Telegram` (with `Sending Since = null`).
2. Fetch oldest 1 post where `Status = 'Queued for Telegram'`, sorted by `Scheduled Date` ASC.
3. Claim-lock: flip Post to `Status = 'Sending'`, stamp `Sending Since`.
4. Resolve routing: read Post.Creator → fetch `Palm Creators` record → read `Telegram IG Topic ID` or `Telegram FB Topic ID` based on Post.Channel.
5. POST internal call to `/api/telegram/send` with the topic ID, asset URL, caption, hashtags, etc.
6. The send route uploads the media to Telegram (ffmpeg compresses if needed), posts to the SMM master group's per-account topic, and Amin picks it up there.

**Per-account Telegram topic creation** lives in `lib/telegramTopics.js` (`createSmmTopicForHandle`) — already used by the SM Setup Requests flow when a new real-creator IG account is requested. Bot needs "Manage Topics" permission in `TELEGRAM_SMM_GROUP_CHAT_ID`. Returns the `message_thread_id` to store on the creator/account record.

### C2. Gap analysis for warm-up posts to AI accounts

**Critical mismatch:** the cron's routing assumes Post.Creator links to a `Palm Creators` row that has `Telegram IG Topic ID` or `Telegram FB Topic ID` set. For the three new AI accounts:

- **Brielle's real creator** is Amelia. Amelia almost certainly has a `Palm Creators` row with topic IDs (she's a managed real creator). But Brielle's posts during warmup should go to **a DIFFERENT Telegram topic** than Amelia's real-creator content — otherwise Amin posts Brielle's AI content to Amelia's real IG account by accident. **This is a posting-direction disaster waiting to happen.**
- **Katie Rosie has no linked real creator.** She's standalone (per scope doc). There's no `Palm Creators` row to look up at all. The cron would fail with "Post has no Creator link" on her.
- Even for Brielle/Lily, the current `Palm Creators.Telegram IG/FB Topic ID` is bound to the *real creator's IG account*. Adding a second pair of topics for the AI account on the same `Palm Creators` row is awkward (would need a fourth field).

**Bottom line: today, you literally cannot send a warm-up post for Brielle, Lily, or Katie Rosie to Amin via the existing pipeline. The plumbing routes only to real-creator accounts.**

### C3. Proposed warm-up Telegram routing

**Recommended shape: one Telegram topic per AI account, owned by `Publer Accounts` (or sibling `AI Account Profile`), not by `Palm Creators`.**

Concretely:

1. **New field on `Publer Accounts`:** `Warmup Telegram Topic ID` (single line text) — created when the operator marks the account ready for warmup posts. Created by calling `createSmmTopicForHandle(accountProfile.IG Handle, { creatorAka: persona name })` from a new admin route. Topic name in Telegram: `@briel.ai (Brielle / Amelia)` so Amin can disambiguate.

2. **New route:** `POST /api/admin/smm/warmup/create-telegram-topic` — body: `{accountProfileId}`. Creates the Telegram topic, stamps `Publer Accounts.Warmup Telegram Topic ID` (for both IG and FB rows — same topic for both channels, since Amin handles both manually). Idempotent (no-op if already set).

3. **New route:** `POST /api/admin/smm/warmup/send-to-amin` — body: `{warmupTaskId}`. Looks up the task → AI Account Profile → Publer Account → Warmup Telegram Topic ID. Builds a Telegram message with thumbnail + caption + hashtags + post type + handle + posting-window time. Sends to the topic. Stamps `Warmup Tasks.Telegram Sent At` and `Telegram Message ID`. Sets Task Status to `Sent to Amin`.

4. **Why one topic per AI account, not per channel**: Amin needs to know "this post is for Brielle's IG" or "this post is for Brielle's FB Page" — the channel is in the message body, not the routing. Cuts topic count in half and avoids confusing Amin with two near-identical inboxes.

5. **Why NOT the same Creator topic as the real account, even with a "AI account, manual post" tag**: too easy for Amin to mis-route. Separate topic = physical separation in the Telegram UI = drastically lower error rate. Cost is just one extra forum topic per account.

### C4. Time-of-day scheduling

**Today's `telegram-queue` cron is pure FIFO by `Scheduled Date` ASC with no time-of-day awareness.** That works for real-creator content where Amin gets a list of "post these in calendar order" and picks his own time. It does NOT work for warm-up posts where the playbook says "Day 12 IG post: window 11am-1pm ET."

**Proposed: skip the cron entirely for warm-up posts.** Amin's warmup messages are sent eagerly when the operator hits "Send to Amin" — not queued. The operator presses the button only when the slot opens (or just-before). The message itself includes the posting window: "Post between 13:00 and 15:00 ET. AI label ON. Caption: ... Hashtags: ..."

Why not queue them: warmup is low-volume (≤3 posts/day per account) and operator-driven. Queueing adds latency and a moving part for no benefit. The existing `telegram-queue` cron continues to serve real-creator content as today.

**For batched send (operator wants to push tomorrow's three posts tonight):** allow the operator to mark posts "Send Tomorrow at Window Open." A new lightweight cron `/api/cron/warmup-telegram-deliver` runs every 15 min during work hours, checks for `Warmup Tasks where Status = 'Scheduled to Send' AND Window Start <= now` — sends them. This is a new path, doesn't touch the existing cron.

### C5. Confirmation / acknowledgement design

**Recommendation: trust + spot-check.** Amin is a paid contractor with a track record. Building a sophisticated ACK protocol for the 90-day warmup period is overkill.

Three layers of light verification:

1. **Amin reply convention:** when he posts, he replies in the Telegram topic with `/posted <postLink>`. Optional. If the operator wants it, a new Telegram webhook in the existing `telegram` route family parses these replies and stamps `Warmup Tasks.Amin Confirmed = true, Posted At = <reply time>`. Telegram bot is already running; this is one extra handler in the existing webhook.

2. **Manual checkbox on Today view:** alongside "Sent to Amin" status, there's a checkbox "Mark Posted." Operator marks it after a 5-second sanity check on the live IG account. Sets Task Status to `Done`.

3. **Daily spot check via the IG scraper:** the existing scrape pipeline (Recreate Sources / Inspo Sources) could scrape the AI account itself daily. If a post task is `Sent to Amin` >6 hours ago and not visible on the account, alert. **This is overkill for first 30 days — defer until volume scales past one operator's attention budget.**

**On a deeper level: ACK is not the long-term answer because the long-term answer is Publer takes over.** Don't build elaborate Amin-confirmation tooling now; it gets thrown away in 90 days.

---

## D. Publer Phase 3 Gaps

Pulled from `publer-ai-scheduler-phase1-2-handoff.md` § "What Phase 3 needs."

### D1. Schedule jitter

**Min:** one-line change in `lib/publer.js` or `app/api/cron/publer-queue/route.js` `buildEnvelope`. Pseudo-random offset of `±[15,25]` minutes added to `scheduled_at`. Seed by `${postId}-${date}` so re-runs are stable.

**Max:** per-account "natural posting time histogram" — track when each AI account historically posted in the prior 14 days and bias jitter toward that distribution. Avoids the model fingerprinting on "this account always posts at 11:00 + 17 min offset."

**Verdict:** Min is enough for Phase 3 launch. The Max version is a polish pass after 60 days of data.

### D2. Caption template rotation

**Min:** the schema I proposed in B4.4 — `Caption Templates` table with `Used At` timestamp, draw-oldest-first. Worker reads templates for the post's pillar+type+account, picks the oldest, stamps `Used At = now`.

**Max:** add A/B engagement tracking — caption template `Template A` had higher avg engagement than `Template B` on this account, weight selection toward A.

**Verdict:** Min ships in batch 3 (Content Strategy). Max is a "two months from launch" optimization.

### D3. Hashtag pool rotation + denylist

**Min:** `Hashtag Pools` table per B4.4. Each pool is ≤10 tags. Per IG's Dec 2025 cap, ≤5 tags actually get used per post — engine picks 5 from a 10-tag pool (random sample without replacement). Banned-tag check at write time using a constant denylist in `lib/contentDenylist.js`:

```
export const BANNED_HASHTAGS = new Set([
  '#alone', '#brain', '#pushups',
  '#onlyfans', '#onlyfansgirl', '#spicycontent',
  '#linkinbio', '#nsfw', '#18plus', '#adultcontent',
  '#milf', '#curvy', '#models', '#beauty',
])
```

Fail-loud on any pool containing a banned tag. Quarterly refresh = a calendar reminder; no system automation needed.

**Max:** scrape IG's daily banned-hashtag list automatically. There's no official API for this so it'd be Apify-scraping community sites — fragile. Don't bother.

**Verdict:** Min ships in batch 3. Max not recommended.

### D4. Monitoring dashboard

**Min:** new `/admin/smm/publer-monitor` page. One row per Publer Account. Columns: scheduled (next 7d), published (last 7d), failed (last 7d) with last-error reason, last successful publish at, Token Expiry countdown (computed from `Connected At` + 60d Meta OAuth lifetime — Meta tokens expire 60 days by default, refresh via Publer dashboard manually).

Queries are direct Airtable reads against `Posts` filtered by `Pipeline Target = Publer` and grouped by Creator+Channel. Render with simple cards, no chart libs.

**Max:** add reach trend (IG Insights via Publer's analytics endpoint), engagement rate, follower delta. Pull from Publer's analytics API where exposed.

**Verdict:** Min ships in batch 5. Max is a follow-up — Publer analytics API access depends on plan + may need separate auth.

### D5. Alerts (Slack / email)

**Min:** plain email via existing transactional path (Resend / Postmark — check what's already in env). Triggers:
- Token-expiring-in-<7d nightly check (a new daily cron `/api/cron/publer-health-check`).
- Per-post `Publer Status = Failed` triggers an immediate email to evan@palm-mgmt.com.
- Reach drop ≥40% over rolling 24h — needs analytics data, defer until D4 Max is in.

**Max:** Slack webhook integration with per-channel routing (failures → #ai-content-alerts, reach drops → #ai-content-metrics).

**Verdict:** Min ships in batch 5. Slack can wait until the agency has a real Slack workspace for this.

### D6. Phase 2.5 carousel per-slide rejection

Spec from `publer-ai-scheduler.md` §6.4. Two modes: "Reject slide + bounce whole carousel back to AI editor" (default) and "Reject slide + publish without it."

Implementation surface: `app/admin/editor/CarouselSubmissionsReview.js`. The reject buttons exist conceptually but no per-slide control yet. Need:
- Per-slide UI: reject button + reason dropdown.
- Logic for "bounce" mode: revert all slides to In Review on the Carousel Project, capture rejected slide IDs + reason in `Tasks.Revision History`.
- Logic for "remove" mode: drop the rejected slide from `Posts.media[]` array (more precisely, drop its photo Asset from Posts.Asset linked records), re-order remaining slides.

**Verdict:** Worth absorbing into batch 5 of consolidation since the review UI is already getting a sidebar reorg.

### D7. What to absorb vs defer

**Absorb into the SMM consolidation:**
- D1 Schedule jitter — trivially small, blocks live posting.
- D2 Caption rotation (Min) — fits naturally into the Content Strategy Engine batch.
- D3 Hashtag pool rotation + denylist (Min) — same batch as D2.
- D4 Monitoring dashboard (Min) — needed as soon as accounts go Live (post Day 90).
- D5 Alerts (Min, email only) — same.
- D6 Phase 2.5 carousel per-slide reject — natural piggyback when CarouselSubmissionsReview gets touched.
- Symmetric Pipeline Target validator on `telegram/enqueue` — five-line addition.

**Defer to a later sprint:**
- D1 Max (natural posting histogram) — needs 60 days of data first.
- D2 Max (A/B engagement tracking) — needs engagement data.
- D3 Max (auto-scrape denylist) — fragile.
- D4 Max (reach/engagement analytics) — needs Publer analytics auth.
- D5 Max (Slack webhooks) — operational nice-to-have.

---

## E. Implementation Priority

Ordered for the three in-flight AI accounts (Brielle, Lily, Katie Rosie) entering warmup imminently.

1. **WEEK 1 — Block the cliff.**
   - Add `AI Account Profile` table + `Warmup Tasks` + `Warmup Playbook Templates` tables in Airtable.
   - Add the three new fields on `Publer Accounts` (Warmup Telegram Topic ID, AI Account Profile link, Warmup Day formula).
   - Seed `Warmup Playbook Templates` from the markdown playbook (manual data entry by owner — ~150 rows).
   - Build `/admin/smm/warmup/[accountId]` Profile tab + "Mark Account Created" button + instantiation logic.
   - Build `/admin/smm/warmup` Today view (minimal).
   - Build `/api/admin/smm/warmup/create-telegram-topic` + `/api/admin/smm/warmup/send-to-amin`.
   - Wire each engagement/bio/profile-pic task to a simple "Mark Done" toggle.
   - Test end-to-end: create Brielle account row, mark Created, see Day 1 tasks, send Day 1 post to Amin in a new Telegram topic, mark Done.

2. **WEEK 2 — Warmup operability.**
   - Sidebar consolidation under `/admin/smm/*` (the broader nav restructure from Auditor A's scope — coordinate with batch-1).
   - Full per-account Schedule tab.
   - History / Audit log tab.
   - Pause / Resume flow.
   - Backfill Brielle's first week of completed tasks (she may already be Day 4 by then).

3. **WEEK 3 — Content Engine (minimal).**
   - Add `Pillar` + `Pillar Source` fields to `Recreate Reels`, `Carousel Projects`, `Inspiration`, `Assets`.
   - One-off backfill: AI-tag every Recreate Reel via GPT-4o classification (~$25).
   - Build `Creator Content Plan` table. Owner defines plans for Brielle/Lily/Katie Rosie.
   - Build `/api/admin/content-engine/next` route.
   - Build `/api/cron/warmup-content-fill` — pre-fills Warmup Tasks for tomorrow's posts.

4. **WEEK 4 — Caption + Hashtag pools.**
   - Add `Caption Templates` and `Hashtag Pools` tables.
   - Owner seeds 8-12 captions + 5-10 hashtag pools per pillar per persona.
   - Engine integrates them into next-fill logic.
   - Add Phase 2.5 carousel per-slide reject in CarouselSubmissionsReview.

5. **WEEKS 5-12 — Publer Phase 3 + Live transition prep.**
   - Schedule jitter, banned-tag denylist, monitoring dashboard, email alerts.
   - Once Brielle hits Day 23, validate Publer hookup end-to-end (currently blocked on Pixel hardware purchase).
   - Day 90: flip Brielle from Active Warmup to Live. Engine starts writing to `Posts` for her, not `Warmup Tasks`.

---

## F. Open Questions for the Owner

1. **Credential storage.** Recommended: Bitwarden Family ($40/yr) or 1Password Team ($8/mo/user). Store vault item URLs in `AI Account Profile`, never raw passwords. Confirm which vault, and whether you want me to standardize a naming convention for vault items (e.g. `AI Account / Brielle / IG`).

2. **Telegram topic strategy for warm-up.** Confirm: one Telegram topic per AI account in the existing `TELEGRAM_SMM_GROUP_CHAT_ID` group, named e.g. `@briel.ai (Brielle / Amelia)`. Same topic carries both IG and FB tasks; channel is stated in the message body. Alternative is two topics per account (one IG, one FB) — adds clarity but doubles topic count and gives Amin a noisier sidebar.

3. **Backfill of Brielle.** As of 2026-05-27, is Brielle already past Day 1? If yes, we need to backfill her `Warmup Tasks` to the right day and mark prior days Done from operator memory. Want me to draft a "Backfill mode" toggle on Mark Account Created that lets you specify a date in the past?

4. **Caption + hashtag pre-population.** Are you willing to seed 8-12 caption templates + 5-10 hashtag pools per persona by hand, or do you want a GPT-4o "draft from playbook context" generator that proposes them and you accept/edit? Cost: ~$0.50 per persona for caption gen, ~$0.20 per persona for hashtag pools.

5. **Pillar taxonomy.** Proposed pillars: Lifestyle / Fitness / Flirty / Behind-the-Scenes / Fashion / Trend Reaction / Q&A. Edit before I lock them into the singleSelect? Different personas may want different pillar sets (e.g. Katie Rosie may not do Q&A).

6. **Amin acknowledgement.** Three layers proposed (`/posted` reply, manual checkbox, optional scrape spot-check). Do you want the `/posted` Telegram reply hook built in batch 4, or skip entirely and rely on operator manual checkbox? Vote skip for now to keep batch 4 lean.

7. **Auto-Approve flag for live state.** Once accounts pass Day 90, should the engine's daily Post creation auto-enqueue to Publer, or always sit in `Status=Prepping` waiting for owner review? Default recommendation: always Prepping for the first 30 days post-Day-90 per account, then per-account opt-in to Auto-Approve. Confirm.

8. **Real-creator (non-AI) accounts in the same engine.** Should the Content Strategy Engine also pick "what's next" for real-creator Telegram-routed posts? Currently scoped to AI accounts only. If yes, scope creeps into the existing Editor workflow — distinct sprint.

9. **Days-Paused increment automation.** When operator pauses, should the system automatically detect the resume time and bump Days Paused by `resume - pause`, or should it ask the operator on resume "how many days to skip" (defaulting to the elapsed pause)? Recommend automatic with override.

10. **Templates editor permissions.** `/admin/smm/warmup/template` proposed as owner-only (`requireAdmin`). Does the future `social_media` hire need template-edit rights, or strictly view? Recommend view-only for the hire; owner curates the playbook.

