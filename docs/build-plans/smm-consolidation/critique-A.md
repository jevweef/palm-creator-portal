# Critique A — Verification of Audit A

**Critic:** Critic A
**Date:** 2026-05-27
**Subject:** `audit-A-section-inventory.md`
**Method:** Read each concrete claim against the live code at `/Users/jevanleith/palm-creator-portal`. Spot-checked sidebar counts, role guards, route gates, file structure, and consolidation recommendations.

---

## Summary verdict

Audit A is a **solid foundation**. Its inventory of the 12 admin sidebar entries, the 9 editor tabs vs. 7 sidebar children mismatch, the per-creator-page vocabulary mismatch, the `social_media`-API dead-code, the AI-stream scatter, and the role-guard citations are all directly verifiable in the code. Its proposed consolidated SMM parent + flat-children shape is defensible, role-respectful, and consistent with the owner's vision and the hard constraint that Inspo Board stays top-level. The synthesizer should adopt the bulk of Audit A as-is, with **three corrections** and **four additions** that I lay out below. The most important correction is that the audit recommends "delete `/editor/inspo` wrapper or use it consistently" — but the wrapper is actively used by `components/Header.js:98`, so deleting it would break the global header nav for the editor role. The most important coverage gap is that **the audit treats `/admin/editor` Editor sidebar as a hard "fold into SMM" decision without addressing what happens to the existing `/editor` (editor role's own surface) or the editor-role redirect logic that ping-pongs between `/admin/editor` and `/editor`** — there is real routing fragility here that the consolidation will inherit if not addressed.

---

## Verified claims

| Audit claim | Verification |
|---|---|
| 12 top-level admin sidebar entries | Confirmed. `app/admin/layout.js:8-52` defines ADMIN_NAV with exactly 12 items: Dashboard, Inspo Board, AI Source, Editor, Creators, Whale Hunting, Photo Library, Publer, Onboarding, Invoicing, Inbox, Help. |
| Inspo Board sidebar has 8 children | Confirmed. `app/admin/layout.js:11-19` lists pipeline, sources, review, import, candidates, training, suggest, recreate (8). Mirrored at `app/admin/inspo/page.js:14-23`. |
| Editor sidebar has 7 children but the page has 9 tabs | Confirmed. Sidebar children at `app/admin/layout.js:22-28` are 7 (editorview, review, postprep, grid, library, oftv, longform). Page TABS at `app/admin/editor/page.js:2640-2649` are 9 (adds `submissions` and `carousels`). |
| Creators sidebar children (earnings, dna, communication) don't match per-creator-page tabs (profile, documents, tags, music, superclone, adjustments) | Confirmed. Sidebar: `app/admin/layout.js:31-33`. Page: `app/admin/creators/page.js:2487`. |
| Inbox sidebar has `ownerOnly: true` flag | Confirmed. `app/admin/layout.js:46` has `ownerOnly: true`. The `INBOX_OWNER_EMAILS` allowlist is at `lib/adminAuth.js:40` (audit cited 40-60; actual block is 40-49 — a minor off-by-one but the semantics are right). |
| Inbox has 3 children: Tasks / Messages / Setup | Confirmed. `app/admin/layout.js:47-49` and rendering at `app/admin/inbox/page.js:1648-1649` (tab keys `chats`, `setup`, default `tasks`). |
| AI editor sidebar is empty (`isAiEditor ? []`) | Confirmed. `app/admin/layout.js:148-149`. |
| `aiEditorAllowedPath = false` hard-blocks ai_editor from /admin/* | Confirmed. `app/admin/layout.js:84` is exactly `const aiEditorAllowedPath = false`. Redirect to `/ai-editor` at line 116. |
| Chat-manager NAV is dead code | Confirmed. `CHAT_MANAGER_NAV` at `app/admin/layout.js:64-66` is defined but never used in the rendered nav (the `NAV_ITEMS` ternary at lines 148-150 only resolves to `[]`, `ADMIN_NAV`, or `EDITOR_NAV`). Chat managers are bounced to `/photo-library` at line 128-130, where `app/photo-library/layout.js` renders no sidebar. |
| `/admin/posts` is imported as a component into `/admin/editor` | Confirmed. `app/admin/editor/page.js:7` has `import PostsPage from '@/app/admin/posts/page'`. |
| `/ai-editor` page is ~1242 lines, has 3 tabs (workspace / create / carousel) | Confirmed. Actual is 1241 lines (off by 1 — pedantic). Tab keys at `app/ai-editor/page.js:780` are `workspace`, `create`, `carousel`. |
| `/api/admin/sm-workspace` and `/api/admin/sm-requests/*` have no callers | Confirmed via `grep -rn`. The only call to any `sm-*` route is `components/GridPlanner.js:2299` calling `/api/admin/sm-grid/mark-scheduled`. Audit's "vestigial dead code" framing is accurate. |
| `requireAdminOrSocialMedia` gates telegram/enqueue, grid-planner, sm-* routes | Confirmed. `app/api/admin/telegram/enqueue/route.js:17`, `app/api/admin/grid-planner/route.js:181`, `app/api/admin/sm-grid/mark-scheduled/route.js:9`. Helper defined at `lib/adminAuth.js:146-166`. |
| Publer routes are all `requireAdmin` (not socialMedia or ai_editor) | Confirmed. `app/api/admin/publer/accounts/route.js:23`, `enqueue/route.js:32`, `mappings/route.js:22`, `sync-accounts/route.js:38` all use `requireAdmin()`. The audit's role matrix saying "Publer Mappings — admin-only" is accurate against the actual route gate. |
| `requireAdminOrAiEditor` covers `/api/admin/recreate-rooms/stage-b/start`, `/api/ai-editor/upload` | Confirmed. `app/api/admin/recreate-rooms/stage-b/route.js:172` and `app/api/ai-editor/upload/route.js:30`. |
| Editor's "My Dashboard" at `/editor` has 3 tabs: Dashboard / Revisions / OFTV Projects | Confirmed. `app/editor/page.js:52-54`. Plus a "Long Form Upload" tab that exists as a route but is **removed from the tab strip** per the comment at lines 47-51 — audit said this surface lives at `/editor` but didn't note the longform tab was deliberately removed from editor's view (minor omission). |
| `/admin/tonio` is 27 lines, "Hi Tonio 👋" | Confirmed. Exactly 27 lines, just renders a heading. |
| `/creator/[id]/vault` is a 9-line "Coming soon" stub | Confirmed. Exact line count 9, "Coming soon" copy at line 6. |
| `/creator/[id]/inspo` is a pure 7-line wrapper of `/app/inspo/page.js` | Confirmed. Actually 8 lines including a blank — close enough. Imports and passes `opsIdOverride`. |
| `/creator/[id]/my-content` is a pure wrapper of `/app/my-content/page.js` | Confirmed. 9 lines, passes `opsIdOverride` and `hqIdOverride`. |
| `/inspo/page.js` accepts `isEditor` and `opsIdOverride` props and renders for admin/editor/creator | Confirmed. `app/inspo/page.js:161` signature `InspoBoard({ opsIdOverride, isEditor } = {})`. Role logic at lines 195-201. |
| Sidebar active-state hardcodes `/admin/sources`, `/admin/review`, `/admin/import` for Inspo, missing the newer tabs | Confirmed. `app/admin/layout.js:261-262` does exactly that. Navigating to `/admin/candidates`, `/admin/training`, `/admin/suggest-test`, `/admin/recreate` will not light up the Inspo Board sidebar entry. |
| `EDITOR_NAV` points Inspo Board to `/inspo`, not `/editor/inspo` | Confirmed. `app/admin/layout.js:61`. |
| Editor's role lands on `/editor` via the layout redirect | Confirmed. `app/admin/layout.js:122-124` redirects `isEditor` away from `/admin/*` to `/editor`. (Though see "Coverage gaps" below — there's a competing redirect from `app/dashboard/page.js:21` that sends editor to `/admin/editor`, then admin layout bounces them back. Two-hop redirect.) |
| Posts cron flow (Step 7 — every minute, 1 post/tick) | Verified the flow chart against `app/api/admin/telegram/enqueue/route.js` setting `Status='Queued for Telegram'` at line 30. The cron details I did not re-verify (audit's flow diagram is presumably sourced from the existing build-plan docs and memory). |

The factual scaffolding holds up.

---

## Refuted claims

### 1. `/ai-editor/recreate` is NOT a "legacy direct-URL entry to recreate workflow" — it is a **redirect-only** shim. (severity: minor)

**Audit said:** Section 1.1 row 9 — "`/ai-editor/recreate` — Legacy direct-URL entry to recreate workflow (subpath under TJP layout)."

**Code says:** `app/ai-editor/recreate/page.js` is 26 lines and does nothing but `router.replace('/ai-editor?tab=create&...')`. There is no separate recreate workflow at that path. The comment in the file (lines 3-5) explicitly says "Create Scene is now a tab on /ai-editor itself, not a separate page. This component just redirects."

**Why this matters:** Audit Section 7.1 lists `/ai-editor/recreate` as one of "three places" the AI workflow is in. It isn't — it's a redirect to the same place. So the scatter is in three places, not four. Adjust the pain-point narrative accordingly. Doesn't change the consolidation shape, but slightly weakens the "AI workflow is in too many places" framing.

### 2. Audit says delete `/editor/inspo` wrapper "or use it consistently" — but it IS being used by the global header. (severity: critical)

**Audit said:** Section 7.12 — "EDITOR_NAV's Inspo Board target is `/inspo`, not `/editor/inspo`. Both routes work and render the same UI, but the wrapper at `/editor/inspo` exists (`app/editor/inspo/page.js`) and is unused by the nav. Either delete the wrapper or use it consistently."

**Code says:** `components/Header.js:98` — `<Link href="/editor/inspo" ...>Inspo Board</Link>` — the editor-role header nav routes to `/editor/inspo`, not `/inspo`. The wrapper is **actively used** for editor-role navigation; the admin sidebar's EDITOR_NAV is the inconsistent one. Deleting the wrapper would break the global header for editors.

**Why this matters:** This is a recommendation the synthesizer should NOT take as-is. The correct fix is to make `app/admin/layout.js:61` use `/editor/inspo` for consistency with Header.js — not the other way around. Severity is critical because a sibling agent might take "delete the wrapper" literally during implementation and break the editor's top nav.

### 3. Audit's "EDITOR_NAV → editor lands on /inspo" framing oversimplifies a two-hop redirect. (severity: minor)

**Audit said:** Section 1.1 row 3 — "`/dashboard` ... redirects to ... `/admin/editor` (editor)." Section 6 "Specific role landing pages: editor → /editor (unchanged)."

**Code says:** Both are partially right but together they hide a redirect bounce. `app/dashboard/page.js:21-23` sends an `editor` role to `/admin/editor`. `app/admin/layout.js:122-124` then redirects `isEditor` away from `/admin/*` to `/editor`. Net result is `/editor`, but with a flash and two `router.replace` calls.

**Why this matters:** When the SMM consolidation folds the admin "Editor" sidebar entry into `/admin/smm`, this redirect chain inherits the same fragility. Either fix the dashboard router to send editors directly to `/editor`, or commit to giving editors access to a slice of `/admin/smm` (which would require flipping the admin-layout's `isEditor` bounce). The audit doesn't acknowledge the chain. Affects batch-1 plan.

### 4. Audit's Step 6 caption: "Bulk-marks Posts: Status='Queued for Telegram'" is right, but **the comment that the role-gate is `requireAdminOrSocialMedia (lib/adminAuth.js:146-166)`** glosses over a subtle policy question. (severity: minor → escalate as open question)

**Audit said:** Section 3 Step 6 — "Role-gated: requireAdminOrSocialMedia (lib/adminAuth.js:146-166)".

**Code says:** Line numbers are correct (`lib/adminAuth.js:146-166` is exactly the `requireAdminOrSocialMedia` function). But the audit's role matrix in Section 6 says **Post Prep is admin-only** ("Admin-only — caption/hashtag/thumb is admin gate"). Yet **the enqueue button that fires inside Post Prep** is `requireAdminOrSocialMedia` — meaning the API will accept calls from a `social_media` user. So if the UI lets a social_media user hit the button, they can enqueue. Today the UI doesn't let them (no Post Prep page surfaced), but the policy is contradictory if the SMM consolidation gives `social_media` any view of Post Prep.

**Why this matters:** When the new SMM dashboard surfaces enqueue-style actions to Amin (per owner's vision), the role gate behind the button might be more permissive than the role gate on the page. Worth a 30-second decision: tighten enqueue to `requireAdmin`, or open Post Prep to `requireAdminOrSocialMedia`. The audit doesn't flag this — should be an open question for the owner.

### 5. Audit claims "Sidebar children for 'Creators' don't match the per-creator page tabs ... Different vocabularies for the same destination." Implies a problem. (severity: minor disagreement)

**Audit said:** Section 7.4 — frames this as a pain point.

**Code says:** Confirmed the mismatch (sidebar = earnings/dna/communication; page = profile/documents/tags/music/superclone/adjustments). **But** I'd argue these aren't the same destination — the sidebar children look like list-view filters (e.g., `?tab=earnings` filtering the creator INDEX), while the page tabs are per-creator drilldown tabs. Without verifying the index route behavior I can't be 100%, but it's plausibly intentional design rather than vocabulary drift.

**Why this matters:** Audit treats this as a fix-item ("Different vocabularies for the same destination"). Synthesizer should not commit to renaming until the owner confirms whether earnings/dna/communication are index filters or destination tabs. Could be left alone.

---

## Coverage gaps — things the audit missed

### 1. `components/Header.js` is not in the audit's inventory at all.

The audit covers `app/admin/layout.js` (admin sidebar) and the per-role layouts but doesn't mention the **global top-nav** at `components/Header.js`. This file (~140+ lines) drives the cross-page header navigation for editors, AI editors, creators, and chat managers — it's the *primary* navigation surface for non-admins. Examples:
- Line 85: logo-link destination per role
- Line 98: editor's Inspo link → `/editor/inspo` (the wrapper audit said to delete)
- Line 109: AI editor's only nav link
- Lines 113-114: creator's dashboard / my-content links

Any SMM-consolidation plan needs to address whether Header.js needs updates when the new `/admin/smm` parent ships. The audit's proposal flips `ai_editor` to access `/admin/smm` — which means Header.js needs a new nav link for ai_editor pointing into SMM, or the sidebar takes over and Header.js' AI Editor link gets retired.

### 2. The dashboard router (`app/dashboard/page.js`) sends editors to `/admin/editor`, which then bounces to `/editor`.

Already noted in "Refuted claims #3." Affects the consolidation plan because the SMM parent may need to handle editors landing on its `?tab=review` or `?tab=carousels` views — which means either fixing the dashboard router or formalizing the bounce.

### 3. Audit's flow diagrams omit the **Carousel review** branch at admin review.

Section 3 Step 3 ("Admin reviews") implies a single Approve/Reject decision. But carousel review is a distinct surface (`/admin/editor?tab=carousels` → `CarouselSubmissionsReview.js`) with its own approval flow. Section 4 Step 6 nods at it ("Carousel approval handled in CarouselSubmissionsReview.js") but the real-stream flow in Section 3 doesn't mention it. If carousels can be submitted by editors (not just ai-editors), the real-stream chart is incomplete. **Worth verifying:** does the `submissions` tab (the 9th tab, missing from sidebar) handle carousel submissions from editors? Auditor didn't check.

### 4. `/api/admin/grid-planner` is gated `requireAdminOrSocialMedia` but the audit's role matrix says "Grid Planner — read-only (today + tomorrow only)" for `social_media`.

Line `app/api/admin/grid-planner/route.js:181, 690, 890` are all `requireAdminOrSocialMedia`. The API doesn't differentiate read-only vs. read-write by role. So if `social_media` is admitted to the Grid Planner UI at all, they can write. The "read-only" qualification in the audit's role matrix is **aspirational, not enforced**. The synthesizer needs to either tighten the API gate for the read-only sub-view or accept that the courtesy-only filtering is doing real security work (against the project's stated principle that "Server-side role gating in `lib/adminAuth.js` is the source of truth").

### 5. The audit doesn't mention `/api/editor/*` routes used by `/admin/editor` (the operator surface), which adds a `requireAdminOrEditor` cross-role surface.

`app/admin/editor/page.js:1043` calls `/api/editor/tasks`. The `/api/editor/*` namespace uses `requireAdminOrEditor` for cross-role read/write. If the SMM consolidation moves the operator's review tab to `/admin/smm`, the route gates need to stay aligned. Easy oversight but worth a one-line callout in batch-1.

### 6. Creator-layout (`app/creator/[id]/layout.js`) not inventoried.

Audit lists the creator routes but not the creator layout's role check. If creators get added to any SMM child node (the audit's matrix says creators are hidden everywhere in SMM, which is correct), the layout's gate is still load-bearing for `/creator/[id]/inspo` and the other wrappers. One-line check, but it should be in the inventory.

### 7. `/api/admin/sm-requests/backfill-topics` lives under `sm-requests/` — audit lists it as "orphaned" but doesn't note that it has a different shape (a one-time backfill script, not a per-request endpoint).

Minor. Probably safe to delete with the rest of the `sm-*` dead code, but the synthesizer should grep before removing — a manual operator may invoke `backfill-topics` directly on a schedule or via a cron we haven't found.

### 8. The `OffboardModal.js` co-located in `app/admin/` is not mentioned.

It's a component used by the onboarding flow, not its own route, but it's in `app/admin/`, which is unusual. Doesn't affect SMM directly, but it's noise in the audit's "page inventory" framing.

### 9. The audit doesn't address `/api/admin/posts/*` routes (the posts endpoints used by the Post Prep tab).

Post Prep is a key SMM action. Its API gates were not spot-checked in the audit. Worth a one-liner: are these `requireAdmin` or `requireAdminOrSocialMedia`? Affects whether Amin (and Phase-3 successor) can prep posts or only enqueue.

---

## Recommendations the synthesizer should REJECT

### REJECT-1: "Either delete the `/editor/inspo` wrapper or use it consistently" (Section 7.12)

**Why wrong:** The wrapper is actively used by `components/Header.js:98`. Deleting it breaks the editor's top nav.

**Do instead:** Change `app/admin/layout.js:61` `EDITOR_NAV` Inspo Board target from `/inspo` to `/editor/inspo` for consistency with Header.js. Or, simpler, leave both routes alive — they render the same UI and the redundancy is cheap. The "fix" here is a one-line edit to EDITOR_NAV, not a delete.

### REJECT-2: "Sidebar children for 'Creators' don't match the per-creator page tabs ... Different vocabularies for the same destination" (Section 7.4) — taken as a fix-item.

**Why wrong:** Likely not the same destination. Sidebar children look like list-view filters (admin/creators index sliced by category), while page tabs are drilldown tabs. The audit doesn't verify the index page behavior before declaring a mismatch.

**Do instead:** Leave alone unless the owner confirms it's a real pain point. Add to open questions.

### REJECT-3: The proposed SMM-parent flat list with 15 children (Section 5)

**Why wrong:** 15 children at one nav-tree depth is a lot. Even with role filtering, the admin view still shows ~12 nodes. The owner's stated goal is "Zero mental load" for Account Warm-Up — but a 15-item sidebar adds mental load *before* you reach Warm-Up. The audit dismisses nested groups ("Real / AI sub-folders feel cleaner on paper") but doesn't seriously consider a 2-group split.

**Do instead:** Two layers of grouping for admin (a soft visual divider, not a full nested fold):

```
Social Media Management
  — Pipeline —
  • Overview
  • Review Queue
  • Post Prep
  • Carousels
  • Grid Planner
  • Creator Library
  • OFTV Projects
  • Long Form Upload
  — Outbound —
  • Outbound — Real (Telegram)
  • Outbound — AI (Publer)
  • Publer Mappings
  — Strategy / Warm-Up —
  • AI Content
  • Account Warm-Up
  • Content Strategy
```

The "—Section—" labels are visual dividers in the sidebar, not nested routes — every child still routes flat (`/admin/smm?tab=warmup` etc.). Role filtering then naturally trims the visible groups. The Editor sees only the Pipeline group + Library/OFTV/Long Form. Amin sees Outbound — Real + Account Warm-Up.

### REJECT-4: Section 5 puts "Publer Mappings" alongside "Outbound — AI (Publer)" as separate children.

**Why wrong:** Today the `/admin/publer` page is the mapping screen. The audit proposes folding it in as "Publer Mappings" while adding a separate "Outbound — AI (Publer)" dashboard. The owner has not asked for two separate Publer surfaces. Adding both before Phase 3 lands is over-engineering.

**Do instead:** Ship a single "Publer" sub-node that has the existing mapping screen plus a Phase 3 dashboard tab inside it. Don't pre-build two parallel surfaces for Phase 3 work that hasn't started.

### REJECT-5: Section 5 places "Content Strategy" as a sub-node of SMM with the **AI editor visibility**.

**Why partially wrong:** Owner's vision says Content Strategy answers "what's next for [creator] in TJP?" That's the AI editor's question. If the primary user is the AI editor, putting it under SMM (which the audit says ai_editor today can't even see — `/admin/*` is hard-blocked at `app/admin/layout.js:84`) forces the consolidation to flip the ai_editor's admin-layout policy in batch-1. That's a significant scope addition not signaled in the audit's batch hint.

**Do instead:** Defer the placement decision. Either (a) keep Content Strategy as a tab inside `/ai-editor` (matching the existing TJP UI surface) and only mirror an admin view into SMM, or (b) flip the ai_editor admin-layout policy as a deliberate batch-1 step with explicit before/after testing. The audit lumps it in without surfacing the policy flip. Open question #7 in the audit does mention this — but it's an open question and the consolidated sidebar shape was proposed as if the policy flip were already decided.

---

## Recommendations the synthesizer should ADD

### ADD-1: A "header-nav" parallel inventory pass before any consolidation work starts.

Audit covered the admin sidebar exhaustively but not `components/Header.js`. The synthesizer's batch-1 doc should include a one-page Header.js audit listing every role's header links and what they should become after SMM consolidation. Without this, the editor's Inspo Board link will keep going to `/editor/inspo`, the ai_editor's only link will stay at `/ai-editor`, and the consolidation won't show up in the cross-page top nav for non-admins.

### ADD-2: A "redirect chain" cleanup pass.

The dashboard → admin/editor → editor two-hop bounce for the `editor` role is a UX flash and a redirect-after-redirect penalty on every editor login. Fix it once during batch-1. Either:
- `app/dashboard/page.js:22` change `'/admin/editor'` to `'/editor'`, OR
- accept the bounce as Documented Behavior

Also: the `chat_manager` redirect at `app/admin/layout.js:128-130` is correct, but the dashboard router at lines 24-26 also handles it — duplicate logic.

### ADD-3: An explicit "Phase-1 audit of dead routes to delete or document."

The audit identifies dead/abandoned routes (`/admin/tonio`, `/creator/[id]/vault`, `/sonnet-test`, `/admin/recreate` vs. `/admin/recreate-source`, the `sm-workspace`/`sm-requests` family) but defers the kill decision to open questions. Batch-1 should commit to one decision per item: delete, archive (move under `/admin/_legacy/*` with a 404-friendly redirect), or keep. Leaving them in limbo is what got the codebase here.

### ADD-4: A role-permission rationalization step.

The mismatch between course-grained API gates (`requireAdminOrSocialMedia` covers grid-planner read AND write) and fine-grained UI promises (audit's "Grid Planner — read-only for social_media") needs reconciling. Two options:
- Add `requireAdminOrSocialMediaReadonly` style helpers that distinguish GET from POST/PATCH/DELETE
- Or accept that the UI is courtesy-only and the role can fully edit Grid

The audit punts on this. Synthesizer should make the call (probably the first — add a helper or annotate routes).

### ADD-5: A "Publer route gate" check before Phase 3 ships.

Audit's role matrix says Publer is admin-only. The Publer API routes are all `requireAdmin` (verified). When Phase 3 ships a monitoring dashboard, the question becomes: is the dashboard read-only-admin, or do we want a future read-only-`social_media` slice? Make the call now so the route guards land right.

### ADD-6: A "tabs-vs-sidebar drift" lint or guard.

The Editor sidebar (7 children) drifted from the Editor page (9 tabs) because nobody updates both. Same with the Inspo Board active-state in `app/admin/layout.js:261-262`. The synthesizer should propose a single source of truth (the page's TABS array exported, imported by the sidebar) so adding a tab automatically updates the sidebar. Adds value beyond the SMM consolidation.

### ADD-7: A creator-side surface ack.

Audit treats `/creator/*` as out of scope (they're cross-role wrappers). But the consolidation's role-filtered SMM will need to NOT bleed into creator views. The synthesizer should explicitly state that `/admin/smm/*` is admin-and-editor-and-ai_editor-and-social_media only, never creator. Creators access content via `/creator/[id]/*` and that's it. One sentence, but it forecloses a class of misunderstanding.

---

## Role-access matrix spot-check

Audit Section 6 produces a role × sub-node visibility matrix. I spot-checked four cells against the actual route guards:

| Cell | Audit said | Code says | Verdict |
|---|---|---|---|
| Grid Planner × social_media | "read-only (today + tomorrow only)" | `app/api/admin/grid-planner/route.js:181,690,890` all `requireAdminOrSocialMedia` — no read/write split | **Aspirational, not enforced.** Audit overstates the actual security boundary. |
| Post Prep × social_media | "hidden" | The enqueue API (`/api/admin/telegram/enqueue`) accepts `social_media`. Page-level there's no Post Prep at all for that role today (no UI). | Conditional: "hidden" by virtue of no UI, not by virtue of role gate. The gate is permissive. |
| AI Content × ai_editor | "visible (sub-set: library + photos, not freeform admin tools)" | `/admin/recreate-source` is under `app/admin/layout.js` which hard-blocks `ai_editor` at line 84. `requireAdminOrAiEditor` exists in `lib/adminAuth.js:120-140` but the page-level gate is admin-only via the layout. | **Currently impossible to access.** The audit's proposal requires flipping `aiEditorAllowedPath` and adding finer-grained tab filtering. This is a real scope item, not a free win. |
| Outbound — Real × social_media | "visible (Amin's primary surface during transition)" | No page exists today for `social_media`. `/api/admin/telegram/enqueue` allows them via API. Page must be built. | New build, not "visible" today. The matrix mixes proposed and existing state without labeling — minor confusion. |

**Verdict on the matrix:** It's a useful target state, but the audit doesn't label which cells are "today" vs. "proposed." The synthesizer should split the matrix into two: "current enforcement" and "target after batch-1 lands." Otherwise the matrix gets used as evidence of what's possible when it's actually a wish-list.

---

## Open questions worth escalating

(In addition to the audit's existing 10 open questions, which are reasonable.)

1. **`/editor/inspo` wrapper:** keep, or migrate Header.js:98 to `/inspo` and delete the wrapper? Audit recommends delete; I recommend keep-and-align-EDITOR_NAV.

2. **Sidebar group dividers:** comfortable with a 15-item flat list under SMM, or want a two-line "Pipeline / Outbound / Strategy" group structure inside SMM? (See REJECT-3.)

3. **Editor's two-hop login redirect:** `/dashboard` → `/admin/editor` → `/editor`. Fix to single-hop, or leave alone?

4. **Grid Planner role-gate granularity:** does `social_media` need a read-only Grid view, or is read+write OK? Today's API doesn't split.

5. **Post Prep `requireAdmin` vs. enqueue `requireAdminOrSocialMedia`:** which role gate is canonical? The page is admin-only, the enqueue button is not.

6. **Publer surface count:** one combined Publer sub-node (Mappings + Phase-3 dashboard as inner tabs), or two separate sub-nodes (Mappings + Outbound — AI)? Audit proposes two; I propose one until Phase 3 ships.

7. **AI editor's first SMM exposure:** AI Content + Warm-Up + Strategy. All three at once in batch-1, or staged (AI Content first, Warm-Up + Strategy in batch-2/3)? The audit's batch-1 proposal implicitly assumes all three together. That's a meaningful policy flip.

8. **Carousel review surface ownership:** today the carousels tab lives inside `/admin/editor`. Should it stay grouped with Review Queue under SMM, or get its own sub-node? The 9th tab of the editor page suggests it deserves first-class billing, but the audit folds it as one of many children.

9. **Inspo Board's `recreate` tab vs. `/admin/recreate-source`:** audit notes the overlap but defers the kill decision. The synthesizer should commit. Recommendation: kill the Inspo Board `recreate` tab, point operators to `/admin/smm?tab=ai-content` (the relabeled recreate-source).

10. **`/sonnet-test`, `/demo`, `/admin/tonio`, `/creator/[id]/vault`:** four abandoned-looking routes. Delete all four, or keep `/demo` as a public marketing route? Probably delete the other three.

---

## Bottom line

Audit A is the right inventory. The corrections above are surgical — a wrapper-not-dead clarification, a redirect-chain note, a sidebar-shape opinion, and a role-matrix labeling fix. The synthesizer should base the master plan on Audit A's structure, layer in the additions (Header.js inventory, redirect cleanup, dead-route commit), and label the role matrix as "target state" rather than "current state."

The consolidation as proposed is achievable in one batch if and only if the `ai_editor` admin-layout policy flip is owned explicitly. Otherwise it slips to batch-2 and the SMM parent ships admin-only first.
