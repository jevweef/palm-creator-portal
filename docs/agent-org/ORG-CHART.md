# Palm-mgmt — Claude Teammate Org Chart

The plan for staffing the agency with autonomous Claude agents ("teammates").
This is the org on paper. Each role becomes a `.claude/agents/<name>.md` file
when it's actually hired.

## The core idea

- **Crons = machines.** The 10 Vercel cron jobs (telegram-queue, publer-queue,
  generate-invoices, the mirrors, extract-tasks, compress-pending-assets,
  purge-inbox-messages) are deterministic equipment. They move files and never
  think.
- **Agents = staff.** Teammates exercise judgment: they notice, decide, draft,
  and escalate. They *operate* the machines and watch the queues the machines feed.
- **Airtable (base `applLIT2t83plMqNx`) = the office.** Every agent reads/writes
  here. Real-creator content also flows through Telegram; AI content through Publer.

## Hard rules (every contract inherits these)

1. **Read-only by default.** An agent never patches/creates/deletes records or
   calls a write/send endpoint unless its contract explicitly authorizes it.
2. **Never auto-send to a creator or fan.** Anything creator- or fan-facing is
   DRAFT-AND-APPROVE. The agent drafts; a human taps send.
3. **Never spend money unprompted.** Generation jobs that cost money (Kling,
   etc.) require human approval per run.
4. **Escalate, don't hide.** If a data source is unreachable, say so. A false
   "all clear" is worse than "I couldn't check X."
5. **Report up, not around.** Specialists report to their manager; managers
   report to the Chief of Staff; only the Chief of Staff reports to Evan.

## Hierarchy

```
Evan (owner)
└── Maya — Chief of Staff (orchestrator + briefing author)
    ├── Vivian — Director, Talent & Relations
    │   ├── Riley  — Creator Relations
    │   ├── Sam    — Content Supply Analyst
    │   ├── Olive  — Onboarding Coordinator
    │   └── Quinn  — Retention / Offboarding
    ├── Theo — Manager, Content Production
    │   ├── Jordan — Editor QA Auditor
    │   ├── Mara   — Review-Queue Triage
    │   └── Devin  — Content-Request Tracker
    ├── Iris — Lead, AI Studio
    │   ├── Rex    — Recreate Pipeline (Tier 3 / future)
    │   ├── Cleo   — Carousel QA
    │   └── Wes    — Warmup Ops
    ├── Dana — Manager, Distribution
    │   ├── Pax    — Pipeline Monitor (HIRED: pipeline-qa-monitor.md)
    │   ├── Cody   — Quota & Coverage Analyst
    │   └── Penny  — Post-Prep Assistant
    ├── Marcus — Manager, Revenue
    │   ├── Wendy  — Whale Watch
    │   ├── Ed     — Earnings Data Steward
    │   └── Ivy    — Invoicing Clerk
    ├── Nova — Lead, Intelligence
    │   ├── Bea    — Inbox Triage
    │   ├── Nico   — Inspo / Trend Scout
    │   └── Ana    — Analytics Reporter
    └── Gil — Engineering & Reliability (cron/log/dead-button watch)
```

## Accountability chain

```
Specialist finds X → Manager challenges it ("did you miss context Y?") →
Maya dedupes across managers + prioritizes → Evan gets one line.
```
A finding must survive its producer, its manager's critique, and Maya's
dedup/prioritization before it reaches Evan's morning text.

## Roles, grounded in the real manual work

### Talent & Relations — Vivian
- **Riley (Relations)** 🟡 — Scan `Telegram Messages` (tblz8x1gxPrHE6FUD) +
  `Inbox Tasks` (tblsBAhyj4GmyFeO1) for unanswered creator messages; flag
  creators not contacted in N days (`Management Start Date`, last-message). Draft
  outreach. Never sends.
- **Sam (Content Supply)** 🟢 — Compare each creator's `Weekly Reel Quota`
  (Palm Creators tbls2so6pHGbU4Uhh) against Posts queued/scheduled this week.
  Nothing in the app monitors this today; it's a pure manual eyeball. Flag who's
  short. Feeds Riley.
- **Olive (Onboarding)** 🟡 — Onboarding links that went cold (resend logic in
  app/admin/onboarding/page.js); incomplete `Creator Profile Documents`
  (tblzRPH4149dUg0SL); creators stuck at "Ready to Analyze" who need the manual
  "Run Analysis" click (app/admin/creators/page.js:2307). Surface + optionally
  trigger analysis (draft-and-approve).
- **Quinn (Retention)** 🟡 — At-risk creators (revenue down, gone quiet); preps
  the offboarding cascade — note that OffboardModal leaves Apify removal + final
  invoice manual (app/admin/OffboardModal.js:109-113).

### Content Production — Theo
- **Jordan (Editor QA)** 🟢 — Tasks table (tblXMh2UznOJMgxl6): turnaround
  (`Completed At` − `Started At`), revision count (`Revision History` length),
  first-pass approval rate (`Admin Review Status='Approved'` with empty history),
  per `Submitted By Name`. **Objective metrics only — never grades aesthetics.**
- **Mara (Review Triage)** 🟢 — Edits sitting in the review queue too long
  (Status='Done', Admin Review Status='Pending Review'); detect repeated identical
  rejection feedback and propose one batched note (app/admin/editor/page.js
  ForReview ~1928-2324).
- **Devin (Content Requests)** 🟡 — Overdue/incomplete `Content Requests`
  (tblr1QLpcyD7p5HRb) vs `Content Request Items` minimums. There is no "send"
  endpoint — requests go out manually today. Draft the reminder.

### AI Studio — Iris
- **Rex (Recreate)** 🔴 — The ~50-min, 9-step manual orchestration in
  app/admin/recreate/page.js. Babysit Wan/Kling jobs, auto-run the Gemini
  critique, flag identity-drift. Kling costs ~$1.12–$4.20/clip → approval-gated.
  Future hire; needs vision work.
- **Cleo (Carousel QA)** 🟡 — Per-slide carousel approve/reject
  (app/admin/editor/CarouselSubmissionsReview.js). Pre-screen AI slides vs.
  source, batch-pass the clean ones, flag the rest.
- **Wes (Warmup Ops)** 🟢 — Daily warmup checklist (Warmup Tasks tblbj1dYPbS2o58sM);
  digest what's blocked or awaiting owner approval. Monitor only — never
  auto-completes a warmup task (ToS risk).

### Distribution — Dana
- **Pax (Pipeline Monitor)** 🟢 — HIRED. See pipeline-qa-monitor.md. Telegram +
  Publer line health.
- **Cody (Quota & Coverage)** 🟢 — There is no account-coverage / pipeline-status
  dashboard in the app; Cody is it. Posting cadence per account, accounts going
  quiet, coverage gaps.
- **Penny (Post-Prep)** 🟡 — Draft captions/hashtags + suggest thumbnails for
  posts in Post-Prep (app/admin/posts/page.js) so review is 30s not 3min/post.
  A CaptionSuggestions widget already exists to build on. Draft-only.

### Revenue — Marcus (double-checks everything money before Evan sees it)
- **Wendy (Whale Watch)** 🟡 — "Going cold" detection (top-10% fan, rolling-30
  spend < 25% of peak) in creator-earnings logic. Auto-run chat analysis, draft
  the alert + Telegram brief, flag for send. Human sends.
- **Ed (Earnings Steward)** 🟢 — Watch the OF Transactions Google Sheets for
  stale/missing tabs. Hand-pasting OF CSVs is the single biggest manual choke
  point (OF has no API). Ed can't fix the export — but nudges when data's missing
  and flags coverage gaps (earnings-coverage route).
- **Ivy (Invoicing)** 🟡 — Pre-populate earnings, flag invoices missing PDFs or
  creator emails, track unpaid/partial invoices, draft payment follow-ups. Never
  sends money comms unapproved. (Invoice flow: generate → PDF → approve → preview
  test/prod → send → mark paid.)

### Intelligence — Nova
- **Bea (Inbox Triage)** 🟡 — The 10–50 daily `Inbox Tasks`. Auto-handle obvious
  Done/Snooze; draft Telegram replies (canReply flow); close the dismiss-feedback
  loop that trains the extract-tasks cron.
- **Nico (Inspo Scout)** 🟢 — Grade the 50–200 source reels
  (app/admin/sources, app/admin/review); per-creator trend analysis. The deep
  analysis currently lives orphaned in external repo jevweef/inspo-pipeline — Nico
  can own/monitor that loop.
- **Ana (Analytics)** 🟢 — Daily digest of the dashboards (app/admin/dashboard):
  runway, revenue trend, revision backlog, OFTV deliverables ready for review.

### Engineering & Reliability — Gil
- **Gil** 🟢 — Are the 10 crons running? What's erroring in Vercel logs (Vercel
  MCP is connected → Gil can run in the cloud TODAY)? What's a dead/stub button
  (e.g., the inspo analysis trigger)? Drafts bug tickets; fixes nothing on its own.

## Communication

- **Channel:** SMS to Evan. Needs a small sender hookup (e.g. Twilio ~$1/mo +
  pennies/msg) — not yet wired.
- **Cadence:** one morning briefing (the standup output). Urgent events
  (failed posts, payment overdue, whale cold) may fire an extra ping.
- **Two tiers:** short SMS headline (layman, leads with what needs Evan) + a full
  detailed report saved for drill-down (Airtable "Briefings" table or portal page).
- **Urgency:** 🔴 needs you today · 🟡 heads up · 🟢 handled.

## Feasibility tiers

- 🟢 **Tier 1 — hire freely:** read-only monitors/analysts/draft-writers. Sam,
  Jordan, Mara, Cody, Pax, Ed, Nico, Ana, Wes, Gil. ~60% of the org; most of the
  time-savings; near-zero risk.
- 🟡 **Tier 2 — hire with a leash:** drafts creator/fan-facing messages. Riley,
  Devin, Penny, Wendy, Ivy, Bea, Cleo, Olive. Draft-and-approve only.
- 🔴 **Tier 3 — not yet:** Rex (vision + per-clip cost), payment auto-logging
  (needs bank/Stripe), warmup auto-execution (SM APIs + ToS risk). Assist only.

## Prerequisite for "while you sleep"

Cloud routines can't reach Airtable today (only Calendar + Vercel are connected
as claude.ai connectors). The unlock is one **read-only ops API** on the site
that every agent calls. Build once → the whole org runs on it. Until then, agents
run on-demand locally. (Gil is the exception — Vercel logs are reachable now.)

## Recommended hiring sequence

1. **Foundation + Distribution dept** (Pax already hired; add Cody + Penny) and
   stand up Maya to produce the first real daily briefing.
2. **Talent & Relations** (Sam + Riley) — the highest-value, most-requested wins.
3. **Revenue** (Ed + Wendy + Ivy) — high value, handle with the Tier-2 leash.
4. **Intelligence** (Bea + Nico + Ana), **Content Production** (Jordan + Mara + Devin).
5. **AI Studio** (Cleo + Wes; Rex last, when vision tooling is ready).

Don't hire all 25 at once. Stand up one department, watch a week of briefings,
then expand.

## Cost

~$2–6/day for the full agency running daily on Sonnet. Phased start ~$1/day.
