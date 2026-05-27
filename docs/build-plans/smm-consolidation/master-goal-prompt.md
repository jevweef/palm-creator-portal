# Goal-Mode Master Prompt — SMM Consolidation

**Paste this into a fresh agent's goal-setting mode. The agent reads this + the referenced batch docs and executes Batch 1 → 2 → 3 → 4 → 5, stopping after each batch for owner approval. The agent has no memory of the research phase that produced these docs — this prompt is self-contained.**

---

## Goal

Consolidate the Palm Creator Portal's scattered Social Media Management admin surface into a single role-filtered SMM parent, then ship four new feature surfaces on top: per-AI-account 90-day warmup flow, content strategy engine, Amin manual-post bridge, and Publer Phase 3 (live scheduling). All work happens on branch `smm-consolidation` off `dev`. Never auto-merged. Every batch reversible via `git branch -D` + Airtable column-delete. After each batch, STOP and surface to owner for approval before starting the next.

## Repository context

- **Path:** `/Users/jevanleith/palm-creator-portal`
- **Stack:** Next.js 14, Clerk auth, Airtable data layer, OpenAI + Anthropic SDKs, Cloudflare Images, Dropbox.
- **Owner:** evan@palm-mgmt.com (the principal — comfortable with code, env vars, Airtable schemas).
- **Branch:** `smm-consolidation` off `dev`. NEVER push to `main`. NEVER merge to `dev` without explicit owner approval.
- **Airtable base:** `applLIT2t83plMqNx`. Env var `AIRTABLE_PAT` (not AIRTABLE_API_KEY). typecast:true on first write auto-creates singleSelect options.
- **Auth helpers:** `lib/adminAuth.js` — `requireAdmin`, `requireAdminOrAiEditor`, `requireAdminOrSocialMedia`, `requireAdminOrEditor`, `requireInboxOwner`, `requireAdminOrChatManager`.

## Hard constraints

- Branch `smm-consolidation` off `dev`. NEVER push to `main`. NEVER merge to `dev` without owner approval.
- **Airtable changes ADDITIVE ONLY** — no edits, renames, or deletes of existing fields/tables. If you find a field with a similar name to one you're about to create, STOP and ask the owner.
- Every code change reversible via `git branch -D smm-consolidation`.
- Every Airtable change reversible via column-delete.
- Gradual Amin transition — the existing Telegram → Amin pipe stays live for real-creator content indefinitely AND for AI-account warmup posts until each account's per-account Publer goes live (Day 23+).
- Server-side role gates in `lib/adminAuth.js` are the source of truth. Sidebar filtering is courtesy/UX, never security.
- After each batch, STOP and wait for owner approval before starting the next batch.
- NEVER skip git hooks (`--no-verify`). NEVER amend commits to bypass hook failures — create a new commit instead.

## Execution order

For each batch: read the referenced doc end-to-end, execute it, run its test plan, write a one-page completion handoff at `docs/build-plans/smm-consolidation/batch-N-handoff.md` (template below), then STOP and surface to the owner for approval.

### Batch 1 — Nav Consolidation

- **Doc:** `docs/build-plans/smm-consolidation/batch-1-nav-consolidation.md`
- **Output:** `docs/build-plans/smm-consolidation/batch-1-handoff.md`
- **Scope summary:** Sidebar consolidation under SMM parent (3-group divider — Pipeline / Outbound / Strategy & Warm-Up). Header.js audit + edits. ai_editor admin-layout policy flip. Editor two-hop redirect fix. Dead-route archive (3 routes → 410 Gone). Tabs-vs-sidebar single source of truth. "AI Source" → "AI Content" label rename.
- **Airtable changes:** NONE.
- **Estimated time:** 12-16 hours.
- **STOP. Wait for owner approval.**

### Batch 2 — Account Warm-Up Flow

- **Doc:** `docs/build-plans/smm-consolidation/batch-2-warmup-flow.md`
- **Output:** `docs/build-plans/smm-consolidation/batch-2-handoff.md`
- **Scope summary:** Six new Airtable tables (AI Account Profile, Warmup Tasks, Warmup Playbook Templates, Warmup Incidents, Pixel Devices, SIM Inventory). Three additive fields on Publer Accounts. Today view + per-account 5-tab view + owner-only Playbook Editor. Versioned templates. Day-21 5-step prereq-chained sub-tasks. Day-45 owner-approval gate. Backfill / catch-up mode. Vault link integration (item ID, not URL).
- **Airtable changes:** ADDITIVE — 6 new tables + 3 fields on Publer Accounts.
- **Estimated time:** 50-70 hours.
- **STOP. Wait for owner approval.**

### Batch 3 — Content Strategy Engine

- **Doc:** `docs/build-plans/smm-consolidation/batch-3-content-strategy.md`
- **Output:** `docs/build-plans/smm-consolidation/batch-3-handoff.md`
- **Scope summary:** Pillar fields on Recreate Reels / Carousel Projects / Inspiration / Assets. Claude Haiku 4.5 backfill (~$4 — do NOT use GPT-4o). Creator Content Plan, Caption Templates, Hashtag Pools, Hashtag Denylist tables. Daily warmup-content-fill cron pre-fills tomorrow's post tasks. Cross-account caption dedup (90-day window against linked real creator). 30-day source-reel reuse window. Strategy UI replaces the Batch 1 placeholder.
- **Airtable changes:** ADDITIVE — pillar columns + 4 new tables.
- **Estimated time:** 30-40 hours.
- **STOP. Wait for owner approval.**

### Batch 4 — Amin Manual-Post Bridge

- **Doc:** `docs/build-plans/smm-consolidation/batch-4-amin-bridge.md`
- **Output:** `docs/build-plans/smm-consolidation/batch-4-handoff.md`
- **Scope summary:** Warmup Telegram Topic ID per AI account (on Publer Accounts). Two-line branch in existing telegram-queue cron — fixes the live mis-routing bug. Send-to-amin + create-topic + mark-posted routes. Amin `/posted` webhook handler. ET + IST time-zone display. Compliance Log table (EU AI Act audit trail). Stub Palm Creators row for standalone AI personas (Katie Rosie).
- **Airtable changes:** ADDITIVE — Compliance Log table + Creator Type field on Palm Creators + ~5 fields on Posts and Warmup Tasks.
- **Estimated time:** 25-35 hours.
- **STOP. Wait for owner approval.**

### Batch 5 — Publer Phase 3

- **Doc:** `docs/build-plans/smm-consolidation/batch-5-publer-phase3.md`
- **Output:** `docs/build-plans/smm-consolidation/batch-5-handoff.md`
- **Scope summary:** Schedule jitter ±15-25 min. Flip state: 'draft' → 'scheduled'. Caption + hashtag rotation wired into publer-queue cron. Per-account monitoring dashboard (Min). Email alerts (token expiring <7d + per-post failures). Symmetric Pipeline Target validator on telegram/enqueue. Phase 2.5 carousel per-slide rejection UI (bounce + remove modes).
- **Airtable changes:** NONE.
- **Estimated time:** 30-40 hours.
- **STOP. Wait for owner approval.**

---

## Pre-flight checklist (run before Batch 1)

- [ ] Git: branch `smm-consolidation` exists off latest `dev`. If using worktrees: `.claude/worktrees/smm-consolidation` (consider `EnterWorktree` tool).
- [ ] Read: `docs/build-plans/smm-consolidation/00-research-scope.md` (owner vision + hard constraints) end-to-end.
- [ ] Read: `docs/build-plans/smm-consolidation/master-plan.md` (architecture decisions + reconciliation log) end-to-end.
- [ ] Read: the playbook + Publer handoff for grounding (`docs/build-plans/publer-ai-account-creation-playbook.md`, `docs/build-plans/publer-ai-scheduler-phase1-2-handoff.md`).
- [ ] Confirm prerequisites: `next build` passes from clean `dev`. `npm install` clean. `AIRTABLE_PAT`, `PUBLER_API_KEY`, `PUBLER_WORKSPACE_ID`, `ANTHROPIC_API_KEY`, `CRON_SECRET` are set in env.
- [ ] Confirm with owner: credential vault choice (Bitwarden vs 1Password — needed by Batch 2). Pillar taxonomy (needed by Batch 3). Brielle's current Day N (needed by Batch 2 backfill mode).

## Per-batch acceptance criteria

Each batch must pass these gates before asking the owner for approval:

- [ ] `next build` passes from a clean checkout of the branch.
- [ ] `npm run lint` (or whatever lint script exists) passes.
- [ ] Manual test of the batch's primary flow passes (the batch doc's test plan).
- [ ] The handoff doc lists every file touched + a rollback command.
- [ ] No file outside the batch's stated "Files to touch" list was modified.
- [ ] No Airtable change outside the batch's stated schema additions occurred.
- [ ] Git status clean after commit (no untracked or unstaged files).
- [ ] If the batch added cron jobs: `vercel.json` registration is correct AND the cron runs successfully against local dev (`curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/...`).

## Handoff doc template

After each batch, write to `docs/build-plans/smm-consolidation/batch-N-handoff.md`:

```markdown
# Batch N Handoff — {Title}

**Branch:** smm-consolidation
**Date:** YYYY-MM-DD
**Status:** Awaiting owner approval

## What shipped
(Bullet list — 5-10 items max.)

## Files touched
(Exhaustive list with paths. If anything outside the batch doc's stated files was modified, flag it here with reason.)

## Airtable changes
(Tables created. Fields added. Cite the exact field names and types.)

## Deviations from the batch doc
(If you had to make a judgment call that wasn't in the doc, document it here with rationale.)

## Test results
(Each test from the batch doc's test plan: PASS / FAIL / SKIPPED with reason.)

## Rollback command
git checkout dev && git branch -D smm-consolidation
(+ list any Airtable tables / fields to delete.)

## Open questions for the owner
(What needs an answer before the NEXT batch can start.)
```

## Escalation triggers

STOP and ask the owner — DO NOT make unilateral decisions — if any of these happen:

1. You need to modify or rename an existing Airtable field or table. (Additive only. If something needs to change, escalate.)
2. A required file conflict means an existing flow must be broken to ship the batch. (Real-creator Telegram flow, Publer Phase 1+2 flow, editor workflow, ai_editor TJP workflow — none of these can break.)
3. An external API rate limit or outage blocks the batch (Publer, Anthropic, Telegram, Airtable).
4. `next build` refuses to pass after 3 fix attempts. (Diagnose the root cause; don't silently downgrade types or disable warnings.)
5. A test in the batch doc's plan fails AND the failure indicates a deeper architectural issue (not a typo or missing import).
6. The owner-approval gate on a Day-45 task or any other high-risk approval is being bypassed in code.
7. You discover a live bug in the existing code that's adjacent to your batch scope — log it, surface to owner, don't silently fix it (out-of-scope changes break the batch boundary).

## Failure modes — common

| Mode | Corrective action |
|---|---|
| Airtable typecast auto-created a wrong singleSelect option | Delete the wrong option in Airtable manually; fix the source string. typecast:true is forgiving but if you wrote "AI Account" once and "ai-account" later, you get two options. |
| Cron not firing locally | Confirm `vercel.json` syntax. Confirm `CRON_SECRET` matches. Use `curl -H "Authorization: Bearer $CRON_SECRET"` to invoke. |
| ai_editor blocked from `/admin/smm` after Batch 1 | Confirm `aiEditorAllowedPath` in `app/admin/layout.js` matches the new logic (allow when tab is ai-content / warmup / strategy). |
| Telegram message body doesn't render ET + IST correctly | Use `Intl.DateTimeFormat` with explicit `timeZone` options; don't use raw Date math. |
| Publer publish failure with `MEDIA_OVERSIZE` | The media URL points to a video >200MB. Re-render smaller. (Phase 1+2 known limit.) |
| `next build` fails after schema change | Likely a TypeScript type imported from `lib/adminAuth.js` is out of date. Re-check helpers; don't disable strict mode. |

## Success

The project is "done" when:

- The portal's admin sidebar has 10 top-level items (down from 12) with SMM as the single parent for 12+ role-filtered children grouped Pipeline / Outbound / Strategy & Warm-Up.
- All 3 in-flight AI accounts (Brielle, Lily, Katie Rosie) have AI Account Profile rows, with day-counter-driven Today view tasks visible in `/admin/smm?tab=warmup`.
- Operator can open the Today view once daily, run today's tasks across all 3 accounts, click "Send to Amin" on post tasks, and Amin posts manually — no mis-routing risk because per-account Telegram topics are set up.
- Owner can edit the playbook template; in-flight accounts can opt into future-day patches; Day-45 OF CTA cannot fire without owner approval.
- Content engine pre-fills tomorrow's post tasks daily; operator never has to manually pick "what's next for Amelia in TJP" again.
- At least one AI account has graduated past Day 23 with Publer authorized; Publer is publishing live (not draft) with jitter + caption rotation + hashtag rotation + denylist enforcement.
- Monitoring dashboard shows per-account scheduled / published / failed counts.
- Owner gets email alerts on token expiry + publish failures.
- Compliance Log captures every posted task immutably (EU AI Act audit trail).
- Every batch is independently revertible.

---

## One-paragraph executive context (for the agent's mental model)

Palm Creator Portal is an OnlyFans-creator management agency's internal Next.js + Airtable admin app. They run two parallel content streams per managed real creator: (1) real-content posts via the existing editor → admin review → Telegram → Amin (Indian SMM contractor who posts manually); (2) AI-content posts on dedicated IG/FB accounts (Brielle for real-creator Amelia, Lily for Gracie, Katie Rosie standalone) — these are being warmed up against a 90-day playbook to avoid Meta bans, then auto-scheduled via Publer once authorized at Day 23+. The Publer Phase 1+2 pipeline shipped 2026-05-26 (draft-only). This SMM consolidation does three things at once: collapses the messy admin sidebar into one SMM parent with role-filtered children; ships the 90-day warmup operating system the operator currently lacks (today there's zero structured surface for it); and fixes a live mis-routing bug where warmup Telegram messages would land in the real creator's topic. The owner is evan@palm-mgmt.com — technical, cost-conscious, prefers concrete recommendations + dollar amounts over open-ended trade-off discussion. Every batch ships independently and is fully revertible. After each batch, STOP. Wait for owner approval.

---

**End of master prompt. Execute Batch 1 first. Stop after Batch 1. Surface to owner.**
