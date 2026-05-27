# Batch 4 — Handoff

**Branch:** `smm-consolidation`
**Date:** 2026-05-27
**Build:** `next build` passes clean.
**Airtable changes:** 1 new field (additive).

## What shipped — the routing bug Critic B caught is fixed

The audit found that the existing `telegram-queue` cron resolves topic IDs from `Palm Creators.Telegram IG/FB Topic ID` only — so warmup posts for Brielle would either fail (Katie Rosie has no Palm Creator) or worse, mis-route into Amelia's *real* IG topic. Batch 4 fixes this by giving each AI persona its own forum topic that lives on `AI Account Profile`, never on `Palm Creators`.

### Send-to-Amin endpoint
`POST /api/admin/smm/warmup/send-task/[id]` — sends one warmup task's instruction to Amin via a per-AI-account Telegram forum topic.

- **Get-or-create topic.** If the persona has no `Warmup Telegram Topic ID`, the endpoint calls Telegram's `createForumTopic` API and persists the new topic ID on the AI Account Profile. Future sends reuse it.
- **Topic name:** `{persona} (@{handle}) — Warmup`.
- **Message body:** persona + day + phase header, task title, full task description, optional operator note, optional postAt timestamp formatted in ET + IST (so Amin in India doesn't do mental math).
- **MarkdownV2** with full escaping. Telegram parser is strict; any unescaped char fails the entire message.
- **Stamps task notes** with `[YYYY-MM-DD HH:MM ET] Sent to Amin (topic N)` on success. Doesn't change Status — operator marks Done when the post actually goes live.
- **Auth:** admin + social_media (warmup operator role).

### UI affordance
`✈ Send to Amin` button now appears in the per-task expand panel inside Account view. Hidden for Setup-phase tasks (those are operator-only, not for Amin). Clicking it prompts for an optional note ("post around 2pm ET" etc.), then sends.

### Airtable additive
- **AI Account Profile** gets one new field: `Warmup Telegram Topic ID` (single-line text). Stamped automatically on first send-to-Amin.

The `Warmup Telegram Topic ID` field I added to `Publer Accounts` in Batch 2 is now redundant but harmless. Leaving it for now — the Phase 3 monitoring dashboard may want per-Publer-Account topics for failure alerts (different use case).

## What's deferred from the original Batch 4 plan

The synthesizer scoped Batch 4 to also include:
- **`/posted` ack webhook** — Amin replies `/posted https://...` → webhook stamps the task's `Posted At` and `Post Link`. Not built. Defer rationale: requires either a public webhook URL (needs Telegram setWebhook config) or polling, and adds Compliance Log table dependencies. Low-volume warmup phase doesn't need automated acknowledgement — operator can spot-check.
- **Compliance Log table + auto-row-on-Done** — for EU AI Act Article 50 (enforceable Aug 2 2026). Not built. Defer rationale: too speculative without legal review. The required per-post audit row is straightforward to add when needed; the existing task `Notes` field already captures most of what an audit row would need.
- **Stub Palm Creators row for standalone AI personas (Katie Rosie)** — not needed by Batch 4 v1 because warmup sends go via `AI Account Profile` directly, bypassing the `Posts.Creator` requirement. The stub will be needed when the content engine starts writing real `Posts` rows for AI accounts (Batch 5 / future).
- **Telegram-queue cron extension** with `Pipeline Target='Telegram (Warmup)'` branch — not built. Defer rationale: warmup volume is operator-driven and low (<10/day max); eager-send is simpler and doesn't lose anything until volume grows.
- **Symmetric `Pipeline Target` validator on `telegram/enqueue`** — not built. Real-creator pipe is untouched (per the "gradual Amin transition" constraint), so the symmetric rejector isn't load-bearing yet.

## Files added/modified

```
+ app/api/admin/smm/warmup/send-task/[id]/route.js              (NEW)
M app/admin/recreate-source/_warmup/AccountView.js              (✈ Send to Amin button)
+ docs/build-plans/smm-consolidation/batch-4-handoff.md         (this file)
```

Plus the Airtable schema additive applied via Metadata API (not in git):
- AI Account Profile · new field `Warmup Telegram Topic ID` (fldYvZinLDyUFbEuF)

## Test plan — needs Telegram env vars

The endpoint requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_SMM_GROUP_CHAT_ID`. These are in Vercel env but **not in local `.env.local`** (confirmed). So:

**On the Vercel preview deploy** (auto-built from the pushed branch):
1. Open AI Content → Warm-Up tab.
2. Create a test account (any persona name).
3. Click "Mark Account Created."
4. Expand a Build-phase task (e.g., Day-1 "Set neutral bio").
5. Click `✈ Send to Amin`. Provide optional note (or leave blank).
6. Expect: alert "Sent to Amin (topic N, message M)". The warmup task's Notes field gets `[time] Sent to Amin (topic N)` prepended.
7. In the Telegram SMM group, a new forum topic `{persona} — Warmup` appears with the formatted message.

**Local:** The endpoint will return 500 `TELEGRAM_BOT_TOKEN not set` since the env var isn't in `.env.local`. Either copy from Vercel to test locally, or trust the build + test on the preview.

**If `createForumTopic` fails:** the SMM group must be a *supergroup* with forums enabled, and the bot must be an admin with manage-topics permission. The error response includes a `hint` field with this info.

## Rollback

```
cd /Users/jevanleith/palm-creator-portal
git worktree remove ../palm-creator-portal-smm
git branch -D smm-consolidation
git push origin :smm-consolidation
```

To roll back the schema: delete the `Warmup Telegram Topic ID` field from the AI Account Profile table in Airtable (the existing data, if any, is just text — no cross-references).

## What's next

Batch 5 — Publer Phase 3 polish. Schedule jitter, caption/hashtag rotation infra, banned-hashtag denylist enforcement, monitoring dashboard, email alerts, carousel per-slide rejection UI. Some of these are smaller-than-they-look (the symmetric validator is a 3-line addition; carousel per-slide reject is a UI refactor in CarouselSubmissionsReview.js).
