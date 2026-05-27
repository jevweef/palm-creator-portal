# Batch 4 — Amin Manual-Post Bridge

**Status:** READY AFTER BATCHES 1-3 LAND
**Branch:** `smm-consolidation`
**Estimated time:** 25-35 hours
**Airtable changes:** ADDITIVE — 1 new table (Compliance Log) + ~6 fields
**Predecessor:** master-plan.md, batch-1, batch-2, batch-3

## Goal

Wire the warmup post flow from Today view → Amin's Telegram correctly. Today, the system has a live bug where warmup posts for AI accounts would mis-route to the real creator's Telegram topic (because telegram-queue resolves topic IDs off `Palm Creators`, and `Posts.Creator` for Brielle would link to Amelia). This batch creates per-AI-account Telegram topics on `Publer Accounts`, extends the existing `telegram-queue` cron with a routing branch, ships a `/posted` Telegram webhook for compliance, displays ET + IST times to Amin, and creates the stub Palm Creators row for Katie Rosie. Result: Amin can post for AI accounts without any mis-routing risk, with a per-post audit trail for EU AI Act compliance.

## The bug being fixed

Per Critique B verified evidence: `app/api/cron/telegram-queue/route.js:104-127` does:

```
const creator = await fetchAirtableRecords('Palm Creators', { fields: [..., 'Telegram IG Topic ID', 'Telegram FB Topic ID'] });
const topicId = creator[channelTopicField];
```

For Brielle's warmup post, `Posts.Creator` would link to Amelia (real creator). The cron resolves Amelia's Telegram IG Topic ID. Amin receives "post this on @brielleig" inside Amelia's real-creator topic. He either (a) posts to Amelia's real IG by mistake — disaster — or (b) catches the mistake and posts manually, but loses the workflow guarantee.

**This is the highest-business-risk live bug found in the entire audit.** Fix is the core of Batch 4.

## Solution: Warmup Telegram Topic ID on Publer Accounts

Per-AI-account topic in the existing `TELEGRAM_SMM_GROUP_CHAT_ID` group. Topic name: `@briel.ai (Brielle / Amelia)` — handle, persona, linked creator for Amin's context. Same topic carries both IG and FB tasks (Amin disambiguates channel from message body).

Routing decision moves from `Palm Creators` to `Publer Accounts`. The existing cron grows a two-line branch.

### Pipeline Target extension

Add a new value to `Posts.Pipeline Target` singleSelect: `Telegram (Warmup)`. Existing values stay (`Telegram`, `Publer`). Backwards-compatible — old Posts with `Pipeline Target = 'Telegram'` route to Palm Creators as before.

Warmup tasks DO NOT flow through `Posts` (Critique B coverage gap "Pipeline target validator gap"). They flow through a new lightweight envelope. But the EXISTING `telegram-queue` cron is still the worker (per Critique B's REJECT of the parallel-cron audit B proposal).

### Two-line branch in `telegram-queue` cron

```
// In the cron's per-post resolution loop:
let topicId;
if (post.pipelineTarget === 'Telegram (Warmup)') {
  const publerAccount = await fetchPublerAccountByPostId(post.id);  // Posts.Linked Publer Account
  topicId = publerAccount.warmupTelegramTopicId;
} else {
  // Existing path: resolve from Palm Creators
  const creator = await fetchAirtableRecords('Palm Creators', ...);
  topicId = creator[channelTopicField];
}
```

(Alternative: warmup posts don't go through Posts at all. The `send-to-amin` route in this batch creates a Posts row at the moment of send, with `Pipeline Target = 'Telegram (Warmup)'`, `Linked Publer Account` set, `Status = 'Queued for Telegram'`. Then the existing cron picks it up via the new branch. This keeps Posts as the single SoT for what's being sent to Amin, satisfies the symmetric validator from Batch 5, and lets the Compliance Log row hang off Posts cleanly.)

**Decision: warmup sends DO create Posts rows.** Argued vs. the audit's "warmup tasks bypass Posts" framing — the Posts table is the audit-of-record. Don't fork into two SoTs.

## Eager-send route vs. cron-driven

**Decision: cron-driven, reusing the existing `telegram-queue` cron.** Per Critique B (REJECT of audit's eager-send proposal):

- Eager-send loses claim-lock + stale-recovery primitives. The existing cron handles transient 429s, ffmpeg timeouts, network drops gracefully — building a parallel happy path is throwing away production-tested infra.
- The "low volume = no benefit from queue" argument is wrong; queue's benefit is correctness, not throughput.
- The "operator wants to schedule for later" use-case is supported by the cron's FIFO `Scheduled Date` ordering for free.

When the operator clicks "Send to Amin" on a Warmup Task:
1. POST to `/api/admin/smm/warmup/send-to-amin` with `{ warmupTaskId }`.
2. Server creates a Posts row with `Pipeline Target = 'Telegram (Warmup)'`, `Scheduled Date = task.windowStart` (or now if past), `Linked Publer Account`, `Status = 'Queued for Telegram'`, `Caption`, `Hashtags`, `Asset`.
3. Server stamps Warmup Task: `Status = 'Sent to Amin'`, `Telegram Sent At = now`, `Linked Post = <new post id>`.
4. The existing cron drains queue every minute; sends the message to the right topic via the two-line branch.

If the operator picks "Send tomorrow at window open" instead: same flow, just `Scheduled Date = tomorrow at window start`. Cron's existing FIFO-with-future-respect logic naturally delays.

## Time-of-day scheduling for warmup posts

**Specification:** each Warmup Task carries `Window Start (ET)` and `Window End (ET)`. The send-to-amin route sets `Posts.Scheduled Date` to the next occurrence of Window Start in ET.

**Audit's bug:** Critique B notes the existing cron doesn't actually wait for `Scheduled Date` — it pulls the oldest queued post regardless of whether the scheduled time has passed. This is true for real-creator posts today (operator manually decides when to enqueue). For warmup, we want time-of-day enforcement.

**Fix:** add a filter to the cron's queue query — only pick posts where `Scheduled Date <= NOW()` AND `Pipeline Target = 'Telegram (Warmup)'`. For the legacy real-creator path (`Pipeline Target = 'Telegram'` or null), keep the existing immediate-drain behavior (don't break real-creator workflow).

Pseudocode:

```
const filter = `AND(
  OR({Status} = 'Queued for Telegram'),
  OR(
    AND({Pipeline Target} = 'Telegram (Warmup)', IS_BEFORE({Scheduled Date}, NOW())),
    OR({Pipeline Target} = 'Telegram', {Pipeline Target} = BLANK())
  )
)`
```

## Acknowledgement from Amin (`/posted` webhook)

Per Critique B (REJECT of audit's "optional polish" framing): required for compliance audit trail per EU AI Act Article 50.

### Amin convention

After Amin posts on the IG account, he replies in the same Telegram topic with:
```
/posted https://instagram.com/p/Cxyz123
```
or just the URL alone. The webhook is forgiving — both work.

### Webhook handler

New route: `app/api/telegram/webhook/route.js` (if not already present — verify). Telegram bot already running per memory.

When the bot receives a message in any SMM topic:
1. Parse for `/posted` or a bare instagram.com / facebook.com URL.
2. Look up the most recent `Posts` row with `Pipeline Target = 'Telegram (Warmup)'` AND topic ID matches.
3. Stamp:
   - `Posts.Status = 'Posted'`
   - `Posts.Posted At = message.date`
   - `Posts.Post Link = parsed URL`
4. Patch the linked Warmup Task:
   - `Warmup Tasks.Status = 'Done'`
   - `Warmup Tasks.Posted At = message.date`
   - `Warmup Tasks.Post Link = parsed URL`
   - `Warmup Tasks.Amin Confirmed = true`
5. Create a `Compliance Log` row (see below).

### Manual fallback

Today view's "Sent to Amin" status has a "Mark Posted" button. Operator clicks it after a sanity check on the live IG. Does the same updates as the webhook would. Used if Amin forgets to reply.

## Time-zone display

**ET + IST in every Telegram message to Amin.**

Message template (sent by the cron):

```
🎬 Warmup post — Brielle (@briel.ai)

📅 Post window:
   13:00 - 15:00 ET (your local: 22:30 - 00:30 IST)

📺 Channel: Instagram
🏷️ Type: Reel
🔖 AI label: ON (required)

Caption:
{caption body}

Hashtags:
{hashtags joined}

🎥 Media: {Telegram-uploaded video preview}

When posted, reply:
/posted {paste IG post URL}
```

Helper in `lib/timezoneDisplay.js`:
```
export function renderWindow(etStart, etEnd) {
  const istStart = convertEtToIst(etStart);
  const istEnd = convertEtToIst(etEnd);
  return `${etStart} - ${etEnd} ET (your local: ${istStart} - ${istEnd} IST)`;
}
```

Today view also renders operator-local times only (ET-resident operator). The bilingual display is for Amin.

## Stub Palm Creators row for standalone AI personas (Katie Rosie)

Per master-plan Decision 1: standalone AI personas get a stub `Palm Creators` row.

Add a new field on `Palm Creators` (additive):

| Field | Type |
|---|---|
| Creator Type | Single select — `Real Creator` / `AI Persona — Standalone` |

When operator creates an AI Account Profile with `Linked Real Creator = empty`, server logic:
1. Create a stub Palm Creators row with `Creator Type = 'AI Persona — Standalone'`, `Name = persona name`, all other fields blank.
2. Set the new profile's `Linked Real Creator = <stub row id>`.

All views that list "real creators" must be filtered with `Creator Type = 'Real Creator'` (or `Creator Type IS BLANK` for backwards compat with existing rows). Update:
- `/admin/creators` index page filter
- Editor's creator-picker UI
- Any dashboard widget listing creators

Stub rows do not appear in earnings, invoicing, whale hunting, or creator-comms surfaces.

## Compliance Log table

Per Critique B coverage gap: per-post immutable audit row for EU AI Act + FTC.

| Field | Type | Notes |
|---|---|---|
| Log Name | Single line text | Auto: "Brielle Day 12 — 2026-06-10" |
| Linked Post | Link → Posts | Required |
| Linked Warmup Task | Link → Warmup Tasks | |
| AI Account | Link → AI Account Profile | |
| Posted At | Datetime | |
| Post Link | URL | |
| AI Label Confirmed | Checkbox | Default true; flipped to false on operator audit fail |
| IPTC Confirmed | Checkbox | |
| Watermark Confirmed | Checkbox | |
| Confirmed By | Single line text | Webhook = "amin-webhook"; manual = operator email |
| Confirmation Method | Single select | `Amin /posted Webhook` / `Operator Manual` / `Scrape Spot-Check` |
| Created At | Created time | Immutable — no edits permitted via API |

Server-side validator on the PATCH route: rejects any modification after `Created At + 24h`. Provides a tamper-evident audit trail for compliance.

## Files to create

- `lib/timezoneDisplay.js` — ET → IST conversion + render helpers.
- `lib/complianceLog.js` — Create + read Compliance Log rows.
- `app/api/admin/smm/warmup/send-to-amin/route.js` — Operator clicks "Send to Amin."
- `app/api/admin/smm/warmup/create-telegram-topic/route.js` — One-shot topic creation per AI account.
- `app/api/admin/smm/warmup/mark-posted/route.js` — Manual "Mark Posted" fallback.
- `app/api/telegram/webhook/route.js` — Parse `/posted` replies. (Verify if file already exists in repo from existing bot.)
- `app/api/admin/smm/warmup/compliance-log/route.js` — Read-only API for Compliance Log.
- `components/warmup/SendToAminButton.js` — Today view action.
- `components/warmup/PostedConfirmation.js` — "Mark Posted" + Posted At display.
- `components/warmup/ComplianceLogPanel.js` — Per-account audit log view (renders inside the per-account view's History tab).

## Files to modify

- `app/api/cron/telegram-queue/route.js` — Add the two-line branch (Pipeline Target = 'Telegram (Warmup)' → resolve topic ID from Publer Accounts). Update the filter to honor `Scheduled Date` for warmup posts. Message template now includes ET + IST.
- `lib/telegramTopics.js` — Add helper `createWarmupTopicForAccount(publerAccountId)` that wraps the existing `createSmmTopicForHandle`.
- `app/admin/smm/warmup/page.js` (Batch 2) — "Send to Amin" button now wired. Mark Posted button added.
- `app/admin/smm/warmup/[accountId]/page.js` (Batch 2) — Compliance log panel added to History tab.
- `app/api/admin/smm/warmup/profile/route.js` (Batch 2) — When creating a profile with no linked real creator, also create the stub Palm Creators row + Creator Type field.
- `app/admin/creators/page.js` — Filter list by `Creator Type = 'Real Creator'`.

## Test plan

End-to-end test with Brielle:

1. **Topic creation.** POST `/api/admin/smm/warmup/create-telegram-topic` with `{ publerAccountId: 'recBriellePublerIG' }`. Verify a new Telegram forum topic is created in TELEGRAM_SMM_GROUP_CHAT_ID with name `@briel.ai (Brielle / Amelia)`. Verify `Publer Accounts.Warmup Telegram Topic ID` is stamped.

2. **Send to Amin from Today view.** Open `/admin/smm?tab=warmup`. Pick a Day-5 post task for Brielle. Click "Send to Amin."
   - Verify a Posts row is created with `Pipeline Target = 'Telegram (Warmup)'`, `Status = 'Queued for Telegram'`, `Scheduled Date = task.windowStart`.
   - Verify Warmup Task: `Status = 'Sent to Amin'`, `Telegram Sent At = now`, `Linked Post = <new post id>`.
   - Wait ≤1 min for cron. Verify message appears in Brielle's topic (NOT Amelia's real-creator topic).
   - Verify the message body contains ET + IST window times.

3. **Verify no mis-routing.** Run a tracer test: create a fake Posts row with `Creator = recAmeliaXXX`, `Pipeline Target = 'Telegram (Warmup)'`, `Linked Publer Account = recBriellePublerIG`. Run cron. Verify message lands in Brielle's topic, not Amelia's. (This is the regression test that proves the bug is fixed.)

4. **Amin `/posted` webhook.** Simulate a Telegram message in Brielle's topic with text `/posted https://instagram.com/p/Cxyz123`. Verify:
   - Posts.Status = 'Posted', Posts.Posted At = message time, Posts.Post Link = URL.
   - Warmup Tasks.Status = 'Done', Amin Confirmed = true, Posted At = message time, Post Link = URL.
   - Compliance Log row created with Confirmation Method = 'Amin /posted Webhook'.

5. **Manual Mark Posted fallback.** Send another task to Amin, but don't simulate his reply. Click "Mark Posted" in the UI. Verify same updates happen, Confirmation Method = 'Operator Manual'.

6. **ET + IST display.** Verify the Telegram message body renders both time zones correctly. Spot-check a window crossing midnight IST (e.g. "13:00-15:00 ET" → "22:30-00:30 IST").

7. **Stub Palm Creators for Katie Rosie.** Create AI Account Profile with `Persona Name = 'Katie Rosie'`, `Linked Real Creator = empty`. Verify a stub Palm Creators row exists with `Creator Type = 'AI Persona — Standalone'`. Verify Katie Rosie does NOT appear in `/admin/creators` index.

8. **Compliance Log immutability.** Try to PATCH a Compliance Log row 25h after creation via the API. Verify rejected with 403.

9. **Pipeline Target backwards compat.** Send a real-creator post (existing flow): `Pipeline Target = 'Telegram'` (or null) → message routes via Palm Creators as before, no regression.

10. **Scheduled-Date enforcement for warmup.** Send a warmup task with Window Start = tomorrow 13:00 ET. Verify the cron does NOT send it now; waits until tomorrow 13:00 ET.

## Rollback procedure

```
git checkout dev
git branch -D smm-consolidation
```

Then in Airtable:
1. Delete `Compliance Log` table.
2. Delete `Posts.Linked Publer Account` field (if added — verify schema doesn't already have it).
3. Delete `Palm Creators.Creator Type` field.
4. Remove `Telegram (Warmup)` value from `Posts.Pipeline Target` singleSelect.
5. Delete the per-AI-account Telegram topics in the Telegram group (optional — just cosmetic cleanup; the IDs become orphaned).

## Estimated time

25-35 hours. Breakdown:
- Airtable schema additions (manual): 1h
- `lib/timezoneDisplay.js` + `complianceLog.js`: 2-3h
- send-to-amin + create-topic + mark-posted routes: 5-7h
- Telegram webhook (`/posted` parser): 4-6h
- `telegram-queue` cron branch + Scheduled-Date filter: 3-4h
- Today view button wiring + Mark Posted UI: 3-4h
- Stub Palm Creators logic + filter updates: 2-3h
- Compliance Log immutability validator: 2h
- Manual end-to-end test (10 tests above): 4-6h

## Success criteria

- [ ] Per-AI-account Telegram topics exist for Brielle, Lily, Katie Rosie.
- [ ] Brielle's warmup posts route to Brielle's topic, not Amelia's (verified by tracer test #3).
- [ ] Amin's `/posted` reply auto-stamps Compliance Log + Warmup Task + Posts.
- [ ] Telegram message renders ET + IST.
- [ ] Stub Palm Creators row exists for Katie Rosie; she's invisible in real-creator surfaces.
- [ ] Compliance Log rows are immutable after 24h (via API).
- [ ] Real-creator Telegram flow has no regression.
- [ ] Scheduled Date is honored for warmup posts (not for real-creator legacy posts).
- [ ] `next build` passes; lint clean.
- [ ] Handoff doc `batch-4-handoff.md` written.
