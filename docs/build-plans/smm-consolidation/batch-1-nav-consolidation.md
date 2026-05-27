# Batch 1 — Nav Consolidation

**Status:** READY TO EXECUTE
**Branch:** `smm-consolidation` (off `dev`)
**Estimated time:** 12-16 hours
**Airtable changes:** NONE
**Predecessor:** master-plan.md

## Goal

Collapse the 12-entry admin sidebar into a 10-entry sidebar with a role-filtered **Social Media Management** parent (3-group soft divider — Pipeline / Outbound / Strategy & Warm-Up), rename "AI Source" → "AI Content" (label only), open ai_editor access to three SMM tabs, fix the editor two-hop redirect, archive three dead routes, and align `components/Header.js` with the new sidebar — all on a single branch, all reversible, no Airtable changes.

## Prerequisites

- [ ] Branch `smm-consolidation` exists off latest `dev`. Worktree at `.claude/worktrees/smm-consolidation` if using EnterWorktree.
- [ ] `npm install` is clean (no lockfile drift).
- [ ] `next build` passes from a clean checkout of `dev`.
- [ ] Read `master-plan.md` end-to-end before starting.
- [ ] Skim `app/admin/layout.js`, `components/Header.js`, `app/dashboard/page.js`, `app/admin/recreate-source/page.js`, `app/admin/inspo/page.js`, `app/editor/page.js`, `app/ai-editor/page.js`.

## Files to touch

Exhaustive list. Every file touched in Batch 1 is on this list. If a file isn't on this list and you find yourself editing it, **stop and confirm with the owner**.

- `app/admin/layout.js` — sidebar `ADMIN_NAV` rewrite to use SMM parent + 3-group divider; `EDITOR_NAV` Inspo target change; `aiEditorAllowedPath` flip.
- `components/Header.js` — per-role link pass: editor, ai_editor, creator, chat_manager.
- `app/dashboard/page.js` — editor's two-hop redirect fix (line 22: `'/admin/editor'` → `'/editor'`).
- `app/admin/inspo/page.js` — remove `recreate` tab from the tab strip; leave the route alive.
- `app/admin/recreate-source/page.js` — change sidebar label only ("AI Source" → "AI Content"). The page header/title can also relabel for consistency, but the route stays `/admin/recreate-source`.
- `app/admin/smm/page.js` — **NEW** wrapper that reads `?tab=` and renders the appropriate sub-surface (Overview is the default landing).
- `app/admin/smm/layout.js` — **NEW** thin layout that asserts role with `requireAdmin || requireAdminOrEditor || requireAdminOrAiEditor || requireAdminOrSocialMedia` depending on the requested tab.
- `app/admin/_legacy/tonio/page.js` — **NEW** (move from `app/admin/tonio/`), returns 410 Gone.
- `app/admin/_legacy/sonnet-test/page.js` — **NEW** (move from `app/sonnet-test/`), returns 410 Gone.
- `app/admin/_legacy/vault/page.js` — **NEW** (move from `app/creator/[id]/vault/`), returns 410 Gone with creator-redirect notice.
- `lib/sidebarConfig.js` — **NEW** centralized sidebar config (single source of truth, imported by both `app/admin/layout.js` and any future drift-lint).

## Step-by-step build order

### Step 1 — Create the new sidebar config (single source of truth)

Create `lib/sidebarConfig.js` exporting:
- `ADMIN_NAV_TOP_LEVEL` — array of 10 items (Dashboard, Inspo Board, SMM, Creators, Whale Hunting, Photo Library, Onboarding, Invoicing, Inbox, Help).
- `SMM_CHILDREN` — flat array of 12 SMM children, each tagged with `group: 'pipeline' | 'outbound' | 'strategy'` and `roles: string[]`.
- `EDITOR_NAV` — 2 items (My Dashboard, Inspo Board), with Inspo pointing at `/editor/inspo`.
- `getSidebarFor(role, currentPath)` — pure function returning the filtered + grouped sidebar tree.

Test: write a tiny vitest or vanilla node assertion file (`scripts/sidebar-config.test.mjs`) that asserts `getSidebarFor('admin', '/admin/smm')` returns 10 top-level items + 12 SMM children grouped 7/2/3.

### Step 2 — Rewrite `app/admin/layout.js` to consume the config

- Remove the hard-coded `ADMIN_NAV` / `EDITOR_NAV` / `CHAT_MANAGER_NAV` arrays.
- Import from `lib/sidebarConfig.js`.
- Replace the rendering logic with a recursive renderer that handles the new `group` divider (a non-clickable `<div className="sidebar-divider">` between children).
- Flip `aiEditorAllowedPath`:
  ```
  const aiEditorAllowedPath = pathname.startsWith('/admin/smm') &&
    ['ai-content', 'warmup', 'strategy'].includes(searchParams.get('tab'));
  ```
- Update the Inspo active-state check (currently at `app/admin/layout.js:261-262`) to cover all 8 Inspo tabs, not just 3.
- Verify: load the page as admin, see the 10-item sidebar + SMM with 3 dividers; load as editor, see 2-item EDITOR_NAV.

### Step 3 — Create `app/admin/smm/{layout,page}.js`

- `app/admin/smm/layout.js`: thin wrapper that gates access by role + tab. Pseudocode:
  ```
  const tab = searchParams.tab || 'overview';
  if (tab in {'overview','review','postprep','grid','library','oftv','longform','outbound-real','outbound-ai','publer-mappings'}) {
    await requireAdminOrEditor() // or admin-only for postprep etc.
  } else if (tab in {'ai-content','warmup','strategy'}) {
    await requireAdminOrAiEditor()
  }
  ```
  Use the existing `lib/adminAuth.js` helpers; do NOT invent new ones in Batch 1.
- `app/admin/smm/page.js`: switch on `?tab=` and dynamic-import the appropriate child surface. For Batch 1, the child surfaces are mostly *aliases* — they re-export the existing pages:
  - `overview` → new simple landing component
  - `review` → re-export `app/admin/editor/page.js` with `?tab=review` already set
  - `postprep`, `grid`, `library`, `oftv`, `longform`, `carousels` → same pattern
  - `ai-content` → re-export `app/admin/recreate-source/page.js`
  - `publer-mappings` → re-export `app/admin/publer/page.js`
  - `warmup`, `strategy`, `outbound-real`, `outbound-ai` → simple "coming in Batch N" placeholder cards.
- Each placeholder card states which batch will ship it and links to the batch doc.

### Step 4 — Edit `components/Header.js`

The current header at `components/Header.js:85-130` (approximate) renders different links per role:
- Admin: hidden (admin uses sidebar)
- Editor: logo → `/editor`, link to `/editor/inspo`
- AI Editor: logo → `/ai-editor`, single link to AI workspace
- Creator: logo → `/creator/{opsId}/dashboard`, links to my-content + content-request

Changes:
- Editor: keep `/editor/inspo` (confirms Critique A's correction).
- AI Editor: ADD link "AI Content" → `/admin/smm?tab=ai-content`. Keep the `/ai-editor` link as "TJP Workspace."
- Creator: no changes — creator surfaces are out of SMM scope per master-plan Decision 7 and audit's coverage.
- Chat manager: no changes — `/photo-library` is their full surface.

Verify: load the app as each role, confirm the header links work and route correctly.

### Step 5 — Fix editor two-hop redirect

In `app/dashboard/page.js:22`, change:
```
if (role === 'editor') router.replace('/admin/editor');
```
to:
```
if (role === 'editor') router.replace('/editor');
```

Verify: log in as editor, navigate to `/dashboard`, confirm single `router.replace` to `/editor` with no flash through `/admin/editor`.

### Step 6 — Rename "AI Source" → "AI Content"

- In `lib/sidebarConfig.js`: the SMM child label is `"AI Content"`, target is `/admin/smm?tab=ai-content`.
- In `app/admin/recreate-source/page.js`: change the H1 / page title from "AI Source" to "AI Content."
- Verify: `/admin/smm?tab=ai-content` renders the recreate-source page with the new title. The old route `/admin/recreate-source` still works (deep links + bookmarks preserved).

### Step 7 — Remove Inspo Board's `recreate` tab

In `app/admin/inspo/page.js:14-23`, the tab strip lists 8 tabs. Remove the `'recreate'` entry. The underlying route `/admin/recreate` stays alive for direct-URL access (it's used by Inspo Board's internal navigation too — verify no other tab references it).

Verify: Inspo Board now shows 7 tabs. `/admin/recreate` still loads when typed directly.

### Step 8 — Archive dead routes

Move each of these to `app/admin/_legacy/<name>/page.js` and replace the contents with a 410 Gone page:
- `app/admin/tonio/page.js` → `app/admin/_legacy/tonio/page.js`
- `app/sonnet-test/page.js` → `app/admin/_legacy/sonnet-test/page.js`
- `app/creator/[id]/vault/page.js` → `app/admin/_legacy/vault/page.js`

Each archived page returns:
```
export default function GonePage() {
  return (
    <div className="p-12 text-center">
      <h1 className="text-2xl">410 Gone</h1>
      <p>This page was archived as part of the SMM consolidation. Contact evan@palm-mgmt.com if you need access.</p>
    </div>
  );
}
```

Verify: the four URLs return the 410 page, no internal links 404 (grep the codebase for `/admin/tonio`, `/sonnet-test`, `/creator/[id]/vault` references).

### Step 9 — Tabs-vs-sidebar single source of truth

In `app/admin/editor/page.js`, the TABS array (line ~2640) is currently 9 items but the sidebar lists 7. Export the TABS array, import in `lib/sidebarConfig.js`, derive the SMM Pipeline children from it.

Specifically:
- Add `export const EDITOR_TABS = [...]` at the top of `app/admin/editor/page.js`.
- In `lib/sidebarConfig.js`, import `EDITOR_TABS` and map them into the SMM Pipeline group.

Verify: adding a new tab to `app/admin/editor/page.js`'s EDITOR_TABS automatically adds it to the SMM sidebar (smoke-test by adding a dummy tab and reloading).

### Step 10 — Build + smoke test

- `next build` — must pass cleanly.
- `npm run lint` (if a lint script exists) — must pass.
- Manual click-through per role (see Test Plan below).

## Airtable changes

**NONE.** Batch 1 is purely code. If any Airtable interaction is required during Batch 1 (it shouldn't be), stop and ask the owner.

## Role-access matrix — final (target state for Batch 1)

| Sub-node | admin / super_admin | editor | ai_editor | social_media | chat_manager |
|---|---|---|---|---|---|
| Overview | visible | visible (filtered) | visible | visible (filtered to today's posts) | hidden |
| Review Queue | visible | visible | hidden | hidden | hidden |
| Post Prep | visible | hidden | hidden | hidden | hidden |
| Carousels | (folded into Review Queue) | visible (carousels) | hidden | hidden | hidden |
| Grid Planner | visible | hidden | hidden | visible (read+write via existing API; no separate readonly gate yet) | hidden |
| Creator Library | visible | visible | hidden | hidden | hidden |
| OFTV Projects | visible | visible | hidden | hidden | hidden |
| Long Form Upload | visible | visible | hidden | hidden | hidden |
| Outbound — Real (Telegram) | visible | hidden | hidden | visible (placeholder in Batch 1; built out in Batch 4) | hidden |
| Outbound — AI (Publer) | visible | hidden | hidden | hidden | hidden |
| Publer Mappings (tab inside Outbound — AI) | visible | hidden | hidden | hidden | hidden |
| AI Content | visible | hidden | visible (full) | hidden | hidden |
| Account Warm-Up | visible | hidden | visible (read-only of today's content needs) | visible (placeholder in Batch 1; built out in Batch 2) | hidden |
| Content Strategy | visible | hidden | visible | hidden | hidden |

Notes:
- Visibility = sidebar entry + page-level allow. Server-side gates in `lib/adminAuth.js` are the enforcement layer.
- Grid Planner does NOT have a read-only gate today. Critique A flagged this; we are NOT building the readonly helper in Batch 1. Treated as a known gap for a later sprint.
- The "Carousels" entry from today's Editor sidebar folds into "Review Queue" (the Editor page already handles both via tabs). Editors still see the same surface.

## Sidebar tree — final

```
ADMIN SIDEBAR (10 items)
├── Dashboard                                /admin/dashboard
├── Inspo Board                              /admin/inspo  (7 tabs after removing 'recreate')
├── Social Media Management                  /admin/smm   ← NEW PARENT
│   ── Pipeline ──
│   • Overview                               /admin/smm
│   • Review Queue                           /admin/smm?tab=review
│   • Post Prep                              /admin/smm?tab=postprep
│   • Grid Planner                           /admin/smm?tab=grid
│   • Creator Library                        /admin/smm?tab=library
│   • OFTV Projects                          /admin/smm?tab=oftv
│   • Long Form Upload                       /admin/smm?tab=longform
│   ── Outbound ──
│   • Outbound — Real (Telegram)             /admin/smm?tab=outbound-real     [placeholder until Batch 4]
│   • Outbound — AI (Publer)                 /admin/smm?tab=outbound-ai       [includes Mappings sub-tab]
│   ── Strategy & Warm-Up ──
│   • AI Content                             /admin/smm?tab=ai-content        [alias of /admin/recreate-source]
│   • Account Warm-Up                        /admin/smm?tab=warmup            [placeholder until Batch 2]
│   • Content Strategy                       /admin/smm?tab=strategy          [placeholder until Batch 3]
├── Creators                                 /admin/creators
├── Whale Hunting                            /admin/whale-hunting
├── Photo Library                            /photo-library
├── Onboarding                               /admin/onboarding
├── Invoicing                                /admin/invoicing
├── Inbox                                    /admin/inbox  (owner only)
└── Help                                     /admin/help
```

## components/Header.js audit + plan

Today the file drives non-admin global navigation (~140 lines). Per role:

| Role | Today's links | Batch 1 target |
|---|---|---|
| Editor | `/editor` (logo), `/editor/inspo` ("Inspo Board") | UNCHANGED — `/editor/inspo` stays (the wrapper is intentional per Critique A). |
| AI Editor | `/ai-editor` (logo + "AI Workspace") | ADD link "AI Content" → `/admin/smm?tab=ai-content`. Keep `/ai-editor`. |
| Creator | `/creator/{opsId}/dashboard` (logo), `/creator/{opsId}/my-content`, `/creator/{opsId}/content-request`, `/creator/{opsId}/inspo` | UNCHANGED — creators don't enter SMM. |
| Chat manager | `/photo-library` (logo) | UNCHANGED — Photo Library is their full surface. |

Verify: log in as each role, confirm the header links work and routing is correct after Batch 1 ships.

## Rename: "AI Source" → "AI Content"

Surface-level only. Three places:
1. `lib/sidebarConfig.js` SMM children — label `"AI Content"`.
2. `app/admin/recreate-source/page.js` H1 / page title — `"AI Content"`.
3. `components/Header.js` ai_editor link — `"AI Content"`.

Route stays at `/admin/recreate-source` (deep-link-safe). The new SMM entry `/admin/smm?tab=ai-content` is an alias that wraps the existing page.

## Editor & AI editor — exit from ghettos

**Editor today:** `/editor` is their sidebar-less workspace. They cannot reach `/admin/*`. **Post-Batch-1:** unchanged. The editor's primary surface stays `/editor`. They access SMM tabs they should see (Review Queue, Carousels, Library, OFTV, Long Form Upload) via direct URL OR by following the in-app links from their dashboard. The `/admin/smm` route allows editor via `requireAdminOrEditor` for those tabs only.

**AI editor today:** `/ai-editor` is their TJP-only sandbox. They cannot reach `/admin/*` (hard-blocked at `app/admin/layout.js:84`). **Post-Batch-1:** the layout flip allows them into `/admin/smm?tab=ai-content`, `?tab=warmup`, `?tab=strategy`. The header gets a new "AI Content" link. They still can't reach Dashboard, Creators, Inbox, etc. Page-level role gates enforce.

## Test plan

For each role, log in and verify:

1. **admin** — visit `/admin/dashboard`. See the 10-item sidebar with SMM in slot 3. Click SMM → see the 3-divider structure. Click each child, verify the corresponding page or placeholder loads.
2. **editor** — log in. Land on `/editor` (single hop, no flash). Click Inspo Board in header → land at `/editor/inspo` (not `/inspo`). Direct-URL to `/admin/smm?tab=review` → see the review queue (page-level gate allows editor). Direct-URL to `/admin/smm?tab=postprep` → 403 (page-level gate rejects).
3. **ai_editor** — log in. Land on `/ai-editor`. Click "AI Content" in header → land at `/admin/smm?tab=ai-content` → see the recreate-source UI inside the SMM layout. Direct-URL to `/admin/smm?tab=warmup` → see the placeholder card. Direct-URL to `/admin/smm?tab=review` → 403.
4. **social_media** — log in. (Currently no landing page; the layout sends them somewhere — confirm this still works.) Direct-URL to `/admin/smm?tab=outbound-real` → see the placeholder card.
5. **chat_manager** — log in. Land on `/photo-library`. No changes.
6. **creator** — log in. Land on `/creator/{opsId}/dashboard`. Header links unchanged. Cannot reach any `/admin/smm` route — 403.

Additional checks:
- 410 Gone: `/admin/tonio`, `/sonnet-test`, `/creator/{anyId}/vault` all return the archive page.
- Inspo Board tab strip: 7 tabs (no "Recreate Reels"); `/admin/recreate` direct URL still loads.
- Build: `next build` clean, no warnings about missing imports or dead exports.
- Lint: `npm run lint` clean.

## Rollback procedure

```
git checkout dev
git branch -D smm-consolidation
```

No Airtable changes, so no schema reversal. Worktree deletion if used: `git worktree remove .claude/worktrees/smm-consolidation`.

## Estimated time

12-16 hours. Breakdown:
- Steps 1-3 (sidebar config + layout + SMM wrapper): 4-5h
- Step 4 (Header.js): 2h
- Steps 5-7 (redirect fix + rename + Inspo tab): 1-2h
- Step 8 (archive dead routes): 1h
- Step 9 (single source of truth for tabs): 2h
- Step 10 (build + manual click-through): 2-4h

## Success criteria

- [ ] `next build` passes from a clean checkout of the branch.
- [ ] `npm run lint` passes.
- [ ] Each role's manual click-through (test plan above) succeeds end-to-end.
- [ ] No file outside the "Files to touch" list was modified.
- [ ] No Airtable interaction occurred during the batch.
- [ ] No regression: every URL that worked on `dev` (excluding the three archived routes) still works on the branch.
- [ ] `git diff dev..smm-consolidation -- '*.airtable*'` returns nothing (no Airtable code paths added).
- [ ] Handoff doc `batch-1-handoff.md` exists, lists every file touched + rollback command.

## Open questions to surface to owner during Batch 1

(If any of these come up, STOP and ask before deciding unilaterally.)

1. Does the owner want a sidebar collapse animation for the 3-group dividers, or are static dividers fine?
2. The Inbox sidebar entry is `ownerOnly` today (only evan@palm-mgmt.com sees it). Does this stay as-is, or should it widen with the SMM consolidation? **Recommendation: stays as-is.**
3. Should the placeholder cards for Batch 2/3/4 tabs link to the batch doc paths in the repo, or to a generic "coming soon" message? **Recommendation: link to the batch docs so future agents can find context.**
