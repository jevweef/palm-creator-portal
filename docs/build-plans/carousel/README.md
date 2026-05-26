# Carousel Feature Build Plan

This folder is the build spec for adding carousel (multi-photo) posts to the Palm Creator Portal. Each numbered step below is a separate file with detail, prereq reads, what to check, and how to verify. Execute in order. **Read this README all the way through before touching anything.**

## Confirm 3 things with the user before you build anything

1. **Caption** — leave optional/blank-OK for v1; auto-suggest is a separate phase 2 build. Confirm.
2. **AI carousel recreation For Review scaffold** — not in scope for this build (the generator doesn't exist yet). Confirm.
3. **Distribution** — round-robin assigns each ready item to either IG or FB, alternating. Different content per channel, never the same item duplicated to both. Confirm.

## Architecture (memorize this before building)

The Grid Planner today does two things: it's where creative work gets finished AND where posts get distributed/sent. We're splitting that.

- **Upstream creative work** happens in `/admin/editor`:
  - Reels: editor uploads → For Review → admin approves → tagged `Type=Reel, Status=Ready to Go`
  - Carousels: admin assembles in **new Carousels tab** → submit → tagged `Type=Carousel, Status=Ready to Go`
- **Grid Planner becomes a visualizer + distributor + sender only.** No assembly inside it. It pulls from `Status=Ready to Go`, auto-distributes evenly across each creator's IG + FB columns (round-robin FIFO), shows Type badge per tile, and routes to the right send path.

A carousel is a Post with `Type=Carousel`, its `Asset` field linked to N photo Asset records (1-10, ordered). No video. No thumbnail. The Telegram send route detects `Type=Carousel` and calls `sendMediaGroup` with N `InputMediaPhoto` items instead of the video+thumbnail path.

## Build order (each step is a file)

1. [`01-airtable-schema.md`](./01-airtable-schema.md) — Add `Creator Upload` source type, `Type` field on Posts, `Ready to Go` status
2. [`02-make-webhook.md`](./02-make-webhook.md) — Stamp `Source Type = Creator Upload` on creator Dropbox photo arrivals
3. [`03-carousels-tab.md`](./03-carousels-tab.md) — Build the Carousels tab UI in `/admin/editor`
4. [`04-reel-approval.md`](./04-reel-approval.md) — Patch reel approve handler to also set `Type=Reel, Status=Ready to Go`
5. [`05-grid-planner-refactor.md`](./05-grid-planner-refactor.md) — Pull from Ready to Go, round-robin distribute, Type badges, Preview Slides modal
6. [`06-telegram-send-cron.md`](./06-telegram-send-cron.md) — Carousel send branch (`sendMediaGroup`), pass Type through cron

After each numbered step: tell the user one line — what you did, what you're testing next.

## Always-on rules

[`gotchas.md`](./gotchas.md) — read it. React Hooks rule, linked records as string arrays, ET time conventions, bot/group IDs, the Thumbnail Asset deterministic-flip pattern that must not break.

## Branch + deploy

- All work on `dev` branch
- Push to dev after each step, test on Vercel preview URL
- Do NOT merge to main without explicit user approval (cron runs on prod main only — merging blind risks breaking the live queue)

## Out of scope

- Auto-caption AI feature (separate phase 2 build)
- Visual similarity auto-grouping of creator photos (phase 2)
- AI carousel recreation pipeline (separate build, not started)
- Mobile-specific tweaks beyond what currently exists
