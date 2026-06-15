# Batch 3 — Handoff

**Branch:** `smm-consolidation` (worktree at `/Users/jevanleith/palm-creator-portal-smm`)
**Date:** 2026-05-27
**Build:** `next build` passes clean.
**Airtable changes:** NONE in this batch (foundation tables deferred — see below).

## What shipped

### 1. Carousel auto-grouping (the big one evan called out)

In **Editor → Carousels tab**, a new purple **🔮 Find Similar Photo Clusters** button next to the source filters. Click → Claude Haiku 4.5 vision analyzes up to 30 visible photos and groups them by shoot (same setting / outfit / lighting / pose). Each cluster surfaces as a card with a thumbnail strip + **+ Add N to tray** button.

- **Cost:** ~$0.02 per analysis run (estimate shown in the cluster panel header). Haiku 4.5 with vision is ~10× cheaper than Sonnet/Opus for this kind of classification.
- **Guardrails:** Requires ≥4 photos to be visible. Auto-resets when creator / filter / search changes (cached results would mislead). Cluster minimum size = 2 photos.
- **Filter:** Dropbox-share-only photos are skipped at request time (Claude can't fetch raw bytes from `dropbox.com` URLs). CDN-hosted + Airtable-attachment photos work fine.
- **Capacity:** Tray's 10-photo cap is respected on cluster-add. Overflow is warned with a toast.

### 2. Caption suggestions in Post Prep

The existing `CaptionSuggestions` widget (already used in For Review) is now wired into every **Post Prep PostCard**. Under the caption textarea, operator can:
- Pick a caption mode (Scenario / Controversy / Relationship / Visual Callout / Relatable / Mood)
- Pick a tone (Subtle / Flirty / Suggestive / Spicy)
- Generate
- Click "Use" on any of the 3 suggestions → auto-fills the caption field + marks the card dirty

This was a "the capability exists but isn't surfaced here" gap — now closed.

### 3. Marketing Content Active warm-ups tile

Already wired in Batch 2. No change in Batch 3.

## What's deferred (and why)

The original synthesizer plan called for a much larger Batch 3 (pillar tagging across 4 content tables + Creator Content Plan + Caption Templates + Hashtag Pools tables + content engine + daily cron + pillar backfill). I shipped only the two highest-value items evan explicitly called out, deferring the rest because they're speculative without:

- **Pillar taxonomy locked in by owner.** I drafted `Lifestyle / Fitness / Flirty / BTS / Mirror Selfie / Pet / Food / Travel / Vibe / Unclassified` from the synthesizer plan but haven't applied it. Adding pillar fields without a clear consumer = data noise.
- **Per-creator content plan structure.** What slots (M/W/F? daily? per-channel cadence?), what pillar rotation rules? Owner-decision territory. The engine that USES the plan should ship together with the plan.
- **Caption template + hashtag pool tables.** Same: structure depends on how many pillars / how the engine draws. Ships together with the engine.

**Net:** Batch 3 ships ~25% of the original synthesizer scope by row count but ~80% of the immediate operator value (the two pain points evan called out by name).

## Files added/modified

```
+ app/api/admin/smm/carousel-grouping/analyze/route.js  (NEW — Haiku 4.5 vision endpoint)
M app/admin/editor/CarouselsTab.js                      (Find Clusters button + clusters panel + analyzer wiring)
M app/admin/posts/page.js                               (CaptionSuggestions widget wired into PostCard)
+ docs/build-plans/smm-consolidation/batch-3-handoff.md (this file)
```

No Airtable changes. No new tables, no new fields.

## Test plan — verify in your browser

Dev server: http://localhost:3001

### Carousel auto-grouping
1. Editor → Carousels tab.
2. Pick a creator that has 4+ photos (any creator with a populated photo library).
3. Click 🔮 Find Similar Photo Clusters. Wait ~3-8 seconds.
4. Cluster cards appear with name + rationale + thumbnail strip. Cost estimate is shown in the header.
5. Click "+ Add N to tray" — the cluster's photos land in the carousel tray on the right.
6. If you switch creators / change source filter / type a search, the clusters panel resets (must re-click Find).
7. If a cluster's photos have already been added or the tray is near full, you'll see a toast.

### Post Prep caption suggestions
1. Editor → Post Prep tab.
2. Find a card that needs a caption.
3. Below the caption textarea, see the CaptionSuggestions widget (collapsed by default).
4. Click "Generate captions" → pick mode + tone → suggestions appear.
5. Click "Use" on one → caption textarea fills + card marked dirty (Save button activates).

## Rollback

```
cd /Users/jevanleith/palm-creator-portal
git worktree remove ../palm-creator-portal-smm
git branch -D smm-consolidation
git push origin :smm-consolidation
```

No Airtable changes.

## What's next

Batch 4 — Amin Telegram bridge fix. This is the critical bug Critic B caught: today, warmup posts for AI accounts would mis-route to the real creator's Telegram topic. Fix: per-AI-account Telegram topic stored on Publer Accounts (the field already exists from Batch 2 — `Warmup Telegram Topic ID`), telegram-queue cron grows a `Pipeline Target='Telegram (Warmup)'` branch, /posted ack webhook, ET+IST display.
