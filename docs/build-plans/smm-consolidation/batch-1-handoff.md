# Batch 1 — Handoff

**Branch:** `smm-consolidation` (worktree at `/Users/jevanleith/palm-creator-portal-smm`)
**Date:** 2026-05-27
**Build:** `next build` passes clean.
**Airtable changes:** NONE.

## What shipped

1. **New sidebar entry: Marketing Content** (📱) — admin-only, slots between Inspo Board and AI Content. Click → `/admin/marketing-content`.

2. **Renamed sidebar entry: "AI Source" → "AI Content"** (icon changed from 🎞️ to 🎨). Route unchanged at `/admin/recreate-source` so existing bookmarks + the Phase 1+2 Publer integration keep working.

3. **`/admin/recreate-source` is now a 4-tab strip** (Workflow / Setup / Warm-Up / Strategy):
   - **Workflow** — placeholder card with "Open AI Workflow →" button linking to `/ai-editor`. Visible to admin + ai_editor.
   - **Setup** — the original 1843-line AI Source page, intact, rendered as a tab. Admin-only. Default tab for admin.
   - **Warm-Up** — placeholder card describing Batch 2 scope.
   - **Strategy** — placeholder card describing Batch 3 scope.
   - Default tab for `ai_editor` role = Workflow (the only tab they can see).

4. **AI editor admin-shell access** — flipped `aiEditorAllowedPath` so ai_editor can reach `/admin/recreate-source` but nothing else under `/admin/*`. They get a 1-item sidebar showing "AI Content." Their existing `/ai-editor` URL still works exactly as before.

5. **Header.js — AI editor row** now has two links: "AI Workspace" (→ `/ai-editor`, unchanged) and "AI Content" (→ `/admin/recreate-source?tab=workflow`, new).

6. **Marketing Content hub page** (`/admin/marketing-content`):
   - 4 KPI tiles: AI posts in flight, Real posts in flight, Needs your review, Active warm-ups (returns 0 until Batch 2).
   - Quick links: Editor For Review, AI Content, Account Warm-Up, Publer Mappings, Grid Planner, OFTV Projects.
   - Reads from new `GET /api/admin/marketing-content/overview` — read-only aggregation, requireAdmin gated, no new Airtable schema.

## Files touched

```
M   app/admin/layout.js
RM  app/admin/recreate-source/page.js -> app/admin/recreate-source/SetupTab.js  (rename + 1-line rename of default export)
M   components/Header.js
+   app/admin/recreate-source/page.js                  (new — tab strip wrapper)
+   app/admin/recreate-source/WorkflowTab.js           (new)
+   app/admin/recreate-source/WarmupTab.js             (new)
+   app/admin/recreate-source/StrategyTab.js           (new)
+   app/admin/marketing-content/page.js                (new — hub UI)
+   app/api/admin/marketing-content/overview/route.js  (new — KPI feed)
+   docs/build-plans/smm-consolidation/batch-1-handoff.md  (this file)
```

Plus symlinks created on the worktree to share with main checkout (not committed):
- `node_modules -> /Users/jevanleith/palm-creator-portal/node_modules`
- `.env.local -> /Users/jevanleith/palm-creator-portal/.env.local`

## Deviations from the batch doc

None of significance. The Batch 1 doc said the Workflow tab might inline `/ai-editor`'s 1242-line content — I chose the placeholder + link approach to keep risk low, matching the doc's Open Question #1. The Warm-Up tile in Marketing Content returns 0 until Batch 2 (also matching the doc).

## Test plan — please verify in your browser

Admin (you):

- [ ] Log in → click new "Marketing Content" sidebar entry. Hub renders with 4 tiles + 6 quick links.
- [ ] Click "AI Content" sidebar entry. Land on Setup tab by default. All original AI Source UI works.
- [ ] Click Workflow tab. Placeholder with "Open AI Workflow →" button. Click → land on `/ai-editor`.
- [ ] Click Warm-Up tab. Placeholder mentioning Batch 2.
- [ ] Click Strategy tab. Placeholder mentioning Batch 3.
- [ ] Hit any existing bookmarks (`/admin/recreate-source`, `/admin/editor?tab=review`, etc.) — confirm nothing's broken.

AI editor (need a test login or "view as"):

- [ ] `/ai-editor` still works as before.
- [ ] Header now shows two links: "AI Workspace" + "AI Content."
- [ ] Click "AI Content" → land at `/admin/recreate-source?tab=workflow` inside the admin shell with a 1-item sidebar.
- [ ] Try `/admin/dashboard` → bounced back to `/ai-editor`.

Editor:

- [ ] `/editor` unchanged.
- [ ] Header unchanged.

## Rollback

If anything's broken or you want to scrap the batch:

```
cd /Users/jevanleith/palm-creator-portal
git worktree remove ../palm-creator-portal-smm
git branch -D smm-consolidation
```

That removes the worktree and deletes the branch entirely. No Airtable changes to reverse. `dev` is untouched (only got the doc-update commit, which can be reverted with `git revert 3829ecab` if desired).

## What's next

Batch 1 complete. Per the master plan, STOP here and wait for owner approval before starting Batch 2 (Account Warm-Up Flow).

If approved → next session starts Batch 2: 3 new Airtable tables (`AI Account Profile`, `Warmup Tasks`, `Warmup Playbook Templates`), 3 new fields on `Publer Accounts`, the Warm-Up tab implementation, per-account view with day-counter, Day-21 sub-task chaining, Day-45 owner-approval gate. Estimated 50-70h. See `batch-2-warmup-flow.md`.

If rejected → branch deletion + the scope discussion picks up wherever you want.
