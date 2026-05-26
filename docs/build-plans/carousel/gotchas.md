# Gotchas — project rules that MUST be followed

## React Hooks rule (has crashed admin section twice)
All `useState`, `useMemo`, `useEffect` hooks MUST be placed BEFORE any conditional `return` statements in components. Placing hooks after `if (loading) return ...` causes React error #310. Always: hooks first, early returns after.

## Airtable linked records via REST API
Plain string arrays only. Never `{id}` objects.
- ✅ `"Asset": ["recXXX", "recYYY"]`
- ❌ `"Asset": [{id: "recXXX"}, {id: "recYYY"}]`
The `{id}` form is for the Airtable.js SDK only. REST API serializes it as `[object Object]` → 422 INVALID_RECORD_ID.

## Airtable formula gotcha
`ARRAYJOIN({LinkedField})` returns the linked records' **primary field text**, not their record IDs. `FIND` with a `recXXX` ID against this silently returns 0. If you need to filter by record ID on a linked field, fetch and filter client-side instead.

## Time conventions
- Sheet/UI times are ET, not UTC
- OF day boundary = midnight UTC = 8 PM ET
- Airtable date-only fields extract UTC date, not ET — enable "Include a time field" for timestamps

## Dropbox
- Root is `/Palm Ops/`, NEVER `/Palm/` (permission denied otherwise)

## Telegram
- Send bot: `@palmmgmt_bot` (the inbox bot is `@palmmanage_bot` — don't confuse them)
- Send group env: `TELEGRAM_SMM_GROUP_CHAT_ID` = `-1003993831532`
- Rate limit: 20 messages/min PER CHAT (per-chat, not per-bot)
- `sendMediaGroup` of N items = N messages against the rate limit
- A carousel of 10 photos = 10 messages — pace accordingly
- Bots can only delete their own messages within ~48h
- Store `Telegram Message ID` as comma-separated IDs for multi-message sends (matches existing bulk-unsend pattern in `app/api/admin/telegram/bulk-unsend/route.js`)

## Lock + stale-recovery (DO NOT break this)
The cron at `app/api/cron/telegram-queue/route.js` uses `Sending Since` to detect stale locks. When you patch the cron to handle carousels, the lock/stale-recovery path must stay identical. If you change how the lock is set or queried, you risk re-introducing the duplicate-send disaster from 2026-05-06.

## Thumbnail Asset deterministic-flip (reels only)
When a reel sends, it patches the specific Asset that was used as its thumbnail via `Thumbnail Asset` ID stamped on the Post at apply-time. This makes the asset fall out of the thumbnail pool after send. Carousels skip this entirely — don't try to apply it.

## Deploy
- Work on `dev` branch only
- Vercel cron jobs run against PRODUCTION (main) deployment only — preview deploys do NOT receive cron pings
- Push to dev after every change, test on preview URL
- Merge to main only when user explicitly approves
- The vercel team is `evan-5378's projects`, the portal is `palm-creator-portal`
