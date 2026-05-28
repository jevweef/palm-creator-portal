# Batch 5 — Publer Phase 3

**Status:** READY AFTER BATCHES 1-4 LAND
**Branch:** `smm-consolidation`
**Estimated time:** 30-40 hours
**Airtable changes:** NONE (built on schemas from Batches 2-4)
**Predecessor:** master-plan.md, batches 1-4, `docs/build-plans/publer-ai-scheduler-phase1-2-handoff.md`

## Goal

Flip Publer from draft-only (Phase 1+2 already shipped) to live scheduled publishing, with all the anti-pattern hygiene the agency needs to avoid Meta dedup / pattern-detection: ±15-25 min schedule jitter, caption template rotation (wired to Batch 3's tables), hashtag pool rotation + denylist enforcement (wired to Batch 3), per-account monitoring dashboard, email alerts on failures + token-expiry, symmetric Pipeline Target validator on telegram/enqueue (close the existing gap), and Phase 2.5 carousel per-slide rejection UI.

## Prerequisites

- [ ] Batches 1-4 merged into branch and owner-approved.
- [ ] At least one AI account past Day 23 (Publer authorized).
- [ ] Publer dashboard shows the account as live (not in maintenance).
- [ ] `RESEND_API_KEY` (or whatever's wired) confirmed in env. (Audit B speculated Resend/Postmark — verify which actually exists by reading `lib/email.js` or similar before Batch 5 starts.)

## Schedule jitter (±15-25 min)

### Min (ship this)

One-line change in `app/api/cron/publer-queue/route.js` `buildEnvelope`. Pseudo-random offset of `[-25, +25]` minutes added to `scheduled_at`. Seed by `${postId}-${date}` for stable re-runs:

```
function jitterOffset(postId, dateIso) {
  const seed = hashString(`${postId}-${dateIso.slice(0, 10)}`);
  const minutes = -25 + (seed % 51);  // -25 to +25 minutes
  return minutes * 60 * 1000;  // milliseconds
}

const scheduledAt = new Date(post.scheduledDate.getTime() + jitterOffset(post.id, post.scheduledDate));
```

Also flip `state: 'draft'` to `state: 'scheduled'` in the same envelope (Phase 2 → 3 transition, per handoff doc).

### Max (defer)

Per-account "natural posting time histogram" — track historical post times in the prior 14 days, bias jitter toward that distribution. Avoids the model fingerprinting on consistent "11:00 + 17 min" pattern.

**Verdict: ship Min only in Batch 5.** Max is a 60-days-of-data polish pass.

### Files touched
- `app/api/cron/publer-queue/route.js` — jitter helper + state flip.

## Caption template rotation

### Min (ship this)

Already designed in Batch 3 (`Caption Templates` table with `Used At` round-robin). Wire it into the publer-queue cron:

When the cron picks up a Post with `Pipeline Target = 'Publer'` and `Caption` empty (or `Caption = 'TEMPLATE_REQUESTED'`), call `lib/contentEngine.selectCaption({ accountProfileId, pillar: post.pillar, postType: post.postType })`. Stamp the Posts row with the chosen caption before submitting to Publer.

For posts where Caption is already populated (operator override or content engine pre-fill in Batch 3), use as-is.

### Files touched
- `app/api/cron/publer-queue/route.js` — pre-submit caption hook.

## Hashtag pool rotation + denylist

### Min (ship this)

Wire `lib/contentEngine.selectHashtags` (from Batch 3) into publer-queue. Same pattern: if Posts.Hashtags is empty, call selectHashtags + denylist check.

### Banned-tag enforcement

The denylist is the `Hashtag Denylist` Airtable table from Batch 3 (owner-editable). publer-queue calls `selectHashtags` which already enforces. No new code in this batch — just confirm the wiring.

### Files touched
- `app/api/cron/publer-queue/route.js` — pre-submit hashtags hook.

## Monitoring dashboard

### Min (ship this)

New surface: `/admin/smm?tab=outbound-ai` → "Monitoring" tab (the tab strip lives inside the Outbound — AI surface; "Mappings" is the other tab; both are inside the same SMM child node per master-plan Decision 2).

Per row: one Publer Account. Columns:
- Account Name + Channel
- Scheduled (next 7d) — count of Posts where `Status = 'Scheduled'` AND `Scheduled Date <= now + 7d`
- Published (last 7d) — count of `Status = 'Posted'` AND `Posted At >= now - 7d`
- Failed (last 7d) — count of `Publer Status = 'Failed'` AND timestamp within 7d
- Last successful publish — formatted timestamp
- Last error reason — `Publer Last Error` of the most recent failed Post
- Token Expiry countdown — computed from `Connected At + 60 days` (Meta OAuth default)

Render with simple cards, no chart libs.

### Max (defer)

Reach trend (IG Insights via Publer's analytics endpoint), engagement rate, follower delta. Needs Publer's analytics API access + may require separate auth setup. **Defer.**

### Files touched
- `app/admin/smm/outbound-ai/page.js` — NEW. Two-tab layout: Mappings (existing /admin/publer content) + Monitoring (new).
- `app/api/admin/smm/publer-monitor/route.js` — NEW. Returns per-account metrics.
- `lib/sidebarConfig.js` — Outbound — AI loses placeholder badge.

## Email alerts

### Min (ship this)

Triggers:
- **Token expiring <7d** — daily cron `/api/cron/publer-health-check`. Scans Publer Accounts where `today - Connected At >= 53 days` (60d Meta token lifetime - 7d warning). Sends email to evan@palm-mgmt.com listing accounts at risk.
- **Per-post Publer Status = 'Failed'** — immediate email on the cron's transition. Subject: "Publer publish failed — {accountName} — {error}".

Use whatever transactional service is wired (check env before this batch starts — likely Resend per audit B speculation; verify with `lib/email.js`).

### Max (defer)

- Slack webhook integration with per-channel routing.
- Reach drop ≥40%/24h alert (needs reach data from Max-deferred monitoring).

### Files touched
- `app/api/cron/publer-health-check/route.js` — NEW. Daily token expiry check.
- `app/api/cron/publer-job-poll/route.js` — Add inline email on Failed transition.
- `lib/emailTemplates/publerAlerts.js` — NEW. Two templates: tokenExpiring + publishFailed.

## Symmetric Pipeline Target validator on telegram/enqueue

Per the Phase 1+2 handoff (deviation #3): the existing `publer/enqueue` route rejects Posts where Pipeline Target isn't Publer-compatible. The symmetric validator on `telegram/enqueue` was not added in Phase 2.

### Implementation

In `app/api/admin/telegram/enqueue/route.js`, before the bulk-patch:

```
const posts = await fetchPostsByIds(postIds);
const invalid = posts.filter(p => p.pipelineTarget === 'Publer');
if (invalid.length > 0) {
  return NextResponse.json({
    error: 'Posts with Pipeline Target=Publer cannot be enqueued to Telegram',
    invalidPostIds: invalid.map(p => p.id)
  }, { status: 400 });
}
```

`Pipeline Target = 'Telegram (Warmup)'` and `'Telegram'` and null all pass through. Only `'Publer'` is rejected.

### Files touched
- `app/api/admin/telegram/enqueue/route.js` — 5-line validator addition.

## Phase 2.5 carousel per-slide rejection UI

Spec from `publer-ai-scheduler.md` §6.4 + handoff deviation #4.

Two modes:
1. **Bounce-back (default):** rejecting any slide reverts the entire Carousel Project back to In Review on the AI editor side. Rejected slide IDs + reason captured in `Tasks.Revision History`.
2. **Remove (optional):** rejecting a slide drops it from `Posts.media[]` (specifically removes its photo Asset from the Posts → Asset linked records) and re-orders remaining slides. Publishable as a carousel with N-1 slides.

### Implementation surface

`app/admin/editor/CarouselSubmissionsReview.js` — existing file. Today, reject buttons exist at the carousel level. Add:
- Per-slide UI: thumbnail + reject button + reason dropdown ("Off-pillar" / "Quality issue" / "Watermark missing" / "Other").
- Mode toggle at the carousel level: "Bounce on any reject" (default) / "Remove and publish remaining."
- On submit:
  - Bounce mode: `Tasks.Admin Review Status = 'Revision Requested'`, `Carousel Project.Status = 'In Review'`, write rejected slide details into Revision History.
  - Remove mode: PATCH `Posts.Asset` linked records to drop the rejected Photo Assets, re-order, advance to Post Prep.

### Files touched
- `app/admin/editor/CarouselSubmissionsReview.js` — per-slide UI + mode toggle.
- `app/api/admin/carousel-review/per-slide/route.js` — NEW. Handles both modes.
- `lib/carouselReview.js` — NEW. Shared logic for bounce vs. remove.

## Files to create

- `app/admin/smm/outbound-ai/page.js` — Outbound — AI surface with Mappings + Monitoring tabs.
- `app/api/admin/smm/publer-monitor/route.js` — Per-account metrics endpoint.
- `app/api/cron/publer-health-check/route.js` — Daily token expiry check.
- `app/api/admin/carousel-review/per-slide/route.js` — Per-slide reject + mode dispatch.
- `lib/emailTemplates/publerAlerts.js` — Two email templates.
- `lib/carouselReview.js` — Shared bounce/remove logic.

## Files to modify

- `app/api/cron/publer-queue/route.js` — Schedule jitter + flip `state: 'draft'` → `'scheduled'` + caption + hashtag pre-fill hooks.
- `app/api/cron/publer-job-poll/route.js` — Email alert on Failed transition.
- `app/api/admin/telegram/enqueue/route.js` — Symmetric Pipeline Target validator (5 lines).
- `app/admin/editor/CarouselSubmissionsReview.js` — Per-slide UI + mode toggle.
- `vercel.json` — Add `publer-health-check` cron entry (daily at 09:00 ET).
- `lib/sidebarConfig.js` — Outbound — AI loses placeholder badge; Monitoring sub-tab listed.

## Test plan

1. **Schedule jitter.** Manually enqueue a Post for tomorrow 11:00 ET. Run publer-queue cron. Verify Publer's draft has `scheduled_at` between 10:35 ET and 11:25 ET. Re-run cron — same Post should get the SAME jittered time (seeded by postId-date).

2. **Flip to scheduled.** Verify the cron now submits with `state: 'scheduled'`, not `'draft'`. Confirm in Publer dashboard the post shows as Scheduled (not Draft).

3. **Caption rotation.** Create 3 Caption Templates for Brielle / Lifestyle / Reel. Manually enqueue 3 Posts with empty Caption + Pipeline Target=Publer. Run cron 3 times. Verify each of the 3 templates is picked exactly once (round-robin via Used At). Verify `Used At` is stamped on each.

4. **Hashtag rotation.** Same pattern with 3 Hashtag Pools. Verify pool selection rotates by inverse-recent-use.

5. **Denylist enforcement.** Add `#onlyfans` to Hashtag Denylist. Add a Hashtag Pool containing `#onlyfans`. Run cron. Verify the pool is either skipped (if other pools exist) or the cron errors with "Hashtag pool has <3 valid tags."

6. **Monitoring dashboard.** Open `/admin/smm?tab=outbound-ai`, click Monitoring tab. Verify each Publer Account shows Scheduled / Published / Failed counts. Token Expiry countdown displays correctly (compare against Connected At + 60d).

7. **Token expiry alert.** Set a Publer Accounts row's Connected At to 54 days ago. Run `/api/cron/publer-health-check`. Verify owner receives an email listing this account.

8. **Failed publish alert.** Manually set a Post to `Publer Status = 'Failed'` via Airtable. Trigger `publer-job-poll` cron. Verify owner receives "Publer publish failed" email.

9. **Symmetric validator.** POST to `/api/admin/telegram/enqueue` with `{ postIds: [<post with Pipeline Target='Publer'>] }`. Verify 400 response listing the invalid post.

10. **Carousel per-slide reject (bounce mode).** Open a carousel in `CarouselSubmissionsReview`. Toggle mode to Bounce. Reject slide 2 with reason "Off-pillar." Verify Task.Admin Review Status = 'Revision Requested', Carousel Project.Status = 'In Review', Revision History captures slide 2 + reason.

11. **Carousel per-slide reject (remove mode).** Same carousel. Toggle to Remove mode. Reject slide 2. Verify Posts.Asset linked records no longer include slide 2's photo, remaining slides are re-ordered, carousel advances to Post Prep.

12. **No regression on real-creator flow.** Enqueue a real-creator Post (Pipeline Target = 'Telegram' or null) to telegram/enqueue. Verify it queues normally — symmetric validator doesn't reject.

## Rollback procedure

```
git checkout dev
git branch -D smm-consolidation
```

No Airtable changes — Batch 5 is code-only. Rollback also reverts:
- The `state: 'scheduled'` flip back to `'draft'` (Phase 2 behavior).
- The per-slide carousel UI back to whole-carousel reject.
- The symmetric validator.
- The cron crons (removed from vercel.json).

In Publer dashboard: any posts that landed as Scheduled during the test window can be manually deleted / paused if rollback happens mid-flight. Otherwise let them play out — they're already legitimately scheduled.

## Estimated time

30-40 hours. Breakdown:
- Schedule jitter + state flip: 2-3h
- Caption + hashtag rotation wiring (cron hooks): 3-4h
- Monitoring dashboard (frontend + API): 6-8h
- Email alerts + health-check cron: 4-6h
- Symmetric validator: 1h
- Carousel per-slide UI + bounce/remove logic: 8-10h
- Manual test + bugfix: 6-8h

## Success criteria

- [ ] First live Publer-scheduled post lands on Brielle's IG with jittered scheduled_at, rotation-selected caption + hashtags, no banned tags.
- [ ] Monitoring dashboard renders for all 3 AI accounts (Brielle, Lily, Katie Rosie).
- [ ] Owner receives test email for a fabricated Publer failure.
- [ ] Owner receives token-expiry alert when Connected At is 53+ days old.
- [ ] Symmetric validator on telegram/enqueue confirmed (test #9).
- [ ] Carousel per-slide reject works in both bounce + remove modes.
- [ ] No regression on Phase 2 draft-only flow during the transition (live-flip is per-account, not global).
- [ ] `next build` passes; lint clean.
- [ ] Handoff doc `batch-5-handoff.md` written.

## Post-Batch-5 follow-ups (out of scope, tracked for later)

These are explicitly NOT in Batch 5 but worth noting for the owner's future-sprint backlog:

- **Reach / engagement analytics dashboard** (Publer analytics API access + auth). Adds reach trend, engagement rate, follower delta to monitoring.
- **A/B caption engagement tracking.** Weight `Caption Templates` selection by historical engagement on the same account.
- **Natural posting time histogram.** Per-account jitter biased toward historical distribution.
- **Slack alerts.** Once the agency has a real Slack workspace.
- **Auto-scrape IG banned hashtag list.** Fragile; recommended to skip.
- **Reach-drop alert.** Needs analytics data first.
