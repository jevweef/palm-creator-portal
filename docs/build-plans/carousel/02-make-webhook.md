# Step 2 — Stamp `Source Type = Creator Upload` on creator photo arrivals

## Goal
When a creator uploads photos to their Dropbox file-request folder, Make.com pushes them to the Photos table 2x/day. Right now those rows land without a Source Type. We need them stamped `Creator Upload` so the Carousels tab filter can split them from scraped IG / AI / Pinterest.

## Prereq reads
- `gotchas.md`
- Existing creator-photo flow:
  - `app/api/webhooks/` — check what handlers exist
  - `app/api/admin/photos/library/route.js` (line 85 fallback: `f['Source Type']?.name || f['Source Type'] || 'Instagram'`) — the UI currently defaults missing Source Type to "Instagram" which is why creator uploads have looked like scraped IG

## What to do

### Find the source of truth
Two possibilities — find which one applies:

1. **Make.com scenario** writes directly to Airtable. If so, the fix is in Make: add a "Source Type = Creator Upload" mapping to the Airtable Create Record step. Tell the user to update the scenario; we can't do this from code.

2. **Webhook handler in this repo** receives the Make webhook and writes to Airtable. If so, find it (likely `app/api/webhooks/dropbox/`, `app/api/webhooks/make/`, or similar) and patch it to include `'Source Type': 'Creator Upload'` in the Photos create call.

```bash
grep -rn "Source Type\|Source Handle" app/api/webhooks/ 2>/dev/null
grep -rn "creatorPhoto\|creator photo\|UNREVIEWED_LIBRARY\|file.request\|fileRequest" app/api/ 2>/dev/null
```

### If it's Make and not code
- Tell the user: "Your Make scenario for creator Dropbox photos needs to set `Source Type = Creator Upload` on the Photos Create Record step. I can't edit Make from here — open it and add that mapping."
- Move to step 3. Don't block the build on Make.

### If it's a webhook handler
- Patch it to stamp `'Source Type': 'Creator Upload'` on create
- Push to dev
- Manually trigger the webhook with a test payload (or wait for the next Make run) and verify a new Photos row has the right Source Type

## Backfill (optional, ask user)
If existing creator-uploaded photos already in the Photos table need to be backfilled to `Source Type = Creator Upload`, ask the user before doing it. A safe heuristic: rows where `Source Type` is blank AND `Source Handle` is blank AND `Dropbox Link` contains `/UNREVIEWED_LIBRARY/`. Don't run the backfill without user confirmation.

## Verify before next step
- New uploads land with `Source Type = Creator Upload` (or user has updated Make)
- Old creator uploads either backfilled or explicitly left alone
