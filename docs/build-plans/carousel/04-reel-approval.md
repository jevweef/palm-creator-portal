# Step 4 — Reel approval handler patch

## Goal
When a reel currently reaches "Approved" (the existing review flow), it needs to also be tagged `Type=Reel` and `Status=Ready to Go` so the new Grid Planner queue picks it up alongside carousels.

## Prereq reads
- `gotchas.md`
- `app/admin/editor/page.js` — look for the For Review tab; find where the "Approve" button hits an API
- Whatever handler that button calls (probably `app/api/admin/editor/approve/route.js` or similar)

## What to find

```bash
# Find the approve endpoint
grep -rn "For Review\|forReview" app/admin/editor/ | head -20
grep -rn "'Approved'\|status.*Approved\|Pipeline Status" app/api/admin/ | head -20
# Find what writes 'Approved' to a Post or Asset
grep -rn "patchAirtableRecord.*Approved\|Status.*Approved" app/api/ | head -20
```

The reel approval flow likely lives in one of:
- `app/api/admin/editor/approve/`
- `app/api/admin/review/`
- `app/api/admin/posts/approve/`
- Or a more generic Asset status-change handler

## What to change

In the approve handler that creates or transitions a reel Post:

1. Set `'Type': 'Reel'` on the Post
2. Set `'Status': 'Ready to Go'` on the Post (instead of whatever it currently sets — likely 'Prepping' or 'Queued for Grid Planner')

**Be very careful**: the current Status flow may go `Approved → Prepping → Ready for Telegram → Queued for Telegram → Sending → Sent to Telegram`. We're collapsing the early states into `Ready to Go`. Map the existing transitions:

- Old: `Approved` (Asset) → creates Post with Status='Prepping' → admin assigns to grid → Status='Queued for Telegram'
- New: `Approved` (Asset) → creates Post with `Type='Reel', Status='Ready to Go'` → Grid Planner auto-distributes → Status flows to `Queued for Telegram` when sent

DO NOT change the Status flow downstream of Ready to Go. Cron + send route still expect `Queued for Telegram` and `Sending` and `Sent to Telegram` exactly as before. Only the entry point changes.

## Backfill (optional)
Old reels currently sitting in `Prepping` or `Queued for Grid Planner` won't have `Type` set. For them:
- Either backfill: query Posts with no Type and `editedFileLink` not blank → set `Type=Reel`
- Or update the Grid Planner query to treat blank Type as Reel (defensive)

Pick one and tell the user which you chose.

## Verify before next step
- Approve a test reel through the existing flow
- Confirm the resulting Post in Airtable has `Type=Reel, Status=Ready to Go`
- Make sure you didn't break the For Review UI itself
