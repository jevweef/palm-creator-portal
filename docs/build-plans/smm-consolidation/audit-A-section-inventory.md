# Audit A — Section Inventory + Content Flow

**Author:** Auditor A
**Date:** 2026-05-27
**Scope:** Section inventory, role surface area, content flow mapping, and proposed consolidated SMM sidebar.

---

## Executive Summary

The portal today exposes **12 top-level admin sidebar entries**, but only ~6 of them are unambiguously "social media management" surfaces. The rest are creator ops (Onboarding, Creators, Invoicing), strategic dashboards (Whale Hunting, Dashboard), or operator-only utilities (Inbox, Help). The two content streams converge on the same Post-Prep / Carousels / Grid Planner UI but exit through two distinct enqueue endpoints (Telegram for real, Publer for AI). **The biggest scatter problem is the AI editor's surface** — TJP (`/ai-editor`) is fully separated from the editor's `/admin/editor` workflow despite both producing Assets/Tasks that converge in the same review queue. The `/admin/inspo`, `/admin/recreate-source`, `/admin/recreate`, and the `/ai-editor/recreate` route all touch the AI recreation pipeline with overlapping responsibilities, and `recreate-source` is mislabeled as "AI Source." Three orphaned API surfaces (`sm-workspace`, `sm-requests`, `sm-grid`) exist for the `social_media` role but **have no page UI** — Amin's only real surface is the Telegram chat. The proposed consolidated SMM parent groups Editor / Carousels / Post Prep / Grid Planner / Outbound (Telegram + Publer) / Account Warm-Up / Strategy Engine under one nav node with role-filtered children.

---

## 1. Section Inventory

### 1.1 Top-level (no `/admin` prefix)

| Path | Purpose | Role gate (source) | Airtable / API | Sidebar entry? |
|---|---|---|---|---|
| `/` (`app/page.js`) | Marketing landing page | Public | none | Not in admin nav |
| `/sign-in`, `/sign-up` | Clerk auth | Public | none | n/a |
| `/dashboard` | Role dispatch — redirects to `/admin/dashboard` (admin), `/admin/editor` (editor), `/photo-library` (chat_manager), `/creator/{opsId}/dashboard` (creator) | Authenticated (`app/dashboard/page.js` lines 11-40) | none | Hidden router |
| `/demo` | Marketing demo of EarningsGrowth — `app/demo/page.js` | Public | none | Direct-URL only |
| `/editor` | Editor's "My Dashboard" tabs: Dashboard / Revisions / OFTV Projects | `editor` or `admin` (layout `app/editor/layout.js:14`) | `/api/editor/dashboard` | Editor sidebar |
| `/editor/[creatorId]` | Per-creator editor view (drilldown from dashboard) | `editor` or `admin` (inherits layout) | `/api/editor/*` | No nav, drill-only |
| `/editor/inspo` | Inspo Board wrapped with `isEditor` prop — `app/editor/inspo/page.js` re-renders `@/app/inspo/page` | `editor` or `admin` | `/api/inspo/*` | Editor sidebar |
| `/ai-editor` | TJP — three-tab AI workspace: Workspace / Create Scene / Carousel — `app/ai-editor/page.js` (1242 lines) | `ai_editor` or `admin` or `super_admin` (layout `app/ai-editor/layout.js:14`) | `/api/admin/recreate-rooms/*`, `/api/admin/ai-gen/*`, `/api/ai-editor/upload`, `/api/admin/carousel-projects` | No sidebar visible to ai_editor (sidebar is empty for that role; admin sees ADMIN_NAV); admin reaches `/ai-editor` by direct URL only |
| `/ai-editor/recreate` | Legacy direct-URL entry to recreate workflow (subpath under TJP layout) | Same as `/ai-editor` | Same | No nav entry |
| `/inspo` | Inspo Board canonical implementation — `app/inspo/page.js` | Authenticated; renders for admin/editor/creator with mode props | `/api/inspo/*` | No top-level nav; surfaced via the wrapper routes |
| `/photo-library` | Chat-manager's photo-picker workspace — `app/photo-library/page.js` | `admin`, `super_admin`, or `chat_manager` (layout `app/photo-library/layout.js:23`) | `/api/admin/photos/*` | Chat-manager sidebar + admin sidebar |
| `/onboarding` (and `/onboarding/form`) | Creator self-serve onboarding survey | Authenticated; gated by Clerk publicMetadata.airtableHqId | `/api/onboarding/*` | Hidden flow |
| `/content-request` | Creator self-serve content brief surface — `app/content-request/page.js` | Creator | `/api/creator/content-requests` | Direct URL from creator dashboard |
| `/my-content` | Creator's content pipeline view (Saved/Uploaded/Editing/Scheduled/Posted) — `app/my-content/page.js` | Creator | `/api/creator/my-content` | Direct URL from creator dashboard |
| `/sonnet-test` | Internal AI test scratchpad | likely admin | n/a | Direct URL only, looks abandoned |

### 1.2 Admin surfaces (`/admin/*`)

| Path | Purpose | Role (server source) | Airtable tables / APIs | Sidebar entry |
|---|---|---|---|---|
| `/admin` | Redirect-only → `/admin/dashboard` (`app/admin/page.js`) | gated by `app/admin/layout.js` | none | no |
| `/admin/dashboard` | Operator overview: revenue, urgent inbox tasks, KPI cards | `admin`/`super_admin` (`app/admin/layout.js:74`) | many | Yes — Dashboard |
| `/admin/inspo` | Inspo Board admin face. Renders 8 tabs by importing `/admin/sources`, `/admin/review`, `/admin/import`, `/admin/candidates`, `/admin/training`, `/admin/suggest-test`, `/admin/recreate` as child pages — `app/admin/inspo/page.js:1-72` | `admin` | `Reels`, `Sources`, `Recreate Reels`, `Photos`, `Palm Creators` | Yes — Inspo Board (with 8 children: pipeline, sources, review, import, candidates, training, suggest, recreate) |
| `/admin/sources` | Reel-scrape source handle management (consumed as Inspo `sources` tab) | `admin` | `Sources` | No standalone nav |
| `/admin/review` | Inspo reel review queue (consumed as Inspo `review` tab) | `admin` | `Reels` | No standalone nav |
| `/admin/import` | Inspo Reel bulk import (consumed as Inspo `import` tab) | `admin` | `Reels` | No standalone nav |
| `/admin/candidates` | Scraped candidate handle review (consumed as Inspo `candidates` tab) | `admin` | `Candidates`, `Sources` | No standalone nav |
| `/admin/training` | Text-training / tag-learning scratchpad (consumed as Inspo `training` tab) | `admin` | `Reels` | No standalone nav |
| `/admin/suggest-test` | Caption-style suggestion test surface (consumed as Inspo `suggest` tab) | `admin` | `Reels` | No standalone nav |
| `/admin/recreate` | AI Recreate planning (consumed as Inspo `recreate` tab) | `admin` | `Recreate Reels` | No standalone nav |
| `/admin/recreate-source` | **"AI Source"** library — admin-side companion to TJP. Sub-tabs (URL: `?tab=library|rooms|stageb|avatar|photos|freeform`): library of scraped reels, room scenes, stage-b workflow, avatar tools, AI Photos, freeform AI gen. Includes editor-uploaded inspo with badge. (`app/admin/recreate-source/page.js:81-115`) | `admin` (gated by admin layout) | `Recreate Reels`, `Recreate Rooms`, `Photos`, `Recreate Sources` | Yes — **AI Source** (owner wants → "AI Content") |
| `/admin/editor` | Operator's editor workspace — **9 tabs** (`app/admin/editor/page.js:2640-2650`): Dashboard, For Review, Submissions, Post Prep, Carousels, Grid Planner, Creator Library, OFTV Projects, Long Form Upload. The **single most loaded surface in the app.** | `admin` | many — `Tasks`, `Assets`, `Posts`, `OFTV Projects`, `Carousel Projects`, `Photos`, `Palm Creators` | Yes — Editor (with children: editorview, review, postprep, grid, library, oftv, longform — note sidebar lists 7 but page now has 9 including Submissions + Carousels) |
| `/admin/posts` | The Post Prep tab content, importable component. Renders post cards with caption/hashtag/thumbnail editor, send-to-Telegram modal. (`app/admin/posts/page.js`) | `admin` | `Posts`, `Assets`, `Palm Creators` | No standalone sidebar entry; surfaced as `/admin/editor?tab=postprep` |
| `/admin/creators` | Creators index + per-creator drilldown with tabs Profile / Documents (count) / Tag Weights / Music DNA / AI Super Clone / Adjustments (`app/admin/creators/page.js:2487`) | `admin` | `Palm Creators` + many | Yes — Creators (sidebar lists 3 children: earnings, dna, communication — note these are filters into the creators table, not the same as the sub-page tabs) |
| `/admin/whale-hunting` | Aggregate whale-analysis dashboards: "Palm Internal" + "Chat Team Report" (`app/admin/whale-hunting/page.js`) | `admin` | `Whale Reports` | Yes — Whale Hunting (children: internal, team) |
| `/admin/publer` | Publer mapping admin: Publer Accounts ↔ Palm Creator + Account Type + AI Consent (`app/admin/publer/page.js`) | `admin` | `Publer Accounts`, `Palm Creators` | Yes — Publer |
| `/admin/onboarding` | Operator-side creator onboarding panel — invite, signature, offboard | `admin` | `Palm Creators`, `Onboarding Submissions` | Yes — Onboarding |
| `/admin/onboarding/[creatorId]/photos` | Per-creator onboarding photo collection | `admin` | `Photos` | Drill-only |
| `/admin/invoicing` | Invoice generation + raw earnings upload (2 tabs) | `admin` | `Creator Earnings`, `Invoices` | Yes — Invoicing (children: invoices, upload) |
| `/admin/inbox` | iMessage/Telegram inbox — Tasks / Messages / Setup tabs (`app/admin/inbox/page.js`) | `admin` AND email in `INBOX_OWNER_EMAILS` (`lib/adminAuth.js:40-60`) | `Inbox Tasks`, `Inbox Chats` | Yes — Inbox (ownerOnly, evan@palm-mgmt.com) |
| `/admin/help` | Operator handbook / runbook | `admin` | none | Yes — Help |
| `/admin/tonio` | Friendly landing for one specific user "Tonio" | `admin` (no special gate) | none | No nav, direct URL only — looks like a one-off |

### 1.3 Creator surfaces (`/creator/[id]/*`)

| Path | Purpose | Role | Source file |
|---|---|---|---|
| `/creator/[id]/dashboard` | Per-creator dashboard (revenue, content stats) | Creator (own id) or admin | `app/creator/[id]/dashboard/page.js` |
| `/creator/[id]/content-request` | Creator content brief — wraps `app/content-request/page.js` | Creator/admin | `app/creator/[id]/content-request/page.js` |
| `/creator/[id]/inspo` | Inspo Board scoped to creator — wraps `app/inspo/page.js` with `opsIdOverride` | Creator/admin | `app/creator/[id]/inspo/page.js` (8 lines, pure wrapper) |
| `/creator/[id]/my-content` | Creator's pipeline view (5 tabs: Saved / Uploaded / Editing / Scheduled / Posted) — wraps `app/my-content/page.js` | Creator/admin | `app/creator/[id]/my-content/page.js` (8 lines, pure wrapper) |
| `/creator/[id]/long-form` | OFTV/long-form briefs scoped to the creator | Creator/admin | `app/creator/[id]/long-form/page.js` |
| `/creator/[id]/vault` | Placeholder — "New OF Content Upload — Coming soon" (`app/creator/[id]/vault/page.js`) | n/a | 9 lines — abandoned stub |

### 1.4 API-only role surfaces (no page exists)

These APIs are gated to `social_media` but have **no UI**:

| Path | Role | Caller |
|---|---|---|
| `/api/admin/sm-workspace` | `admin` or `social_media` | None — orphaned |
| `/api/admin/sm-requests`, `/api/admin/sm-requests/[id]`, `/api/admin/sm-requests/[id]/complete-account`, `/api/admin/sm-requests/backfill-topics` | `admin` or `social_media` | None — orphaned |
| `/api/admin/sm-grid/mark-scheduled` | `admin` or `social_media` | Called by `components/GridPlanner.js:2299` — **only live SM-namespaced API** |
| `/api/admin/telegram/enqueue` | `admin` or `social_media` | Called from the Post Prep tab via `/admin/editor?tab=postprep` |

**This means Amin (`social_media` role) currently has no in-app surface at all.** He receives content via Telegram messages dispatched by the cron and posts manually. The `sm-workspace`/`sm-requests` routes are vestigial dead code from a never-shipped SMM dashboard. This matters for the SMM consolidation: there's no existing UI to migrate Amin to — we're building from scratch.

---

## 2. Current Sidebar Audit

Source: `app/admin/layout.js:8-52` (ADMIN_NAV) and `app/admin/layout.js:59-62` (EDITOR_NAV) and `app/admin/layout.js:64-66` (CHAT_MANAGER_NAV).

### Admin sidebar (12 items)

| # | Label | Path | Children (in nav) | Roles allowed | SMM classification |
|---|---|---|---|---|---|
| 1 | Dashboard | `/admin/dashboard` | — | admin/super_admin | not-SMM (cross-cutting KPIs) |
| 2 | Inspo Board | `/admin/inspo` | pipeline, sources, review, import, candidates, training, suggest, recreate | admin (also editor via `/editor/inspo`, creator via `/creator/[id]/inspo`) | **shared / cross-role** — owner has stated this STAYS top-level |
| 3 | AI Source | `/admin/recreate-source` | — (page has its own tabs) | admin | **SMM (AI stream)** — relabel to "AI Content" per owner |
| 4 | Editor | `/admin/editor` | editorview, review, postprep, grid, library, oftv, longform | admin (editor uses `/editor`) | **SMM (real stream + grid)** — primary consolidation target |
| 5 | Creators | `/admin/creators` | earnings, dna, communication | admin | not-SMM (CRM/profile) |
| 6 | Whale Hunting | `/admin/whale-hunting` | internal, team | admin | not-SMM (analytics) |
| 7 | Photo Library | `/photo-library` | — | admin, chat_manager | not-SMM (chat-team workspace) |
| 8 | Publer | `/admin/publer` | — | admin | **SMM (AI stream — Publer pipe)** |
| 9 | Onboarding | `/admin/onboarding` | — | admin | not-SMM (creator lifecycle) |
| 10 | Invoicing | `/admin/invoicing` | invoices, upload | admin | not-SMM (finance) |
| 11 | Inbox | `/admin/inbox` | tasks, chats, setup | admin + INBOX_OWNER_EMAILS | not-SMM (personal task aggregator) |
| 12 | Help | `/admin/help` | — | admin | not-SMM (docs) |

### Editor sidebar (2 items)

`EDITOR_NAV = [{ href: '/editor', label: 'My Dashboard' }, { href: '/inspo', label: 'Inspo Board' }]` (`app/admin/layout.js:59-62`).

**Note:** the EDITOR_NAV's Inspo Board points at `/inspo` (the canonical), not `/editor/inspo`. The editor lands on `/inspo` and the canonical page detects context. This is fine but inconsistent with the wrapper routes (`/editor/inspo` exists and is functionally identical).

### Chat-manager sidebar (1 item)

`CHAT_MANAGER_NAV = [{ href: '/photo-library', label: 'Photo Library' }]` (`app/admin/layout.js:64-66`). But the admin layout redirects `chat_manager` away from `/admin/*` to `/photo-library` (`app/admin/layout.js:128-130`), and `/photo-library` has its OWN layout (`app/photo-library/layout.js`) with no sidebar — the page is a full-bleed workspace. So the chat-manager effectively has no sidebar at all; the CHAT_MANAGER_NAV definition in admin/layout.js is dead code.

### AI-editor sidebar (0 items)

`isAiEditor ? [] : ...` (`app/admin/layout.js:148-149`). AI editor users are bounced to `/ai-editor` immediately and never see a sidebar.

---

## 3. Content Flow — Real Stream

The real-creator content stream from upload to Amin's Telegram inbox.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 1 — Creator uploads to Dropbox                                          │
│  Source: Creator submits via their dashboard → /api/creator-assets or       │
│          editor pulls from creator's Dropbox folder via                      │
│          /api/editor-upload-token                                            │
│  Actor: Creator                                                              │
│  Artifact: Assets row (tblAPl8Pi5v1qmMNM), Pipeline Status='Uploaded'        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 2 — Editor edits, uploads to Dropbox                                    │
│  Surface: /editor (editor's own surface) OR /admin/editor?tab=editorview    │
│  Editor picks a Task, downloads inspo reel, edits, uploads MP4 to Dropbox    │
│  → Assets.editedFileLink populated                                            │
│  → Tasks row (tblXMh2UznOJMgxl6) Status='Done',                              │
│     Admin Review Status='Pending Review'                                      │
│  Actor: Editor                                                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 3 — Admin reviews                                                       │
│  Surface: /admin/editor?tab=review (uses /api/admin/editor/review)          │
│   - Approve → flip Task.Admin Review Status='Approved',                      │
│              Asset.Pipeline Status='Approved'                                 │
│              + create one or more Posts (tblTEaiscTQQkEvj2) per IG account   │
│   - Reject → bounces back to editor's revision queue                         │
│  Actor: Admin                                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 4 — Post Prep (caption + hashtags + thumbnail)                          │
│  Surface: /admin/editor?tab=postprep (renders /admin/posts component)        │
│  Admin finalizes Caption, Hashtags, Thumbnail; status moves to 'Prepping'   │
│  Carousel review goes through /admin/editor?tab=carousels →                 │
│   app/admin/editor/CarouselSubmissionsReview.js                              │
│  Actor: Admin                                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 5 — Grid Planner (slot assignment)                                      │
│  Surface: /admin/editor?tab=grid → components/GridPlanner.js                │
│  Posts auto-normalized to canonical slots (today 11am/7pm ET) via            │
│  /api/admin/grid-planner. Channel (IG/FB) determines routing.               │
│  Actor: Admin                                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 6 — Enqueue to Telegram                                                 │
│  Surface: /admin/editor?tab=postprep button → /api/admin/telegram/enqueue  │
│  Bulk-marks Posts: Status='Queued for Telegram'                              │
│  Role-gated: requireAdminOrSocialMedia (lib/adminAuth.js:146-166)            │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 7 — Telegram cron drains queue                                          │
│  Cron: /api/cron/telegram-queue (every minute, 1 post/tick)                 │
│   - Claims via Status='Sending' + Sending Since                              │
│   - Looks up Palm Creator.Telegram IG/FB Topic ID based on Post.Channel     │
│   - Sends video + caption to Telegram thread                                  │
│   - Stamps Telegram Sent At, Status='Sent to Telegram'                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 8 — Amin posts manually to creator's REAL IG/FB                         │
│  Surface: Telegram chat (no in-app UI)                                       │
│  Actor: Amin (social_media role) — about to be repurposed                   │
│  Eventually marked 'Posted' (Posted At stamp) manually                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Owner / role traversal:** Creator → Editor → Admin → Telegram cron → Amin.
**Where it exits the system:** Telegram message + manual post by Amin.

---

## 4. Content Flow — AI Stream

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 1 — Inspo Board scrape feeds the source pool                            │
│  Surface: /admin/inspo?tab=pipeline + ?tab=sources                          │
│  Reels get promoted to the Recreate pool via /admin/recreate-source         │
│  Actor: Admin                                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 2 — AI editor picks reels in TJP, runs image-to-image                   │
│  Surface: /ai-editor → Workspace tab                                         │
│  Picks creator + inspo reel → downloads (starts Recreate Project) →          │
│   does TJP image-to-image in WaveSpeed (Nano-Banana 2, Wan 2.7, GPT-Image-2) │
│   producing scene photo                                                       │
│  Actor: AI Editor                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 3 — Create Scene (portal render)                                        │
│  Surface: /ai-editor → Create Scene tab                                      │
│  Uploads TJP photo → /api/admin/recreate-rooms/stage-b/start                 │
│  Portal renders the scene (3-6 min). Approval flips Asset to ready-for-TJP. │
│  Actor: AI Editor                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 4 — TJP outfit + motion + final video                                   │
│  Surface: External TJP tool (outside portal)                                 │
│  AI editor returns with finished MP4 + optional thumbnail                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 5 — Batch upload                                                        │
│  Surface: /ai-editor → Workspace → Batch Upload                              │
│  /api/ai-editor/upload creates Assets (Pipeline Status='In Review',          │
│   Source Type='AI Generated') + Tasks (Admin Review Status='Pending Review') │
│  CAROUSELS: /ai-editor → Carousel tab → /api/admin/carousel-projects         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 6 — Admin reviews (same queue as real stream)                           │
│  Surface: /admin/editor?tab=review for reels,                                │
│           /admin/editor?tab=carousels for carousels                          │
│   - Reel approval → Posts created                                            │
│   - Carousel approval handled in CarouselSubmissionsReview.js                │
│  This is the FIRST place where real and AI streams converge.                 │
│  Actor: Admin                                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 7 — Post Prep + Grid Planner                                            │
│  Surface: /admin/editor?tab=postprep + ?tab=grid                            │
│  Same components as real stream — Channel (IG/FB) drives routing            │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 8 — Routing decision at enqueue                                         │
│  Lookup: Publer Accounts (tblGDhVY73UT2gLSW) by (Creator, Channel)          │
│   - If Account Type='AI' AND Status='Active' → /api/admin/publer/enqueue   │
│     (Status='Queued for Publer', Pipeline Target='Publer')                  │
│   - Else → /api/admin/telegram/enqueue                                       │
│  Mixed-type Posts rejected at enqueue.                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 9 — Publer crons (Phase 1+2 shipped, draft-only)                        │
│  /api/cron/publer-queue (every min): URL-imports media, submits envelope     │
│   state='draft', stamps Publer Job ID + Publer Status='Submitted'           │
│  /api/cron/publer-job-poll (every 5 min): polls /job_status/{id},           │
│   parses payload.failures[], transitions to Scheduled / Failed              │
│  Currently STAGED — no real publishing yet (Phase 3 flips draft → scheduled) │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 10 — (Future) Publer publishes to dedicated AI IG/FB accounts          │
│  Phase 3+: live scheduling with jitter, caption/hashtag rotation,           │
│  monitoring dashboard                                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Owner / role traversal:** Admin → AI Editor → Admin → Cron → Publer → AI accounts (no human posting role).
**Where it exits the system:** Today — nowhere (drafts in Publer). Phase 3+ — auto-published to dedicated AI IG/FB accounts.

**Convergence point:** Step 6 (Admin Review) is the single shared chokepoint between real and AI streams. Steps 7-8 use literally the same UI components — only the enqueue button differs at the end.

---

## 5. Proposed Consolidated Sidebar

I commit to one shape. Defense follows.

```
ADMIN SIDEBAR (new)
├── Dashboard                                       /admin/dashboard
├── Inspo Board                                     /admin/inspo
│   └── (existing 8 tabs — leave alone)
├── Social Media Management                         /admin/smm                ← NEW PARENT
│   ├── Overview                                    /admin/smm
│   ├── Review Queue                                /admin/smm?tab=review
│   ├── Post Prep                                   /admin/smm?tab=postprep
│   ├── Carousels                                   /admin/smm?tab=carousels
│   ├── Grid Planner                                /admin/smm?tab=grid
│   ├── AI Content                                  /admin/smm?tab=ai-content (alias of /admin/recreate-source)
│   ├── Outbound — Real (Telegram)                  /admin/smm?tab=outbound-real
│   ├── Outbound — AI (Publer)                      /admin/smm?tab=outbound-ai
│   ├── Account Warm-Up                             /admin/smm?tab=warmup     ← NEW
│   ├── Content Strategy                            /admin/smm?tab=strategy   ← NEW
│   ├── Publer Mappings                             /admin/smm?tab=publer
│   ├── Creator Library                             /admin/smm?tab=library
│   ├── OFTV Projects                               /admin/smm?tab=oftv
│   └── Long Form Upload                            /admin/smm?tab=longform
├── Creators                                        /admin/creators
│   └── (existing 3 children)
├── Whale Hunting                                   /admin/whale-hunting
│   └── (existing 2 children)
├── Onboarding                                      /admin/onboarding
├── Photo Library                                   /photo-library
├── Invoicing                                       /admin/invoicing
│   └── (existing 2 children)
├── Inbox                                           /admin/inbox  (owner only)
└── Help                                            /admin/help
```

### What collapses

The current 12-item admin sidebar drops to **10 items.** Specifically:

| Old entry | Disposition |
|---|---|
| Editor (with 7 children) | **Folded into SMM** — its 7 children become SMM children |
| AI Source | **Folded into SMM** as "AI Content" (route stays at `/admin/recreate-source`, label changes per owner) |
| Publer | **Folded into SMM** as "Publer Mappings" sub-node |
| Dashboard | Stays top-level (operator KPI surface, not SMM-scoped) |
| Inspo Board | **Stays top-level** (owner mandate; cross-role with editor + creator) |
| Creators | Stays top-level (CRM/profile, not SMM-scoped) |
| Whale Hunting | Stays top-level (analytics) |
| Photo Library | Stays top-level (chat-manager primary surface, admin-shared) |
| Onboarding | Stays top-level (creator lifecycle) |
| Invoicing | Stays top-level (finance) |
| Inbox | Stays top-level (personal task aggregator, evan-only) |
| Help | Stays top-level (docs) |

### What's new under SMM

- **Account Warm-Up** — per AI account, day-counter against the 90-day playbook (Brielle Day N, Lily Day N, Katie Rosie Day N). Today's tasks (bio update, story slot, like quota, when to authorize Publer, etc.). Per owner vision.
- **Content Strategy** — answers "what carousel/reel next for [creator]?" from the library — pillar rotation, variation tracking.
- **Outbound — Real (Telegram)** — replaces the current Telegram send-modal inside Post Prep with a dedicated outbound view showing what's queued, sent, failed. Also gives Amin's manual-post bridge a home (per owner: "today at 2pm post this to @handle" list driven by warmup schedule).
- **Outbound — AI (Publer)** — replaces ad-hoc Publer dashboard. Per-account scheduled / published / failed counts, last error, reach trend, token expiry countdown (per Phase 3 scope in publer-ai-scheduler.md §3.3). Today Publer-the-link is the mapping screen only — promote it.

### Why this shape (not alternatives)

1. **Single SMM parent, flat children list (not nested groups).** The owner's wording is "one Social Media Management parent." Nested groups (Real / AI sub-folders) feel cleaner on paper but force the operator to keep mental context — and the operator's workflow is the *same actions on different streams* (review → prep → grid). Keep actions at the same depth; let the stream-specific outbounds be separate leaves.
2. **AI Content stays at /admin/recreate-source.** Per owner: route stays, label changes. The route name is ugly but renaming routes breaks bookmarks, in-app links, and the AI editor's understanding.
3. **Inspo Board stays out.** Owner mandate, and operationally correct: Inspo Board is the *input* (research) to SMM, used by editor + creator + admin. Mixing it into SMM creates role-bleed (creators don't have an SMM role).
4. **Editor as a top-level disappears.** The "Editor" entry today is an admin's view of editor work. The real editor uses `/editor`. Folding the admin face into SMM removes a role-naming collision (the admin nav item called "Editor" was always slightly miscast — it's really "the editing pipeline I oversee" not "I am an editor").

---

## 6. Role Access Matrix

For the **new SMM sub-tree**. Server-side gating in `lib/adminAuth.js` is the source of truth; sidebar filtering is courtesy.

| Sub-node | admin / super_admin | editor | ai_editor | social_media | chat_manager | Notes |
|---|---|---|---|---|---|---|
| Overview | visible | visible (filtered to editor's queue) | hidden | visible (filtered to today's posts) | hidden | Role-aware landing view |
| Review Queue | visible | visible | hidden | hidden | hidden | Real-content review + AI-content review (admin sees both; editor sees real revisions) |
| Post Prep | visible | hidden | hidden | hidden | hidden | Admin-only — caption/hashtag/thumb is admin gate |
| Carousels | visible | visible (carousel review only) | hidden | hidden | hidden | Editor reviews carousels in their lane |
| Grid Planner | visible | hidden | hidden | read-only (today + tomorrow only) | hidden | SMM can see queue, can't reorder. Admin owns Grid. |
| AI Content | visible | hidden | visible (sub-set: library + photos, not freeform admin tools) | hidden | hidden | This is the recreate-source surface relabeled |
| Outbound — Real (Telegram) | visible | hidden | hidden | visible (Amin's primary surface during transition) | hidden | This is where Amin sees "post this to @handle today at 2pm" |
| Outbound — AI (Publer) | visible | hidden | hidden | hidden | hidden | Phase 3 dashboard |
| Account Warm-Up | visible | hidden | visible (read-only: what content is needed today) | visible (manual-post bridge: today's tasks for Amin) | hidden | The single most cross-role new surface |
| Content Strategy | visible | hidden | visible (sees "what's next for Amelia in TJP") | hidden | hidden | AI editor's planning view |
| Publer Mappings | visible | hidden | hidden | hidden | hidden | Admin-only — credentials surface |
| Creator Library | visible | visible | hidden | hidden | hidden | Existing surface, role-shared |
| OFTV Projects | visible | visible | hidden | hidden | hidden | Existing surface |
| Long Form Upload | visible | visible | hidden | hidden | hidden | Existing surface |

**Note on enforcement:** server-side gating already supports admin / editor / ai_editor / social_media / chat_manager. The sidebar filter just consults `user.publicMetadata.role` and applies the matrix above. Direct-URL access to a hidden tab returns the 403 page from the corresponding API.

**Specific role landing pages:**
- `admin` → `/admin/dashboard` (unchanged)
- `editor` → `/editor` (unchanged) but Inspo Board still surfaces at `/inspo`
- `ai_editor` → `/ai-editor` initially, then `/admin/smm?tab=ai-content` once their views are migrated. **Note:** today `ai_editor` is hard-blocked from all `/admin/*` paths (`app/admin/layout.js:84` `aiEditorAllowedPath = false`). The SMM consolidation needs to flip this for the new AI-Content + Warm-Up + Strategy sub-tabs.
- `social_media` → `/admin/smm?tab=outbound-real` (new — they currently have no landing page)
- `chat_manager` → `/photo-library` (unchanged)

---

## 7. Scatter & Duplication Issues

Concrete pain points the current nav causes:

1. **AI workflow is in three places and labeled inconsistently.**
   - `/admin/inspo?tab=recreate` — AI Recreate planning tab
   - `/admin/recreate-source` — labeled "AI Source" (about to be "AI Content")
   - `/ai-editor` — TJP three-tab workspace (admin can hit by URL only)
   - `/ai-editor/recreate` — alternate entry point
   - Admin can't get to `/ai-editor` from the sidebar at all. Owner has to remember the URL.

2. **Editor and AI editor live in separate "ghettos."** Both produce Assets → Tasks that converge at `/admin/editor?tab=review`. The shared review surface is good. The **upstream** workflows have ZERO sidebar adjacency:
   - Editor sees `/editor` (My Dashboard, Revisions, OFTV)
   - AI Editor sees `/ai-editor` (Workspace, Create Scene, Carousel)
   - An admin overseeing both has to context-switch URLs constantly.

3. **Sidebar children for "Editor" don't match the page's actual tabs.** Sidebar lists 7 (editorview, review, postprep, grid, library, oftv, longform). The page now has 9 (adds Submissions + Carousels — `app/admin/editor/page.js:2640-2650`). Sidebar is stale by 2 entries.

4. **Sidebar children for "Creators" don't match the per-creator page tabs.** Sidebar shows earnings/dna/communication, but the per-creator page shows profile/documents/tags/music/superclone/adjustments (`app/admin/creators/page.js:2487`). Different vocabularies for the same destination.

5. **Three `social_media`-gated APIs have no caller** — `sm-workspace`, `sm-requests`, `sm-requests/[id]/complete-account`. Only `sm-grid/mark-scheduled` is wired (from `components/GridPlanner.js:2299`). The vestigial endpoints suggest a previous attempt at an SMM dashboard that was abandoned. Don't try to revive — build fresh into SMM.

6. **Inspo Board's "AI Recreate" tab (`/admin/inspo?tab=recreate`) overlaps with `/admin/recreate-source`.** Both manage the AI recreate pool. Confusing dual-entry; recreate-source is the live one.

7. **/admin/tonio** — looks like a one-off "Hi Tonio 👋" greeting page (`app/admin/tonio/page.js`, 27 lines). No nav entry, no role check beyond admin layout. Probably abandoned demo.

8. **/sonnet-test, /demo, /admin/suggest-test, /admin/training, /admin/candidates** — all of these are admin-only utility surfaces with no sidebar entry, accessible only by direct URL or as Inspo tabs. Some are useful (suggest-test, training are Inspo Board components), some are testing scratchpads (sonnet-test, demo).

9. **/creator/[id]/vault is a stub** ("Coming soon", 9 lines). Either ship it or remove it from the routing — currently sits in the creator surface as a dead link.

10. **Sidebar active-state logic for Inspo Board is hand-rolled and fragile** — `app/admin/layout.js:261-262` lists hard-coded paths `/admin/sources`, `/admin/review`, `/admin/import` that trigger Inspo active state. When more tabs got added to Inspo (candidates, training, suggest, recreate), the active-state check wasn't updated. Navigating to `/admin/candidates` shows no sidebar highlight.

11. **`/admin/posts` is an importable component, not a real route.** It works as a page when visited but is designed to be embedded in `/admin/editor?tab=postprep` (`app/admin/editor/page.js:7`). The fact that it has its own URL just means it's accidentally a route. Keep it embedded.

12. **EDITOR_NAV's Inspo Board target is `/inspo`, not `/editor/inspo`.** Both routes work and render the same UI, but the wrapper at `/editor/inspo` exists (`app/editor/inspo/page.js`) and is unused by the nav. Either delete the wrapper or use it consistently.

13. **Photo Library lives at `/photo-library`, not under `/admin/*`** — yet it's in the admin sidebar AND has its own layout that bypasses the admin sidebar. The sidebar entry takes you out of admin chrome. Not broken, but inconsistent.

14. **Chat-manager's CHAT_MANAGER_NAV is dead code.** Defined in `app/admin/layout.js:64-66` but chat managers are bounced from `/admin/*` to `/photo-library` (which has its own layout, no sidebar). The NAV definition is never rendered.

---

## 8. Open Questions for the Owner

1. **Account Warm-Up sub-node — does the operator (you / Amin / a future SMM strategist) need a per-account day counter that's interactive (mark today's tasks complete), or is it a read-only "what to do today" feed?** Determines whether we add a Warm-Up Tasks Airtable table (additive — allowed under hard constraints) or compute everything from the Publer Accounts.Connected At date + a static playbook.

2. **Content Strategy sub-node — who's the primary user?** Three plausible answers, very different builds: (a) AI editor "what reel should I pull into TJP for Amelia next?", (b) admin/operator "what's the pillar mix for Brielle next 7 days?", or (c) the future-internal-hire-replacing-Amin "what's the cross-creator content calendar?"

3. **Outbound — Real (Telegram) — do you want Amin's role (`social_media`) to also have a write surface (e.g. mark-as-posted), or does Telegram message thread remain the only acknowledgement?** Affects whether the page is read-only for him during the transition.

4. **`/admin/inbox` placement** — today's Inbox is iMessage + Telegram bot heartbeat tasks. Is this conceptually SMM-adjacent (creator comms) or operator-personal (your evan-only commitments)? It's the only `ownerOnly` entry in the sidebar today; my read is it stays top-level and out of SMM, but confirm.

5. **`/admin/whale-hunting` placement** — pure analytics today. Once Phase 3 of Publer ships its monitoring dashboard, the reach-trend / token-expiry view will live under SMM. Should the whale analytics also migrate, or stay independent?

6. **`/admin/recreate` (the Inspo Board "AI Recreate" tab) vs `/admin/recreate-source` (the AI Source page)** — are both still actively used, or has recreate-source supplanted the Inspo tab? If the Inspo tab is stale, remove the duplicate.

7. **`ai_editor` access to SMM** — today `app/admin/layout.js:84` hard-blocks `ai_editor` from `/admin/*` (after a prior accidental exposure). The SMM consolidation needs to flip the policy: ai_editor should see SMM with AI-Content + Account Warm-Up + Content Strategy visible. Confirm this is the intended scope.

8. **Amin transition window** — the constraint doc says "Amin must keep working until Publer fully replaces him." Does that mean: keep the Telegram pipe live for ALL real-content posts indefinitely, or also for AI-content posts during their Days 1-22 warm-up window before Publer is authorized? Phase 2 of the AI playbook (`publer-ai-account-creation-playbook.md` day 23) says Publer is authorized Day 23 — implying days 1-22 some other actor (Amin?) is doing the manual posting from the Pixel.

9. **`/creator/[id]/vault`** is a "Coming soon" stub. Kill it from routing or ship the feature? It's leaking a dead nav link into the creator surface.

10. **Editor's per-creator surface (`/editor/[creatorId]`)** isn't in any sidebar — only reachable via drilldown from the editor dashboard. Does this need an SMM sub-node, or stay as a drill-only path?

---

## Appendix — Tables touched by SMM stream

| Table | ID | SMM relevance |
|---|---|---|
| Palm Creators | tbls2so6pHGbU4Uhh | Source of truth for creator + Telegram topic IDs |
| Posts | tblTEaiscTQQkEvj2 | The artifact that moves through the pipeline |
| Assets | tblAPl8Pi5v1qmMNM | The media file (Dropbox link + Cloudflare Stream/Images mirror) |
| Tasks | tblXMh2UznOJMgxl6 | The editing/review unit (carries Admin Review Status) |
| Photos | tblUXDbaZGYGf2E5O | AI generation outputs (Source Type='AI Generated') |
| Carousel Projects | tblU1yON9P7zQljYM | AI carousel planning unit |
| Publer Accounts | tblGDhVY73UT2gLSW | NEW (created 2026-05-27). Routing decision SoT for AI vs Real |
| Recreate Reels | tblgKIecr9rdn8M60 | The AI pool — what's been scraped and is available for TJP |

For the SMM consolidation, only **additive** Airtable changes are permitted (per constraints in `00-research-scope.md`). Adding a `Warm-Up Tasks` table or a `Content Strategy Pillar` field to `Palm Creators` would be in-bounds. Renaming any existing field is not.
