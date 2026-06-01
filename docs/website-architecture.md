# Palm Creator Portal — Website Architecture (Master Doc)

> **Purpose.** Living reference for how the admin portal is built — every section, what it
> does, and the data behind it. Keep this current: whenever a session changes files under
> `app/` or `docs/build-plans/`, update the affected entry here (enforced via the living-doc
> hook in `.claude/settings.json`).
>
> **Last updated:** 2026-05-30.

## Stack

- **Framework:** Next.js 14.2.x, App Router, JavaScript (not TS)
- **Styling:** Tailwind CSS 4 + inline styles; Framer Motion for animation; no external UI lib
- **Data:** Airtable REST API (base `applLIT2t83plMqNx`), via `lib/adminAuth.js`
  (`fetchAirtableRecords()` :204, write helpers; `requireAdmin()`/`requireAdminOrEditor()` auth)
- **Auth:** Clerk, role-based via `publicMetadata.role`
  (super_admin, admin, editor, ai_editor, chat_manager, creator)
- **Media:** Cloudflare Images + Stream · **Scheduling:** Publer · **Messaging:** Telegram
- **Background jobs:** Vercel cron (`vercel.json`, `app/api/cron/*`, gated by `CRON_SECRET`)
- **Separate repo:** `pipeline/` is the nested `jevweef/inspo-pipeline` (GitHub Actions, Python)

## Navigation

Top-level nav defined in `app/admin/layout.js` (`ADMIN_NAV`). Sidebar items are role-gated;
some are owner-only (`OWNER_ONLY_EMAILS`). The SMM hub (`/admin/social`) uses an internal
`SECTIONS` array with subtabs routed via `?tab=&sub=` query params — the pattern to mirror
for new multi-section areas.

## Admin sections (`app/admin/`)

| Section | What it does |
|---|---|
| **account-warmup** | 90-day AI-account trust-building workflow: daily tasks, engagement quotas, bio/link timing, Publer handoff checkpoints |
| **candidates** | Prospect/influencer reviewer; bucket by follower tier, track dismissals, one-click "Add to Portal" |
| **creators** | Creator database dashboard: search/filter by status, commission %, earnings; profile analysis; offboard; fan/whale tracker |
| **dashboard** | Admin home: urgent inbox tasks, revenue metrics, creator status, KPIs |
| **editor** | Content pipeline hub (submissions, library, grid planner, carousels, OFTV/long-form, post prep, revisions); day-counter task queue |
| **help** | Interactive help center: step-by-step workflow walkthroughs |
| **import** | IG/TikTok export parser: drag-drop JSON → extract reel/photo URLs → Inspo Board |
| **inbox** | Tasks (commitments extracted from Telegram) + Chats (which Telegram groups the bot monitors); owner-only |
| **inspo** | Inspiration board hub: raw reels → analysis → promotion → human review (pipeline/sources/review/import/candidates/training/suggest/recreate) |
| **invoicing** | Creator earnings invoices: status, commission calc, PDF gen, payment tracking |
| **marketing-content** | Social overview dashboard: KPI tiles + quick links (review/approve, strategy/setup, outbound) |
| **onboarding** | Creator intake wizard (name, email, commission %, state, contract, voice memo); status tracking |
| **posts** | Post approval & prep grid: filter by creator/platform/status; edit captions; send to Telegram (Amin/real) or Publer (AI) |
| **publer** | Publer account mapping: sync Publer accounts into Airtable, pair with Palm Creator, tag Real/AI |
| **recreate** | AI content asset generation: pick inspo thumb → gen mode → image-to-video (Kling/Nano Banana) → review → save |
| **recreate-source** | AI Content hub (Setup/Workflow/Strategy): per-creator AI recreate settings, asset library, editor workspace |
| **review** | Inspo reel reviewer: swipe + grade (A+…F), assign to creators, voice-memo notes |
| **social** | **Unified SMM hub** (launched 2026-05-29): Overview / Content / Accounts & Setup / Outbound. Replaces scattered SMM pages. See `docs/build-plans/SMM-CONTENT-REDESIGN/` |
| **sources** | Raw inspo sources: Apify-scraped IG accounts, status, sortable/searchable |
| **suggest-test** | Caption-generation playground: pick reel + mode → generate on-screen text suggestions |
| **tonio** | Personal dashboard placeholder (contractor) |
| **training** | Content training/analysis: brand voice, content pillars, DNA direction; per-creator ML dataset |
| **whale-hunting** | Aggregated fan intelligence (Palm Internal + Chat Team Report): high-value fan analysis |

## API routes (`app/api/`)

- **Admin data:** `app/api/admin/*` — gated with `requireAdmin()`/`requireAdminOrEditor()`,
  read via `fetchAirtableRecords()`. Representative: `app/api/admin/oftv-projects/route.js`.
- **Telegram:** `app/api/telegram/send/route.js` (media-aware send), `app/api/inbox/telegram/`
  (webhook receiver), `app/api/admin/telegram/*` (chat-id discovery, bulk-unsend).
- **Cron:** `app/api/cron/*` (e.g. telegram-queue every minute, generate-invoices monthly,
  mirror-* media syncs) — all check `CRON_SECRET`; schedules in `vercel.json`.

## Key shared modules

- `lib/adminAuth.js` — Airtable client + auth guards (the backbone of every admin feature)
- `app/admin/social/_components/` — `HubSection`, `FilterBar`, `Segmented`, `EmptyState`,
  `CreatorPicker` (reusable SMM primitives; reuse for new sections)
- `lib/sendPushNotifications.js` — web-push (VAPID); `lib/oftvTelegram.js` — OFTV notifications

## Airtable base (`applLIT2t83plMqNx`)

40 tables. Core: Palm Creators, Creator Platform Directory, Assets, Posts, Tasks,
Inspiration, Inspo Sources, Source Reels, OFTV Projects, Telegram Chats/Messages, Inbox
Tasks, Account Stats, Publer Accounts, AI Account Profile, Warmup Tasks, Invoices, Push
Subscriptions, and the AI-recreation tables (Recreate Sources/Reels/Rooms, Stage B Outputs,
Outfit Closet/Swap, Photos/Photo Accounts, Carousel Projects). (Research Briefs / Research
Findings to be added for the research pipeline.)

## In-flight work

- **SMM hub redesign** (`smm-hub-redesign` branch, `docs/build-plans/smm-consolidation/`):
  Phases 1–7 built; final QA + merge to dev pending.
- **Research pipeline** (this initiative): `scripts/yt_transcript.py`, `scripts/clipto_import.py`,
  `scripts/yt_discover.py`, `research/`, and a forthcoming `/admin/research` tab.
