# SMM Consolidation — Full Context Overview (from the discovery session)

**Written:** 2026-05-28 by session `6d36e480` (the "where did the SMM redesign go?" session).
**Purpose:** a context dump for a *different, currently-active* session to cross-check against. Some of this is likely **dated** — read the freshness map below before trusting any execution-state claim.

---

## ⚠️ Freshness map — read this first

This session's job was **discovery + documentation**, not execution. It: (1) found that the SMM redesign was stranded on an unmerged branch, (2) ran a 4-stream research workflow over the docs + the codebase + old session transcripts, and (3) wrote the status/handoff docs. It did **not** do the merge.

Per the project memory, *another* session has since **already merged `smm-consolidation` into `dev` (tip `66d1a66f`)**, locked decisions, and started the Content Strategy Engine. So:

| Layer | Freshness | Trust it? |
|---|---|---|
| **The 100k-ft vision / north star** (below) | Durable — mined from Evan's own words | ✅ High value, unlikely you have it all |
| **Hard constraints & load-bearing rules** | Durable | ✅ High value |
| **Research-mined nuances** (consent stance, account stack, UX preferences, stretch goals) | Durable | ✅ This is the stuff most likely MISSING from your context |
| **As-shipped batch inventory** | Accurate as of branch tip `99bf0b6f` | 🟨 Verify against current `dev` post-merge |
| **"The decision" (merge vs rebuild)** | **SUPERSEDED** — merge is done | ❌ Historical only |
| **Open questions** | Partially resolved (vault=Bitwarden) | 🟨 De-dupe against what you've decided |

**If you're the active session: you almost certainly know the execution state better than this doc. What you may be missing is the vision/why and the transcript-mined nuances.** Focus your read there.

---

## The 100,000-foot view (north star, in Evan's words)

> "I would like for this feature to sort of act as my social media manager."
> "This is all going to become a big thing. It's all going to sort of come to a point with the scheduling."

The end state: **this feature replaces the human social media manager.** Today's SMM is "pretty much just a poster" — adds no strategic value. The plan is to (a) hire someone internal for *strategy*, and (b) automate the *mechanical* posting in software. Every content source — real-creator editor output, AI-editor (TJP) output, the inspo pipeline, the grid planner — **converges on one automated post-prep-and-schedule hub.** Publer is that hub for AI content; Telegram-to-human stays for real content for now.

The consolidation thesis in one line: **many content sources, one automated post-prep-and-schedule funnel.**

---

## Hard constraints & load-bearing rules

1. **Real content and AI content NEVER mix.** Stated repeatedly and emotionally. Each managed creator who gets AI content gets a *dedicated* IG account just for AI content of her (real `@briel` → AI `@briel.ai`). Architecturally: **AI-ness lives on the Publer Account, not the creator.** Enqueue must hard-reject mixed-account-type posts. This is the single most important rule of the whole operation.
2. **Airtable changes are additive-only** — no edits, renames, or deletes of existing fields/tables. If a similarly-named field exists, STOP and ask.
3. **Server-side role gates in `lib/adminAuth.js` are the source of truth.** Sidebar/header filtering is courtesy/UX, never security.
4. **Localhost-first.** Iterate and validate locally; don't push to `dev` without Evan's explicit go-ahead. Never `--no-verify`; never amend to bypass hook failures.
5. **Gradual, per-account transition** — the Telegram→human pipe stays live for real content indefinitely AND for AI warmup posts until each account graduates to Publer (~Day 23+). Not a flag day.
6. **Drafts-first.** Validate one persona end-to-end before going live.

---

## Sequencing & rollout (as Evan framed it)

- **AI-exclusive first.** No real content wired into Publer yet ("eventually the grid planner will be going into Publer — not right now though").
- **First persona: Amelia (Briel), then Katie Rosie.** Validate Amelia's flow before going live.
- **"Post-ready" = automated:** thumbnail (if reel) + captions (reels, carousels, single-image). **Story-post automation is a named stretch goal** ("I'd be interested to see if we could…").
- The Publer scheduling mechanism deliberately **mirrors the existing telegram-queue cron pattern** — a server-side cron drains admin-approved Posts into Publer; media URL-imported from Cloudflare, raw files from Dropbox, nothing streamed through Vercel.

---

## Research-mined nuances (most likely MISSING from your context)

These came from the old session transcripts (esp. the May 26 research session `b11f6598`), not the build docs:

- **The grid-planner UX is considered basically correct.** Evan said the Publer feature is "pretty much kind of the same" layout as the grid planner. He does **not** want a redesigned workflow — just the same flow re-pointed at Publer instead of Telegram-to-human. Don't over-design.
- **Multi-account-under-one-Publer-workspace** was Evan's *preference for convenience* ("if I can have multiple accounts managed in one account… I would like that"), driven by ease — not a hard architectural requirement.
- **Consent / TGP — low ceremony.** When pushed on a "consent inventory" / disclosure system, Evan deflected: creators "have to KYC themselves on TGP, so that's the paperwork we have… For now, we have that taken care of." Treat TGP KYC as the existing backstop; don't build a new consent system unless asked.
- **Anti-ban account stack (adjacent, cost-sensitive):** GrapheneOS on factory/OEM-unlocked Pixel 8/9. Explicit OF-space framing ("reduce the chance of getting banned or suspended… this is for the onlyfans space"). Cost pressure: "we definitely need to be more cost-conscious… like a tenth of the cost." **Open question left unresolved:** Evan said "3 facebook profiles per account, no more than that," but the supplier claimed one phone could host ~30 — the 3-vs-30 profiles-per-device question was never settled.
- **Two named "Phase 3+" expansion vectors:** (1) story-post automation, (2) eventually migrating the real-creator grid-planner stream into Publer too.
- **Evan named the contractor only as "our current social media manager" / "pretty much just a poster"** — never "Amin" in his own messages. The "Amin" name comes from the build docs, not Evan's words. (Cosmetic, but avoids confusion if you ever quote him.)
- **Carousel rejection granularity** was reasoned out live: per-image rejection, with the option to either bounce the whole carousel back to the AI editor OR push the surviving slides through. (This shipped in Batch 5.)
- **Process intent:** Evan explicitly wants this work split into **separate, memory-preserving sessions** with handoff prompts, rather than one giant session. That's *why* this is fragmented across sessions — and why these docs exist.

---

## As-shipped inventory (branch `smm-consolidation`, tip `99bf0b6f` — verify against current dev)

5 batches + polish, all build-clean, all Airtable changes additive:

- **Batch 1** — Marketing Content hub (`app/admin/marketing-content`, 4 KPI tiles + grouped quick links); "AI Source"→"AI Content" relabel (route stays `/admin/recreate-source`); AI Content tab strip; `ai_editor` role scoped admin-shell access; `Header.js` update.
- **Batch 2** — **Full working warmup tracker.** Airtable `AI Account Profile` (`tbloVP7ocqHpeK9mo`) + `Warmup Tasks` (`tblbj1dYPbS2o58sM`); playbook in code (`lib/warmupPlaybook.js`, v1, 27 tasks); Today view / per-account drill-in / new-account form; **Day-21 5-step prereq chain** (409 `PREREQUISITE_NOT_DONE`) + **Day-45 owner-approval gate** (409 `OWNER_APPROVAL_REQUIRED`). *Deferred:* Playbook Templates / Incidents / Pixel Devices / SIM Inventory tables; vault copy-link button.
- **Batch 3** — Carousel auto-grouping ("Find Similar Photo Clusters," Claude Haiku 4.5 vision, ~$0.02/run) + Post Prep caption suggestions. **The Content Strategy Engine ("what's next for [creator] in TJP") was NEVER built** — deferred pending pillar taxonomy. *This is the biggest remaining feature gap and what the active session is now building.*
- **Batch 4** — Amin Telegram bridge: `Warmup Telegram Topic ID` on `AI Account Profile` (`fldYvZinLDyUFbEuF`); `POST /api/admin/smm/warmup/send-task/[id]` (per-persona forum topic, ET+IST message, "Send to Amin" button). Fixes the mis-routing bug. *Deferred:* `/posted` ack webhook, Compliance Log table (EU AI Act Art. 50, enforceable 2026-08-02), standalone-persona stub Palm Creators row.
- **Batch 5** — Per-slide carousel rejection (`Rejection Reason` on `Carousel Projects`); hub links regrouped (Review & Approve / Strategy & Setup / Outbound). *Deferred ("Phase 3+"):* schedule jitter, caption/hashtag rotation, denylist, monitoring dashboard, email alerts — all gated behind Publer going live.
- **Polish** — AI Content → 3 tabs (Setup→Workflow→Strategy); Account Warm-Up promoted to its own top-level item (`/admin/account-warmup`); Workflow tab inlines the AI editor (extracted `app/ai-editor/AiEditorBody.js`); Airtable 429 retry in `lib/adminAuth.js` (fixes intermittent white-screen-on-first-load).

---

## Open questions (de-dupe against what you've already decided)

- **Credential vault** — was open (Bitwarden ~$40/yr vs 1Password ~$8/mo). *Memory says this is now resolved → Bitwarden.*
- **Pillar / content-category taxonomy** — proposed 7: Lifestyle / Fitness / Flirty / BTS / Fashion / Trend-Reaction / Q&A. Needs Evan's confirm/edit. *(Memory shows the engine design evolved: keep the category buckets AND let the creator's DNA profile weight which category surfaces next — a thumb on the scale, not a flat rotation.)*
- **Brielle's current Day N** — needed for warmup backfill mode.
- **3-vs-30 FB profiles per Pixel device** — unresolved (see nuances above).
- **Compliance Log retention** — 1 / 3 / 7 years; where stored.
- **Auto-Approve flag** for live-state Posts — auto-enqueue, or always sit in Prepping for owner review?

---

## Two competing nav visions (resolved — don't re-litigate)

The pre-build `master-goal-prompt.md` describes a single `/admin/smm` parent with "12+ role-filtered children." That framing was **rejected** by Evan mid-planning and replaced with: a **Marketing Content hub** + an "AI Content" rename + (later) a standalone `/admin/account-warmup` page — **no `/admin/smm` parent.** The shipped reality is the latter. Any `/admin/smm` or "12+ children" reference in `master-goal-prompt.md` / `master-plan.md` is STALE.

---

## Pointers

- **Front-door status doc:** `docs/build-plans/smm-consolidation/STATUS-AND-RESUME.md`
- **Standalone handoff prompt:** `docs/build-plans/smm-consolidation/HANDOFF-PROMPT.md`
- **Pre-build plans (deep detail, nav refs stale):** `master-plan.md`, `master-goal-prompt.md`, `audit-A/B`, `critique-A/B`, `00-research-scope.md`, `batch-1..5-*.md`
- **Per-batch file lists + rollback commands:** `batch-1-handoff.md` … `batch-5-handoff.md` (on the `smm-consolidation` branch)
- **Relevant past sessions** (`claude --resume` to reopen): `b11f6598` (May 26 — vision/research, the richest source for the nuances above), `51d75b53` + `31a8b57d` (May 27 — the build), `6d36e480` (this discovery/docs session).
