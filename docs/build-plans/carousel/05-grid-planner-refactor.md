# Step 5 — Grid Planner refactor

## Goal
Grid Planner pulls only `Status=Ready to Go`, auto-distributes round-robin across each creator's IG + FB columns, shows Type badge on each tile, and routes carousels to a Preview Slides modal instead of the thumbnail flow.

## ⚠️ This is the riskiest step. Go slow.

`components/GridPlanner.js` is 2700+ lines and has at least three subtle systems already wired (thumbnail pool tray, drag-drop reorder, send queue lock). **Don't try to refactor everything.** Surgical changes only.

## Prereq reads
- `gotchas.md`
- `components/GridPlanner.js` — read in chunks; focus on:
  - data fetch (`/api/admin/grid-planner` call)
  - `postsByAccount` (column grouping, ~line 1527)
  - status color map (~line 39)
  - the thumbnail tray + modal (`ThumbnailPoolTray`, `ThumbnailPoolModal`)
  - `distributeQueue` / `autoFillThumbnails` (the existing round-robin logic for channel assignment)
  - the send button onClick handler
- `app/api/admin/grid-planner/route.js` — the GET data source. See what filter it uses today.

## What to change

### A. Data source filter
Find where the route fetches Posts (likely `filterByFormula` on `Status`). Change to:
```
{Status} = 'Ready to Go'
```

This will likely cause some legacy Posts to fall out of the grid. That's fine — they didn't have `Type` anyway. If there are stuck reels you want to preserve, backfill them in step 4 first.

### B. Distribution — round-robin FIFO
For each creator with unassigned items in Ready-to-Go, assign Channel alternately: item 1 → IG, item 2 → FB, item 3 → IG, etc. This already exists in `distributeQueue` for reels — extend to carousels (Type-agnostic round-robin).

### C. Type badge on tiles
Each post tile in the column gets a badge. Use a small chip top-left:
- `🎬 Reel` (or just `Reel` — pick whichever matches existing visual language)
- `📸 Carousel · N` (N = number of linked photo assets)

Compute N from the Post.Asset length (or Post.Photos length, depending on what the carousel endpoint links to — confirm in step 3).

### D. Preview Slides modal (carousel tiles only)
Replace the "Choose Thumbnail" button on Carousel tiles with **"Preview Slides"**. The modal:
- Shows all N photos in order (use CDN URL)
- Drag to reorder (writes Post.Asset back to Airtable in new order via PATCH)
- ✕ on each photo to remove it from the post (PATCH the linked field)
- Cannot ADD photos here (admin would go back to Carousels tab for that — keep this modal scoped to ordering/removing only, for simplicity)

Reel tiles keep the existing "Choose Thumbnail" button and `ThumbnailPoolModal` flow untouched.

### E. Send button
The send button on each tile calls the same enqueue endpoint as today. **Don't branch send behavior in the component.** All branching happens server-side in step 6. Component-side, a carousel tile sends exactly like a reel tile.

### F. Don't break:
- The thumbnail pool tray (reels only)
- The `Thumbnail Asset` deterministic-flip pattern (reels only)
- The lock + stale-recovery on the send queue
- Drag-drop reorder between columns (IG ↔ FB) — should still work for both types

## Verify before next step
- Refresh Grid Planner — only Ready-to-Go items appear, correctly distributed IG/FB per creator
- Carousel tile shows correct badge, "Preview Slides" modal opens, photos shown in order, reorder persists
- Reel flow is unchanged: thumbnail tray works, modal works, drag-drop works, send works (don't actually send yet — wait for step 6)
- Push to dev, open the Vercel preview URL, click around for 5 minutes before moving on

## Common pitfalls
- React Hooks rule violations when adding new state. Keep new hooks at the top.
- Forgetting to update `postsByAccount` grouping to treat both Types the same
- Accidentally querying Posts.Type with `FIND` on a multipleRecordLinks formula (Type is a singleSelect — different field type, fine to use `{Type}='Reel'`)
- Distribution touching already-assigned items. The round-robin should ONLY assign to items where `Channel` is blank. Don't reshuffle items that are already on a column.
