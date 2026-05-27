# SMM Consolidation — Master Plan

**Author:** Synthesizer (Phase 3) — scope-corrected 2026-05-27 after owner review
**Date:** 2026-05-27
**Branch:** `smm-consolidation` (off `dev`)
**Inputs reconciled:** audit-A, critique-A, audit-B, critique-B, 00-research-scope.md, both playbooks.

---

## ⚠️ Scope correction — read this first

After owner review, the original "collapse 12 sidebar items under a single SMM parent" framing was rejected. The actual scope is **narrower**:

**Touch only these existing admin sidebar items:**
- `Editor` (the 9-tab content pipeline) — internal reorg
- `AI Source` (the AI content setup surface) — relabel to **AI Content** + merge with the `/ai-editor` user-role workflow pages

**Add one new admin-only top-level item:**
- **Marketing Content** — a dashboard hub for admins that gives an at-a-glance view of both content streams (real + AI), today's posting schedule, and quick links into Editor / AI Content / Warm-Up / Publer Mappings. Not a parent wrapping children — just a landing page.

**Add new sub-pages inside AI Content** (not new top-level items):
- **Account Warm-Up** (Brielle / Lily / Katie Rosie daily tasks)
- **Content Strategy** ("what's next for Amelia in TJP")

**Untouched** (do not edit sidebar entry, route, or page contents):
- Dashboard, Inspo Board, Creators, Whale Hunting, Photo Library, Onboarding, Invoicing, Inbox, Help, Publer (already its own item from Phase 1+2).

**Per-role views:**
- **Admin** — sees the new Marketing Content hub + Editor (internally reorganized) + AI Content (renamed + expanded). All other items unchanged.
- **Editor** — `/editor` unchanged. Header link unchanged. Internal Editor reorg means editor sees the cleaned-up tabs when they view the dashboard.
- **AI Editor** — currently lives at `/ai-editor`. Their workflow pages get folded into AI Content (role-filtered to show their workflow tabs, hide admin-only setup tabs).

**Bug investigations (missing AI edits, Katie Rosie carousel hidden) — deferred at owner request.**

The reconciliation log below and the deeper architecture decisions (Katie Rosie stub row, Day-21 sub-task chaining, Day-45 owner-approval gate, Amin Telegram bridge fix, Haiku 4.5 backfill) still apply to Batches 2-5. Batch 1 is the only batch substantially rewritten by this scope correction — see `batch-1-nav-consolidation.md` for the corrected plan.

---

## Vision (corrected)

The portal will not get a new "Social Media Management" parent. Instead, two existing admin sidebar items (`Editor`, `AI Source`) get focused improvements: Editor is internally reorganized, AI Source is renamed to AI Content and absorbs the AI editor's workflow pages so admin and AI editor stop living in separate ghettos. A new **Marketing Content** dashboard hub gives admins one place to see both content streams at a glance. Account Warm-Up and Content Strategy become sub-pages under AI Content. The three in-flight AI personas (Brielle, Lily, Katie Rosie) get day-counter-driven daily task lists. A content engine pre-fills tomorrow's posts so the operator never has to think "what's next for Amelia in TJP." Amin's manual Telegram pipe gets a dedicated per-AI-account topic (so warmup posts can't mis-route into the real creator's thread). Amin stays live for real-creator posting indefinitely and for AI-account posting until each account graduates to Publer at Day 23+.

## Hard constraints (recap)

- All Airtable schema changes **additive only** — no edits, renames, or deletes of existing fields/tables.
- All code work happens on branch `smm-consolidation` off `dev`. Never merged to `dev` or `main` without explicit owner approval.
- Every change reversible via `git branch -D smm-consolidation` (code) + Airtable column-delete (data).
- Amin (Telegram pipe) keeps working until per-account Publer goes live — gradual, per-account, not flag-day.
- Server-side role gating in `lib/adminAuth.js` is the source of truth. Sidebar filtering is courtesy/UX, never security.
- After each batch, STOP and wait for owner approval before starting the next batch.

---

## Reconciliation log

### From Critique A (Nav / section inventory)

| Audit A recommendation | Verdict | Rationale |
|---|---|---|
| Delete `/editor/inspo` wrapper "or use it consistently" (§7.12) | **REJECT** | Critic A: `components/Header.js:98` actively uses `/editor/inspo` for the editor's global top-nav. Deleting breaks editor role. **Replacement: edit `app/admin/layout.js:61` EDITOR_NAV to point at `/editor/inspo` for consistency with Header.js.** |
| Rename Creators sidebar children (earnings/dna/communication) to match per-creator-page tabs (§7.4) | **REJECT** | Critic A: index filters ≠ drilldown tabs. Different destinations, not a vocabulary drift. Leave alone. |
| Single 15-item flat SMM child list (§5) | **EDIT** | Critic A: 15 items at one depth is too much; the SMM goal is zero mental load. **Replacement: three soft visual dividers — Pipeline / Outbound / Strategy & Warm-Up — flat routing underneath.** |
| Two separate Publer sub-nodes (Mappings + Outbound — AI) (§5) | **EDIT** | Critic A: pre-Phase-3, only the mapping screen exists. **Replacement: single Publer sub-node now; Phase 3 dashboard adds an inner tab.** |
| Content Strategy under SMM with ai_editor visibility (§5) | **EDIT** | Critic A: ai_editor is hard-blocked from `/admin/*` at `app/admin/layout.js:84`. Putting Content Strategy in SMM forces a policy flip. **Decision: flip the policy in Batch 1 explicitly and gate ai_editor visibility to AI Content + Warm-Up + Content Strategy only.** |
| 12 admin sidebar items today | **KEEP** | Verified by Critic A. |
| Inspo Board stays top-level | **KEEP** | Owner mandate + cross-role rationale stands. |
| "AI Source" → "AI Content" rename, route stays | **KEEP** | Owner directive; verified safe (label-only). |
| Inbox stays top-level (ownerOnly) | **KEEP** | Verified semantics; not SMM-adjacent. |
| Audit's role-access matrix labels "Grid Planner — read-only for social_media" | **EDIT** | Critic A: API doesn't enforce read-only — `/api/admin/grid-planner` is `requireAdminOrSocialMedia` for GET *and* POST. **Decision: drop the "read-only" claim for now; treat Grid Planner as read+write for social_media. Add a `requireAdminOrSocialMediaReadonly` helper in a later sprint if owner wants the gate tightened.** |
| `components/Header.js` not audited | **ADD** | Critic A: critical coverage gap. **Decision: Batch 1 includes a full Header.js audit + edit pass for every non-admin role (editor / ai_editor / creator / chat_manager).** |
| Two-hop dashboard → admin/editor → editor redirect for `editor` role | **ADD** | Critic A: UX flash, fix in Batch 1 (`app/dashboard/page.js:22` → `'/editor'` directly). |
| Dead routes (`/admin/tonio`, `/creator/[id]/vault`, `/sonnet-test`) | **EDIT** | Audit defers to open questions. **Decision: archive (not delete) into a `_legacy/` namespace inside Batch 1, with 410-Gone responses. Reversible per the hard constraint.** |
| Inspo `recreate` tab vs `/admin/recreate-source` duplicate | **EDIT** | **Decision: keep both during Batch 1; remove Inspo `recreate` tab in Batch 1 (delete tab definition only, leave the underlying `/admin/recreate` route intact for direct-URL access).** |
| Tabs-vs-sidebar drift (Editor 7 sidebar children vs 9 page tabs) | **ADD** | Single source of truth — import the page's TABS array into the sidebar config. Implement in Batch 1. |

### From Critique B (Warm-up / strategy / Amin / Publer 3)

| Audit B recommendation | Verdict | Rationale |
|---|---|---|
| New `AI Account Profile` + `Warmup Tasks` + `Warmup Playbook Templates` tables (§A3) | **KEEP** | Schema-correct, fits the additive-only constraint, addresses the zero-scaffolding gap. |
| 3 new fields on Publer Accounts (Warmup Telegram Topic ID, AI Account Profile link, Warmup Day formula) (§A3.4) | **KEEP** | Pure-additive. |
| "Instantiate all 90 days at Account Created time" without refresh path (§A6) | **EDIT** | Critic B: in-flight accounts get stranded when templates evolve. **Replacement: instantiate up front + provide an admin action "Patch future-day tasks from latest template version" that overlays template updates onto in-flight accounts for `Day Number >= today + 1` only. Done-tasks frozen.** |
| Day-21 = one "Publer Setup task" checklist row (§A4.1) | **EDIT** | Critic B: highest-business-risk day in the playbook — wrong-link cascades cause permanent BM restriction. **Replacement: 5 separate Warmup Tasks rows with prerequisite chaining (Step N blocked until Step N-1 = Done):** (a) Create Additional Profile, (b) Create FB Page admin'd by that Profile, (c) Create Business Portfolio, (d) Link Page to IG via Account Center, (e) Day-23 authorize Publer. |
| Day-45 OF CTA as one-shot reminder card (§A1) | **EDIT** | Critic B: single highest-business-risk action in entire 90 days. **Replacement: add `Requires Owner Approval` boolean on Warmup Tasks. Day-45 task can't flip to Done until owner approval checkbox is set. Also: 48-hour soft delay between approval and task surfacing as "Action: add OF CTA."** |
| `Posts.Creator` is required → Katie Rosie has no Palm Creators row (§B7) | **EDIT** | Critic B: audit hand-waves the transition. **Decision documented below: create a stub `Palm Creators` row for standalone AI personas.** See "Final architecture decisions." |
| "Skip the cron entirely for warm-up posts" eager-send to Amin (§C4) | **REJECT** | Critic B: throws away claim-lock + stale-recovery primitives for no real benefit. **Replacement: extend existing `telegram-queue` cron with a two-line branch — if `Pipeline Target='Telegram (Warmup)'`, resolve topic ID from `Publer Accounts.Warmup Telegram Topic ID` instead of from `Palm Creators`. Reuse FIFO ordering and Sending Since lock.** |
| GPT-4o for pillar backfill at ~$25 (§B4.2) | **EDIT** | Critic B: Claude Haiku 4.5 is ~10× cheaper for the same single-label classification quality. **Replacement: Claude Haiku 4.5 (~$0.80/M in, ~$4/M out). Re-cost: ~$4 total for ~5000 Recreate Reels. Also exploit existing `Inspiration.Tags` field as a free seed before running the LLM at all.** |
| Row volume "~600 rows per account" / "~1800 for three" (§A3.2 vs §A6 inconsistency) | **EDIT** | Critic B: internal contradiction. Correct count: **~360-400 rows/account, ~1100-1200 total for 3 accounts.** Use the corrected math in capacity planning. |
| Days 22-30 treated as BUILD continuation (§A1 question 7) | **EDIT** | Critic B: playbook explicitly splits Days 15-21 (BUILD, 3-4 posts) from Days 22-30 (STEADY, 1 post every 2-3 days). **Replacement: template generator must follow the playbook's exact phase boundaries.** |
| Amin `/posted` reply convention as optional polish (§C5) | **EDIT** | Critic B: required for compliance audit trail per EU AI Act Article 50 (enforceable Aug 2 2026). **Replacement: ship `/posted` Telegram webhook handler in Batch 4. Auto-stamps `Posted At` + `Post Link` on Warmup Task.** |
| Vault URLs in Airtable (§A3.1 credentials) | **EDIT** | Critic B: Airtable backup leakage risk. **Replacement: store vault item IDs only, surface a "Copy Vault Link" client-side button that constructs URL from a base-prefix env var (`VAULT_BASE_URL`). Add explicit fields for IG TOTP Seed (vault ref), Gmail TOTP Seed (vault ref), Recovery Codes (vault ref).** |
| 14-day cross-account source-reel reuse window (audit's 3-day) (§B6) | **EDIT** | Critic B: Meta's pixel-level dedup ignores time gaps; the 3-day window is operator-vibes, not signal. **Replacement: 30-day window AND refuse cross-use across personas sharing the same agency FB account.** |
| Hardcoded `BANNED_HASHTAGS` constant (§D3) | **EDIT** | Critic B: needs owner-editable. **Replacement: new `Hashtag Denylist` Airtable table with Tag / Banned Reason / Added At / Source.** |
| Warmup Incidents table + Twin Account / Pixel Device tables | **ADD** | Critic B coverage gaps. Pure-additive Airtable, real operator value. |
| Versioned playbook templates (`Template Version` + `Instantiated Against Version`) | **ADD** | Critic B: lets owner evolve the playbook without breaking in-flight accounts. |
| Time-zone display (ET + IST in Telegram messages to Amin) | **ADD** | Critic B: Amin is in India, operator in US. Don't make Amin do mental math. |
| Cross-account caption dedup against linked real creator's account (90-day window) | **ADD** | Critic B: agency runs real + AI streams parallel. Engine must refuse a caption used on Amelia's real account in last 90 days when picking for Brielle. |
| Compliance Log row per posted task | **ADD** | Critic B: EU AI Act + FTC compliance. Per-post immutable audit row. |
| Bundle Phase 2.5 carousel per-slide reject into warmup batch (§D7) | **REJECT** | Critic B: different surface, different risk. **Replacement: carousel per-slide reject lives in Batch 5 (Publer Phase 3) with the rest of the post-Day-90 Publer work.** |

### Critique B claims I'm pushing back on (rare)

Critic B's calls are nearly all adopted, but one deserves a small note:

- Critic B suggests "use the existing telegram-queue cron with a new `Pipeline Target='Telegram (Warmup)'` value" — fully agreed (and adopted). The two-line branch is the right shape. The audit's parallel-cron proposal would have been a maintenance burden.
- Critic B flags Days 22-30 being misread by audit B as a BUILD continuation — verified against the playbook, correct call.

---

## Final architecture decisions

### Decision 1 — Katie Rosie / standalone-persona problem: STUB Palm Creators row

**Choice: Create a stub `Palm Creators` row for any AI-only persona that lacks a linked real creator.** The stub row carries metadata only (Persona Name = "Katie Rosie", Type = "AI Persona — Standalone"), and is **never the public surface for a managed creator**. It exists so the existing `Posts.Creator` required link and the existing telegram-queue / publer-queue routing logic continue to work without any branching.

**Defense:** The alternative — making `Posts.Creator` optional and adding a parallel `Posts.AI Account` link — touches the existing required-link schema (the field is `required` in code paths today) and forces every downstream consumer (telegram-queue, publer-queue, grid-planner, post-prep, the editor review queue) to grow a second routing branch. That's a much larger blast radius than a single stub row. The stub approach is purely additive, isolates the standalone-persona case in one row, and the routing code stays single-branch.

**Trade-off:** A stub Palm Creators row will show up in any list view of creators that doesn't filter on a creator-type field. Mitigation: add a new `Creator Type` single-select on Palm Creators with values `Real Creator` / `AI Persona — Standalone` (additive, doesn't rename anything). Views that filter to managed creators get a `Creator Type = "Real Creator"` filter. New, never-yet-stale.

### Decision 2 — Sidebar shape (corrected): no SMM parent

After owner review, the consolidated SMM parent was rejected. The sidebar gains **one new top-level item** (Marketing Content) and **two existing items get internal improvements** (Editor reorganized, AI Source → AI Content + ai_editor workflow merged in). Everything else is untouched.

```
ADMIN SIDEBAR (13 items — adds 1)
├── Dashboard                        [untouched]
├── Inspo Board                      [untouched]
├── Marketing Content                ← NEW. Admin-only dashboard hub.
├── Editor                           [internal reorg only — tabs reorganized, label unchanged]
├── AI Content                       ← RELABELED from "AI Source." Internal: tabs for ai_editor workflow
│                                       (folded in from /ai-editor) + setup + sub-pages Warm-Up + Strategy
├── Publer                           [untouched — from Phase 1+2]
├── Creators                         [untouched]
├── Whale Hunting                    [untouched]
├── Photo Library                    [untouched]
├── Onboarding                       [untouched]
├── Invoicing                        [untouched]
├── Inbox                            [untouched, owner-only]
└── Help                              [untouched]
```

**Marketing Content hub** (admin-only landing page; not a parent with children):
- "In flight today" — counts of AI posts in draft/scheduled + real posts in Telegram queue
- "Needs your review" — items in For Review across both streams (clickable)
- "Today's warm-up tasks" — count badge per active warm-up account (3: Brielle, Lily, Katie Rosie)
- Quick links: Editor For Review · AI Content · Account Warm-Up · Publer Mappings
- KPIs: posts published this week (later, when Publer Phase 3 data exists)

**AI Content sub-pages** (rendered inside `/admin/recreate-source` via `?tab=` or sibling routes — TBD in Batch 1):
- `Workflow` — AI editor's workflow (folded from `/ai-editor`): pick reels, Create Scene, Carousel
- `Setup` — current AI Source content (per-creator AI toggle, sources)
- `Warm-Up` — NEW. Per-account 90-day daily tasks for the 3 personas
- `Strategy` — NEW. "What's next for [creator]" engine

**Editor internal reorg** (within `/admin/editor`, same route, same sidebar label):
- Hide / move `Submissions` tab (owner doesn't use it)
- Investigate + fix the For Review filter so AI edits are visible (deferred at owner request, separate from Batch 1)
- Investigate + fix the Carousels tab visibility for Katie Rosie's in-review carousel (deferred)
- Expand Post Prep automation (Batch 3 work — caption generation, more thumbnail handling)
- Auto-grouping in Carousels using Cloudflare-resized images + Claude Haiku 4.5 (Batch 3 work)

### Decision 3 — Warmup engine output routing

**During warmup (Days 1-22 for new AI accounts):** the content engine writes to `Warmup Tasks` rows. Amin receives via the existing `telegram-queue` cron with a new `Pipeline Target='Telegram (Warmup)'` branch that resolves the topic ID from `Publer Accounts.Warmup Telegram Topic ID` rather than `Palm Creators.Telegram IG/FB Topic ID`.

**From Day 23 onward (per-account):** when the operator marks `Warmup Status = 'Live'` (typically post-Day-90, but could be Day 23+ for fast-graduating accounts), the engine starts writing to `Posts` rows directly. Existing Publer cron picks them up. Amin pipe stops firing for that account.

**Hybrid window (Days 23-90):** some accounts may run both — Publer schedules AI-content posts via the live path, while warmup-style manual posts still get sent to Amin for FB cross-posting or quota-fill. Both work simultaneously because they're on different `Pipeline Target` values. This is the "gradual transition" the hard constraints demand.

### Decision 4 — Header.js parallel pass in Batch 1

Per Critique A, `components/Header.js` is the primary navigation surface for non-admin roles. Any SMM consolidation that touches the sidebar must also touch Header.js. Batch 1 includes a full audit + edits for every non-admin role link.

### Decision 5 — ai_editor admin-layout policy flip

Currently `app/admin/layout.js:84` has `const aiEditorAllowedPath = false`, which hard-blocks ai_editor from `/admin/*`. Batch 1 flips this with an explicit allowlist:

```
aiEditorAllowedPath = pathname.startsWith('/admin/smm') && (
  searchParams.tab === 'ai-content' ||
  searchParams.tab === 'warmup' ||
  searchParams.tab === 'strategy'
)
```

Server-side gate stays the source of truth — each `/api/admin/smm/*` route checks `requireAdminOrAiEditor` for the AI-relevant tabs and `requireAdmin` for the rest.

### Decision 6 — Editor's two-hop redirect: fix in Batch 1

`app/dashboard/page.js:22` is edited to send `editor` role directly to `/editor`, eliminating the bounce through `/admin/editor` → admin layout redirect.

### Decision 7 — Dead route disposition (Batch 1)

| Route | Action |
|---|---|
| `/admin/tonio` | Archive — return 410 Gone, leave file under `app/admin/_legacy/tonio/` for git history |
| `/sonnet-test` | Archive — same pattern |
| `/creator/[id]/vault` | Archive — same pattern (was "Coming soon" stub) |
| `/api/admin/sm-workspace`, `/api/admin/sm-requests/*` (except mark-scheduled) | Leave in place — flagged for Batch 1 grep-check; if grep confirms zero callers after the consolidation lands, delete in a follow-up sprint |
| `/admin/recreate` (Inspo Board's AI Recreate tab) | Remove tab from Inspo Board navigation (`app/admin/inspo/page.js:14-23`); leave underlying `/admin/recreate` route file in place |

---

## Batches in dependency order

### Batch 1 — Nav Consolidation (corrected scope)
- **Scope:** Sidebar gains new **Marketing Content** hub entry (admin-only). `AI Source` sidebar entry relabeled to `AI Content`. `/admin/recreate-source` page absorbs the ai_editor workflow pages from `/ai-editor` as a `Workflow` sub-tab (role-filtered: ai_editor sees only Workflow; admin sees Workflow + Setup). Two placeholder sub-tabs added inside AI Content for Warm-Up (Batch 2) and Strategy (Batch 3). `ai_editor` admin-layout block flipped to allow `/admin/recreate-source` (the renamed AI Content route). Header.js gets a parallel pass for the ai_editor role's "AI Content" link. **Editor sidebar item: no structural reorg in Batch 1 — preserved for Batch 3.** No dead-route archiving. No Inspo Board changes. No `/admin/smm` parent route created.
- **Blocks on:** Nothing.
- **Estimated hours:** 6-9h (narrower than original 12-16h).
- **Key files:** `app/admin/layout.js`, `components/Header.js`, `app/admin/recreate-source/page.js`, `app/admin/recreate-source/WorkflowTab.js` (new — composes `/ai-editor` page contents), `app/admin/marketing-content/page.js` (new), `lib/sidebarConfig.js` (new optional — single source of truth).
- **Airtable changes:** **NONE.**
- **Success criteria:** Admin sees the new Marketing Content sidebar item between Inspo Board and Editor. Clicking it lands on the dashboard hub. AI Content sidebar item shows the renamed label. Clicking it lands on `/admin/recreate-source` with a 4-tab strip: Workflow / Setup / Warm-Up / Strategy (last two are placeholder cards). AI editor logs in, lands on `/ai-editor` as before (URL unchanged for back-compat), AND the new "AI Content" header link goes to `/admin/recreate-source?tab=workflow` which shows the same workflow they're used to — now inside the admin shell. Build clean, all existing roles' click-paths still work.
- **Rollback:** `git branch -D smm-consolidation` (none of Batch 1 touches Airtable; reset is a single command).

### Batch 2 — Account Warm-Up Flow
- **Scope:** Three new Airtable tables (`AI Account Profile`, `Warmup Tasks`, `Warmup Playbook Templates`) + `Warmup Incidents` + `Hashtag Denylist` + `Pixel Devices` + `SIM Inventory`. Three additive fields on `Publer Accounts`. Versioned playbook templates. `/admin/smm?tab=warmup` Today view. Per-account view (5 tabs). Playbook editor (owner-only). Day-21 sub-task decomposition with prerequisite chaining. Day-45 owner-approval gate. Pause / extend / retire flows. Backfill / catch-up mode.
- **Blocks on:** Batch 1 merged into branch.
- **Estimated hours:** 50-70h.
- **Airtable changes (additive only):** see batch doc.
- **Success criteria:** Operator can create Brielle's profile row, click "Mark Account Created," see Day 1 tasks instantiated. Mark a task Done — history records timestamp + operator. Pause / resume the warmup. The Day-21 sub-sequence enforces prerequisite chaining. Today view shows three account cards with today's tasks for each.
- **Rollback:** `git branch -D smm-consolidation` + delete the 6 new Airtable tables + 3 new Publer Accounts columns.

### Batch 3 — Content Strategy Engine
- **Scope:** Pillar tagging on `Recreate Reels`, `Carousel Projects`, `Inspiration`, `Assets`. Claude Haiku 4.5 backfill (~$4). `Creator Content Plan` table. `Caption Templates` + `Hashtag Pools` tables. `/api/admin/content-engine/next` route. Daily cron `/api/cron/warmup-content-fill` pre-fills tomorrow's post tasks. Cross-account caption dedup. 30-day source-reel reuse window. Use existing `Inspiration.Tags` as free seed.
- **Blocks on:** Batches 1 + 2 merged into branch.
- **Estimated hours:** 30-40h.
- **Airtable changes (additive only):** Pillar + Pillar Source on 4 tables, 3 new tables, no renames.
- **Success criteria:** Operator opens Today view, sees tomorrow's Brielle posts pre-filled with thumbnails, captions, hashtags. Can override before sending to Amin. Engine refuses captions used on linked real creator within 90 days.
- **Rollback:** `git branch -D smm-consolidation` + delete pillar columns + delete 3 new tables.

### Batch 4 — Amin Manual-Post Bridge
- **Scope:** `Warmup Telegram Topic ID` field on Publer Accounts. `createSmmTopicForHandle` per-AI-account integration. Two-line branch in existing `telegram-queue` cron (`Pipeline Target='Telegram (Warmup)'`). `/api/admin/smm/warmup/send-to-amin` endpoint. `/api/admin/smm/warmup/create-telegram-topic` endpoint. `/posted` Telegram webhook handler. Time-zone display (ET + IST). Compliance Log table + auto-row-on-Done. Stub Palm Creators row generator for standalone personas. Time-of-day window enforcement.
- **Blocks on:** Batches 1-3 merged into branch.
- **Estimated hours:** 25-35h.
- **Airtable changes (additive only):** `Compliance Log` table, `Creator Type` field on Palm Creators, `Posted At`, `Post Link`, `Amin Confirmed`, `Telegram Sent At`, `Telegram Message ID`, `Pipeline Target` value extension.
- **Success criteria:** "Send to Amin" button on a Brielle Day-5 task creates a Telegram message in Brielle's own forum topic (not Amelia's). Amin replies `/posted https://instagram.com/p/...` — webhook stamps `Posted At` and creates a Compliance Log row. Message body shows ET + IST. No mis-routing path exists in code (verified by test that creates a Brielle task and asserts the topic ID is from Publer Accounts, not Palm Creators).
- **Rollback:** `git branch -D smm-consolidation` + delete 1 field + delete 1 table + revert cron branch.

### Batch 5 — Publer Phase 3
- **Scope:** Schedule jitter ±15-25 min. Caption template rotation (Min). Hashtag pool rotation (Min). Banned hashtag denylist (Min — wired to the Airtable table from Batch 3). Monitoring dashboard (Min). Email alerts (Min — Resend or whatever's wired). Symmetric `Pipeline Target` validator on `telegram/enqueue`. Phase 2.5 carousel per-slide rejection UI in `CarouselSubmissionsReview.js`.
- **Blocks on:** Batches 1-4 merged into branch. At least one AI account past Day 90 (or owner override).
- **Estimated hours:** 30-40h.
- **Airtable changes:** None (all built on the schema from Batch 3 and the existing Publer Accounts / Posts tables).
- **Success criteria:** First live Publer-scheduled post lands on Brielle's IG, jittered ±15-25 min from the slot center, with a caption template marked `Used At = now`, hashtags drawn from an Active pool, no banned tags. Monitoring dashboard shows the scheduled / published / failed counts. Owner gets a test email on a fabricated failure.
- **Rollback:** `git branch -D smm-consolidation`. No data changes — Phase 3 is read-only-on-Airtable except for the symmetric validator's reject path.

---

## Success criteria — overall

- The three in-flight AI accounts (Brielle, Lily, Katie Rosie) have day-counter-driven Warmup Tasks visible in one place; the operator opens `/admin/smm?tab=warmup` once daily and runs today's list.
- No mis-routed posts: warmup posts for AI accounts cannot land in real-creator Telegram topics.
- Owner can edit the playbook template; new accounts pick up the latest version; in-flight accounts can opt into future-day patches.
- Content engine answers "what's next for Amelia (in Brielle's pillar plan)?" without manual scrolling.
- Day-21 compound is broken into auditable sub-steps; Day-45 OF CTA cannot fire without owner approval.
- Sidebar drops from 12 admin items to 10, with SMM as the single parent for 12+ filtered children.
- ai_editor can reach AI Content + Warm-Up + Content Strategy under SMM without seeing the rest.
- Every batch is independently revertible.

## Out of scope

- Any rename or delete of existing Airtable fields/tables.
- Replacing Amin globally (real-creator Telegram pipe stays unchanged for managed creators).
- Migrating chat_manager surfaces — Photo Library and chat-manager flow are untouched.
- Whale Hunting, Onboarding, Invoicing, Inbox — stay top-level, untouched.
- Building a strategy engine for real-creator accounts (engine writes only to AI accounts in Batch 3; real-creator strategy is a future sprint).
- Auto-scrape of IG's banned hashtag list (fragile, deferred).
- Slack alerts (defer to a later sprint; email-only in Batch 5).
- Reach/engagement analytics dashboard (defer; needs Publer analytics API access).
- A/B engagement-weighted caption selection (deferred — needs data first).
- Sidebar drift lint / single-source-of-truth for tabs across the whole codebase (Batch 1 fixes Editor + Inspo; other surfaces stay as-is).

## Risk register

| # | Risk | Mitigation | Owner |
|---|---|---|---|
| 1 | Day-21 mis-step cascades to permanent BM restriction | Sub-task prerequisite chaining + step-by-step deep links + verification checkbox per sub-step | Operator (Evan) |
| 2 | Day-45 OF CTA flipped early on the wrong account, account banned | Owner-approval-required field + 48h soft delay between approval and surfacing as actionable | Owner |
| 3 | Warmup post mis-routes to real creator's Telegram topic | Separate topic per AI account stored on Publer Accounts, not Palm Creators. Test asserts topic ID came from Publer Accounts, not Palm Creators | Engineer |
| 4 | Airtable export leaks credential vault URLs | Store vault item IDs only; UI constructs URL from env-var base prefix. Surface "Copy Vault Link" client-side button. | Engineer |
| 5 | Pixel hardware not purchased → none of Batch 2 onward is testable end-to-end | Hardware prerequisite tracked on `Pixel Devices` table; Batch 2 ships UI + dry-run; live test gated on hardware arrival | Owner |

---

## Notes for the executing agent

1. The hard constraint is additive-only on Airtable. Every new table and field listed in batches 2-5 is genuinely new. If you find a field that already exists with a similar name, **stop and ask** — do not rename, do not overwrite, do not migrate.
2. The branch is `smm-consolidation` off `dev`. Do not push to `main`. Do not merge to `dev` without owner approval at every batch boundary.
3. After each batch, write a handoff doc at `docs/build-plans/smm-consolidation/batch-N-handoff.md` summarizing files touched, deviations, rollback command. STOP and surface to owner.
4. The owner is `evan@palm-mgmt.com`. Comms style: lead with the recommendation, give dollar amounts, no abstract trade-off tables unless asked.
5. Server-side role gating in `lib/adminAuth.js` is the source of truth. Every new `/api/admin/smm/*` route must use the appropriate `require*` helper. Sidebar filtering is courtesy only.
6. Use **Claude Haiku 4.5** for the pillar backfill (Batch 3), not GPT-4o. Cost ~$4 vs ~$25.
7. The corrected row count is **~360-400 Warmup Tasks rows per account**, totaling **~1100-1200 rows for three accounts**. Airtable Business supports 50k records per table — no capacity concern.
8. Days 22-30 are STEADY (lighter cadence), not BUILD continuation. The playbook template generator must split the phases.
