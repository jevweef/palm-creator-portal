# Batch 5 — Handoff (final batch)

**Branch:** `smm-consolidation`
**Date:** 2026-05-27
**Build:** `next build` passes clean.
**Airtable changes:** 1 new field (additive, lazy-created on first use).

## What shipped

### 1. Carousel per-slide rejection (Phase 2.5 from the original Publer plan)

In **Editor → For Review** carousel cards, hovering any slide thumbnail now reveals a red ✕ button in the top-right. Clicking it opens an inline reject panel under the carousel with:

- Optional reason textarea (used when bouncing)
- **"Remove only this slide"** — flips just that photo to `Review Status='Rejected'`. Siblings stay Pending. Operator can re-approve the batch with one fewer slide.
- **"Bounce whole carousel"** — equivalent to the full-batch reject, plus stamps the optional reason onto the linked `Carousel Project.Rejection Reason` field (lazy-created on first use via typecast).

### 2. Marketing Content quick links — grouped

The flat 6-link quick-links section on the Marketing Content hub is now grouped into three labeled sections to match operator workflow:
- **Review & Approve** — For Review · Post Prep · Carousels · OFTV Projects
- **Strategy & Setup** — AI Content · Account Warm-Up · Content Strategy · Creator Library
- **Outbound** — Grid Planner · Publer Mappings

(Directly addresses your earlier note: "I do like the marketing content quick links. I don't think they're organized enough.")

## What's deferred from the original Batch 5 plan

The synthesizer scoped Batch 5 to also include:
- **Schedule jitter (±15-25 min)** in `publer-queue` cron. **Defer rationale:** the cron still ships posts with `state='draft'` (Phase 1+2 baseline). Jitter only matters when state flips to `'scheduled'`. Build alongside that flip.
- **Caption template rotation / Hashtag pool rotation / Banned-hashtag denylist enforcement.** **Defer rationale:** needs the schema tables that I deferred from Batch 3 (Caption Templates, Hashtag Pools, Hashtag Denylist). All these ship together when you lock the pillar taxonomy + per-creator content plan structure.
- **Monitoring dashboard** (scheduled / published / failed counts, reach trend, token expiry countdown). **Defer rationale:** needs Publer Phase 3 to be live for any non-zero data to display. The hub's KPI tiles already show baseline counts (in-flight, needs-review, active warm-ups) from existing schema.
- **Email alerts** (failed publish, reach drop ≥40%/24h, token expiring <7d). **Defer rationale:** needs the monitoring dashboard's data + an email provider integration (Resend / Postmark / SES). Self-contained future sprint.
- **Symmetric `Pipeline Target` validator on `telegram/enqueue`**. **Defer rationale:** the validator exists in code only as a defensive guard. Not load-bearing today since the AI flow can't enqueue into Telegram by construction.

These are all "Phase 3+" items that gain real value only after the AI accounts pass Day 90 and Publer actually starts auto-scheduling. Foundation is in place — flip the cron state from `'draft'` to `'scheduled'` when ready and the rest can be built incrementally.

## Files added/modified

```
M app/admin/editor/CarouselSubmissionsReview.js      (✕ overlay + inline reject panel + dual-mode handler)
M app/api/admin/photos/carousel-submissions/route.js (action='reject-slide' branch with remove/bounce modes)
M app/admin/marketing-content/page.js                (grouped quick links)
+ docs/build-plans/smm-consolidation/batch-5-handoff.md  (this file)
```

Plus the Airtable additive (lazy-created on first bounce-with-reason):
- `Carousel Projects` · new field `Rejection Reason` (single-line text via typecast)

## Test plan

Dev server: http://localhost:3001 (still running). Vercel preview also rebuilds on push.

### Per-slide rejection
1. Editor → For Review. Find an AI Carousel Submission (or create one via the AI editor flow).
2. Hover a slide thumbnail — see the red ✕ in the top-right.
3. Click ✕ → inline panel opens under the carousel with reason textarea + two buttons.
4. **"Remove only this slide"** → that thumbnail disappears from the grid; the batch stays in the queue with one fewer slide. Re-approve as normal.
5. **"Bounce whole carousel"** with a reason filled in → the whole batch leaves the queue (same as before), and the linked Carousel Project gets `Status='Rejected'` + `Rejection Reason='<your text>'`.

### Marketing Content
1. Click Marketing Content sidebar entry.
2. Confirm the 4 KPI tiles still load.
3. Confirm the quick links now sit in 3 labeled groups (Review & Approve / Strategy & Setup / Outbound) rather than a flat list.

## Rollback

```
cd /Users/jevanleith/palm-creator-portal
git worktree remove ../palm-creator-portal-smm
git branch -D smm-consolidation
git push origin :smm-consolidation
```

The `Rejection Reason` field on Carousel Projects can be deleted from the Airtable UI if you want a clean slate.
