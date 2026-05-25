# Step 6 — Telegram send + cron worker for carousels

## Goal
When the cron picks up a `Type=Carousel` post, the send route must call `sendMediaGroup` with N `InputMediaPhoto` items instead of the reel video+thumbnail path. Caption goes on the first photo only. All other behavior (lock, stale-recovery, message ID tracking, status transitions) stays identical.

## ⚠️ Cron + send route are load-bearing
This pipeline shipped the duplicate-send disaster on 2026-05-06. The lock + stale-recovery + bulk-unsend trio is now operational and works. **Do not modify the lock or stale-recovery behavior.** Add the carousel branch as a fork inside the existing happy path.

## Prereq reads
- `gotchas.md`
- `app/api/cron/telegram-queue/route.js` — the cron worker that picks up Queued for Telegram, sets lock + `Sending Since`, dispatches to send route
- `app/api/telegram/send/route.js` — the actual send route. Currently does: download video from Asset → optionally compress → call `sendMediaGroup` with [video, thumbnail-as-photo]
- `app/api/admin/telegram/bulk-unsend/route.js` — existing pattern for comma-separated Telegram Message IDs

## What to change

### A. Cron worker (`app/api/cron/telegram-queue/route.js`)
Add `Type` to the fields fetched for each Post. Pass it to the send route body.

```js
// in the fields list
fields: [..., 'Type', 'Asset', 'Photos', 'Caption', ...]

// in the body sent to /api/telegram/send
body: JSON.stringify({
  postId,
  type: f['Type'] || 'Reel',  // default to Reel for legacy posts
  // ... existing fields
})
```

**Lock + stale-recovery: do not touch.** Same `Sending Since` stamp on lock, same stale-recovery query.

### B. Send route (`app/api/telegram/send/route.js`)
Add a branch at the top of the actual send:

```js
if (type === 'Carousel') {
  // carousel send path — sendMediaGroup with N photos
  return await sendCarousel({ postId, photos, caption, chatId, threadId })
}
// existing reel path unchanged
```

### C. The carousel send

1. **Resolve photos.** The Post links to N Photo (or Asset) records in order. Fetch each and grab the CDN URL (preferred) or Image attachment URL.
2. **Build the `sendMediaGroup` payload:**
```js
{
  chat_id: chatId,
  message_thread_id: threadId,
  media: photos.map((p, i) => ({
    type: 'photo',
    media: p.cdnUrl || p.imageUrl,
    caption: i === 0 ? caption : undefined,  // caption ONLY on first photo
  }))
}
```
3. **Call Telegram:** `POST https://api.telegram.org/bot{TOKEN}/sendMediaGroup`. Response includes an array of messages — one per photo.
4. **Store message IDs:** comma-separate all returned `message_id`s into `Telegram Message ID` (matches bulk-unsend's expected format). Stamp `Telegram Sent At = now`, flip Status to `Sent to Telegram`.
5. **Release lock.** Same as the reel path.

### D. Rate limit pacing
A 10-photo carousel = 10 messages in one `sendMediaGroup` call. Telegram allows the call itself, but it counts as 10 messages against the 20/min/chat cap. If you're sending multiple carousels back-to-back in one tick, throttle:
- 1 carousel per cron tick is safe (the cron's `POSTS_PER_TICK` is 1 today)
- If you ever raise `POSTS_PER_TICK > 1` for carousels, add a delay or check the per-chat tally

### E. Error handling
- If `sendMediaGroup` returns 400 (e.g., a CDN URL Telegram can't fetch), fall back to uploading the photo by file: download via fetch, then multipart-POST with `attach://photo0`. Use Telegram's documented multipart format. If even that fails, set Status=`Send Failed` and surface the error — don't keep retrying inline.
- Telegram occasionally returns 429 with `retry_after`. Honor it: write the value to a transient log line and let the next cron tick retry. Don't block the worker.

## Test plan (do this before merging anything to main)

1. Assemble a 3-photo test carousel for a real creator on dev
2. Push to dev, manually trigger the cron via dev's endpoint (or wait for the next scheduled run — cron runs on prod only, so for dev testing you may need to hit the send route directly with a hand-crafted body)
3. Watch the Telegram group — three photos as one album, caption on the first, no errors
4. Bulk-unsend the test post via the existing endpoint — all three messages should delete

## Gotcha
The lock query in the cron currently filters on `Status='Sending'` with `Sending Since` stale-recovery. Carousels go through the same lock — no second locking mechanism needed. If you add one accidentally you'll re-introduce the duplicate-send risk.

## Verify before merging to main
- Reel sending still works (do not regress)
- Carousel sending works end-to-end on dev
- Bulk-unsend handles a carousel correctly (deletes all N messages)
- Cron tick completes within timeout for a carousel
- Then and only then: tell the user "ready to merge to main, want me to?"
