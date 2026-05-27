# Batch 3 — Content Strategy Engine

**Status:** READY AFTER BATCHES 1 + 2 LAND
**Branch:** `smm-consolidation`
**Estimated time:** 30-40 hours
**Airtable changes:** ADDITIVE — pillar fields on 4 existing tables + 3 new tables
**Predecessor:** master-plan.md, batch-1, batch-2

## Goal

Build the daily content engine that answers "what's next for [creator] in TJP?" automatically — pillar-tagged content libraries, per-account weekly content plan, caption + hashtag rotation with cross-account dedup against linked real creators, daily cron that pre-fills tomorrow's warmup post tasks with thumbnails / captions / hashtags. Eliminates the manual "scroll the Recreate Pool" friction.

## Prerequisites

- [ ] Batches 1 + 2 merged into branch and owner-approved.
- [ ] Owner has confirmed pillar taxonomy: Lifestyle / Fitness / Flirty / Behind-the-Scenes / Fashion / Trend Reaction / Q&A. (Open Question 5 from master plan.)
- [ ] Owner has confirmed caption-seeding mode: by-hand vs Haiku 4.5-drafted-then-approved. **Recommendation: by-hand for first 3 accounts** (8-12 captions × 3 personas × 7 pillars = ~200 captions max — owner controls voice).
- [ ] `ANTHROPIC_API_KEY` is set in env (already present per memory — verify).

## Airtable schema changes — additive only

### Fields added to `Recreate Reels` (`tblgKIecr9rdn8M60`)

| Field | Type |
|---|---|
| Pillar | Single select — Lifestyle / Fitness / Flirty / Behind-the-Scenes / Fashion / Trend Reaction / Q&A |
| Pillar Source | Single select — Manual / AI-Tagged / Heuristic / Inspiration-Tag-Seed |
| Pillar Confidence | Number — 0.0 to 1.0 |

### Fields added to `Carousel Projects` (`tblU1yON9P7zQljYM`)

Same three fields: Pillar, Pillar Source, Pillar Confidence.

### Fields added to `Inspiration` (`tblnQhATaMtpoYErb`)

Same three fields. Existing `Tags` field stays as-is; the pillar field is derived from it during seeding.

### Fields added to `Assets` (`tblAPl8Pi5v1qmMNM`)

Same three fields, plus:

| Field | Type |
|---|---|
| Source Reel | Link → Recreate Reels — Single. Set when this Asset was produced from a specific source reel. |
| Used By Sibling AI Account | Checkbox formula — for the 30-day cross-account dedup. (Optional; engine can compute on the fly.) |

### New table 1: `Creator Content Plan`

One row per (Account × Pillar × Channel × DayOfWeek × Slot). Owner defines the calendar; engine instantiates daily.

| Field | Type | Notes |
|---|---|---|
| Plan Name | Single line text | "Brielle IG — Mon AM Lifestyle" |
| AI Account Profile | Link → AI Account Profile | For AI accounts |
| Palm Creator | Link → Palm Creators | For real accounts (future scope) |
| Account Mode | Single select | `AI Account (Warmup)` / `AI Account (Live)` / `Real Account` |
| Channel | Single select | `IG` / `FB` |
| Pillar | Single select | Same options as Recreate Reels |
| Post Type | Single select | `Reel` / `Carousel` / `Photo` / `Story` |
| Day of Week | Single select | `Mon` ... `Sun` |
| Window Start (ET) | Single line text | "11:00" |
| Window End (ET) | Single line text | "13:00" |
| Active | Checkbox | |
| Last Selected At | Datetime | For round-robin tracking |

### New table 2: `Caption Templates`

| Field | Type | Notes |
|---|---|---|
| Template Name | Single line text | "Brielle Hook 1 — coffee morning" |
| AI Account Profile | Multi-link → AI Account Profile | Multi (reusable across accounts) |
| Palm Creator | Link → Palm Creators | Future scope |
| Pillar | Single select | |
| Post Type | Single select | |
| Caption Body | Long text | With `{persona}` placeholder |
| Used At | Datetime | Last engine pull (for round-robin) |
| Used Count | Number | Total times used |
| Active | Checkbox | |
| Created At | Created time | |

### New table 3: `Hashtag Pools`

| Field | Type | Notes |
|---|---|---|
| Pool Name | Single line text | "Lifestyle Safe — 2026 Q2" |
| Pillar | Single select | |
| Tags | Long text | Newline-separated, e.g. `#lifestyleblogger\n#contentcreator\n#sundayvibes` |
| Active | Checkbox | |
| Last Used At | Datetime | |
| Created At | Created time | |

### New table 4: `Hashtag Denylist`

Owner-editable list. Replaces hardcoded constant.

| Field | Type | Notes |
|---|---|---|
| Tag | Single line text | "#onlyfans" — primary key |
| Banned Reason | Long text | "OF-explicit; immediate shadow-flag" |
| Source | Single select | `Meta Policy` / `Playbook` / `Operator Flag` |
| Added At | Date | |
| Active | Checkbox | Default true |

## Pillar backfill — Claude Haiku 4.5

**Cost: ~$4 total for ~5000 records (Recreate Reels + Carousel Projects + Inspiration + Assets combined).**

Per Critique B: GPT-4o was overpriced. Haiku 4.5 with text-only input (caption + on-screen text + source handle) handles single-label classification into 7 pillars well within capability.

### Step 1 — Seed from existing data (FREE)

- `Inspiration.Tags` already exists. Heuristic map:
  - tags containing "lifestyle", "morning", "coffee" → Lifestyle
  - tags containing "gym", "workout", "fitness" → Fitness
  - tags containing "bikini", "swim", "lingerie" → Flirty
  - tags containing "BTS", "behind", "candid" → Behind-the-Scenes
  - tags containing "outfit", "OOTD", "fashion" → Fashion
  - tags containing "trend", "reaction", "challenge" → Trend Reaction
  - default → Q&A (low confidence; flag for manual review)
- For each Inspiration row, set `Pillar`, `Pillar Source = 'Inspiration-Tag-Seed'`, `Pillar Confidence = 0.8`.
- Run as a one-shot script `scripts/backfill-pillars-from-tags.mjs`.

### Step 2 — Haiku 4.5 classification (for everything without Tags)

Script `scripts/backfill-pillars-haiku.mjs`:

```
for each record in [Recreate Reels, Carousel Projects, Assets] where Pillar IS BLANK:
  promptHaiku({
    model: 'claude-haiku-4-5',
    system: 'Classify into one of: Lifestyle, Fitness, Flirty, Behind-the-Scenes, Fashion, Trend Reaction, Q&A. Respond with only the label.',
    user: `Caption: ${caption}\nOn-screen text: ${onScreenText}\nSource handle: ${sourceHandle}`
  })
  set Pillar = response, Pillar Source = 'AI-Tagged', Pillar Confidence = 0.7
```

Batch in groups of 50 (Anthropic's batch API), retry on 429.

### Step 3 — Manual review queue

After auto-tagging, flag records with `Pillar Confidence < 0.6` for manual review in `/admin/smm?tab=ai-content` (relabeled AI Content surface from Batch 1). New side panel: "Untagged / Low-Confidence — Tag Now."

## Engine architecture

### Selection logic (per slot)

Pseudocode for `lib/contentEngine.js`:

```
function selectNext({ accountProfileId, channel, postType, pillar, slotDate }) {
  const account = await getProfile(accountProfileId);
  const linkedRealCreator = account.linkedRealCreator;

  // 1. Asset filter
  const candidates = await fetchAirtableRecords('Recreate Reels', {
    filterByFormula: `AND(
      {Pillar} = '${pillar}',
      OR({Status} = 'Available', {Status} = 'Ready'),
      NOT(FIND('${account.handle}', ARRAYJOIN({Produced For}))),
      DATETIME_DIFF(NOW(), {Posted At}, 'days') < 30
    )`,
    sort: [{ field: 'Posted At', direction: 'desc' }]
  });

  // 2. Cross-account exclusion (sibling AI accounts within 30 days)
  const siblings = await getSiblingAIAccounts(account);  // Accounts under same agency FB / same Pixel cluster
  const excludeReels = await getReelsUsedBySiblings(siblings, 30 /* days */);
  const filtered = candidates.filter(r => !excludeReels.has(r.id));

  // 3. Cross-account caption dedup (real creator within 90 days)
  // (handled in caption selection step below)

  // 4. Score
  const scored = filtered.map(r => ({
    reel: r,
    score: 0.5 * semanticScore(r, linkedRealCreator) +
           0.3 * normalizeViews(r) +
           0.2 * recencyFactor(r)
  }));
  scored.sort((a, b) => b.score - a.score);

  // 5. Return top
  return scored.slice(0, 5);
}

function selectCaption({ accountProfileId, pillar, postType }) {
  const account = await getProfile(accountProfileId);
  const candidates = await fetchAirtableRecords('Caption Templates', {
    filterByFormula: `AND(
      FIND('${accountProfileId}', ARRAYJOIN({AI Account Profile})),
      {Pillar} = '${pillar}',
      {Post Type} = '${postType}',
      {Active}
    )`,
    sort: [{ field: 'Used At', direction: 'asc' }]  // oldest first
  });

  // Cross-account dedup against linked real creator (90-day window)
  if (account.linkedRealCreator) {
    const recentRealCaptions = await getRecentRealCreatorCaptions(account.linkedRealCreator, 90);
    candidates = candidates.filter(c => !recentRealCaptions.has(normalizeCaption(c.captionBody)));
  }

  if (candidates.length === 0) return null;
  const picked = candidates[0];
  await patchAirtableRecord('Caption Templates', picked.id, {
    'Used At': new Date().toISOString(),
    'Used Count': (picked.usedCount || 0) + 1
  });
  return picked;
}

function selectHashtags({ pillar }) {
  const pools = await fetchAirtableRecords('Hashtag Pools', {
    filterByFormula: `AND({Pillar} = '${pillar}', {Active})`
  });
  const denylist = await fetchAirtableRecords('Hashtag Denylist', {
    filterByFormula: '{Active}'
  });
  const denied = new Set(denylist.map(d => d.tag.toLowerCase()));

  // Pseudo-random weighted by inverse-recent-use
  const pool = weightedSample(pools, p => 1 / Math.max(1, daysSince(p.lastUsedAt)));
  const tags = pool.tags.split('\n').map(t => t.trim()).filter(Boolean);
  const validated = tags.filter(t => !denied.has(t.toLowerCase()));
  const picked = sampleWithoutReplacement(validated, 5);  // IG cap

  if (picked.length < 3) {
    // Pool depleted post-denylist; fail loud
    throw new Error(`Hashtag pool ${pool.poolName} has <3 valid tags after denylist filter`);
  }
  return picked;
}
```

### Daily cron: `/api/cron/warmup-content-fill`

Schedule: `0 11 * * *` (06:00 ET daily — 11:00 UTC during DST). Logic:

```
for each AI Account Profile where Warmup Status = 'Active Warmup':
  const day = getWarmupDay(account);
  const tomorrowsPostTasks = await fetchAirtableRecords('Warmup Tasks', {
    filterByFormula: `AND(
      {AI Account} = '${account.id}',
      {Day Number} = ${day + 1},
      {Task Type} = 'Post',
      {Linked Asset} = BLANK()
    )`
  });

  for each task of tomorrowsPostTasks:
    const planSlot = await getPlanSlotFor(account, task.postingChannel, dayOfWeek(day + 1), task.windowStart);
    if (!planSlot) continue;  // no plan defined; operator handles manually

    const candidates = await selectNext({
      accountProfileId: account.id,
      channel: planSlot.channel,
      postType: planSlot.postType,
      pillar: planSlot.pillar,
      slotDate: tomorrowAt(planSlot.windowStart)
    });

    if (candidates.length === 0) {
      await logEvent('content-engine', 'no-candidates', { account: account.id, pillar: planSlot.pillar });
      continue;
    }

    const caption = await selectCaption({ accountProfileId: account.id, pillar: planSlot.pillar, postType: planSlot.postType });
    const hashtags = await selectHashtags({ pillar: planSlot.pillar });

    // Pre-fill the task — operator can override
    await patchAirtableRecord('Warmup Tasks', task.id, {
      'Linked Asset': [findOrCreateAsset(candidates[0].reel, account)],
      'Caption (Suggested)': caption?.captionBody || '',
      'Hashtags (Suggested)': hashtags.join(' ')
    });
```

Register in `vercel.json`.

## "What's next for [creator]?" UI

Lives at `/admin/smm?tab=strategy` (replaces Batch 1 placeholder).

Top-level: dropdown to pick an AI Account → renders that account's view.

Per-account view:
- **Week Plan** — owner-editable grid (Mon-Sun × Channel × Slot). Click a cell to edit pillar + post type + window. Mirrors the Creator Content Plan table.
- **Tomorrow Preview** — for each post task on Day N+1, show the engine's pick: thumbnail + caption + hashtags. "Reroll" button regenerates the pick. "Override Asset" picker lets operator manually choose.
- **Pillar Coverage** — bar chart showing how many candidate assets exist in each pillar for this account. Flags pillars at <5 candidates ("Library running low on Fashion — schedule more TJP work").
- **Caption Inventory** — list of Active Caption Templates per pillar. Click "Add new" → modal to create.
- **Hashtag Pools** — list of Active pools per pillar. Edit / add new.

## Integration with Batch 2 (warmup) and Phase 3 (Publer)

**During warmup (per account):**
- Engine writes to `Warmup Tasks.Linked Asset / Caption (Suggested) / Hashtags (Suggested)`.
- Operator sees pre-filled cards in Today view, sends to Amin via Batch 4's send-to-amin.

**When account flips to Live (Warmup Status = 'Live'):**
- The cron skips that account's Warmup Tasks (none past Day 90 anyway).
- A second cron `/api/cron/content-engine-fill-live` (added in this batch) does the same engine logic but creates `Posts` rows directly with `Status = 'Prepping'`, `Pipeline Target = 'Publer'`, `Scheduled Date = window + jitter (Batch 5)`.
- Owner reviews Prepping posts in a new view `/admin/smm?tab=outbound-ai → "Pipeline Review"` tab, bulk-approves → Publer enqueue (existing flow).

**Auto-Approve flag (Open Question 7):** add a `Auto-Approve Live Posts` boolean on `AI Account Profile`. Default false. When true, the live cron sets `Status = 'Queued for Publer'` directly. Owner opts in per account after trust is established.

## Files to create

- `lib/contentEngine.js` — selectNext / selectCaption / selectHashtags + helpers.
- `lib/semanticScoring.js` — wraps the existing `Inspiration.Reel Embedding` + `Semantic Scores`. (Already in code per Audit B §B2.)
- `scripts/backfill-pillars-from-tags.mjs` — Step 1 of pillar backfill (free, heuristic).
- `scripts/backfill-pillars-haiku.mjs` — Step 2 of pillar backfill (~$4 of Haiku calls).
- `app/api/admin/content-engine/next/route.js` — Stateless query endpoint for UI.
- `app/api/admin/content-engine/reroll/route.js` — Reroll a single task's pick.
- `app/api/admin/content-engine/override-asset/route.js` — Operator override.
- `app/api/admin/content-engine/plan/route.js` — Creator Content Plan CRUD.
- `app/api/admin/content-engine/captions/route.js` — Caption Templates CRUD.
- `app/api/admin/content-engine/hashtag-pools/route.js` — Hashtag Pools CRUD.
- `app/api/admin/content-engine/denylist/route.js` — Hashtag Denylist CRUD.
- `app/api/cron/warmup-content-fill/route.js` — Daily warmup pre-fill cron.
- `app/api/cron/content-engine-fill-live/route.js` — Daily live-state Posts creation cron.
- `app/admin/smm/strategy/page.js` — Strategy UI (replaces Batch 1 placeholder).
- `components/strategy/WeekPlanEditor.js` — Mon-Sun × Channel × Slot grid.
- `components/strategy/TomorrowPreview.js` — Pre-fill preview per task.
- `components/strategy/PillarCoverage.js` — Bar chart.
- `components/strategy/CaptionInventory.js` — Caption Templates list.
- `components/strategy/HashtagPoolManager.js` — Hashtag Pools UI.

## Files to modify

- `app/admin/smm/page.js` — `?tab=strategy` renders the real strategy page now, not the placeholder.
- `lib/sidebarConfig.js` — Content Strategy sub-node loses its placeholder badge.
- `vercel.json` — register the two new crons.
- `app/admin/recreate-source/page.js` — add a "Pillar" badge to each reel card; add the "Tag Now" panel for low-confidence records.

## Test plan

1. **Pillar seed from Tags.** Run `scripts/backfill-pillars-from-tags.mjs`. Verify every Inspiration row with Tags now has Pillar set, Pillar Source = 'Inspiration-Tag-Seed'.
2. **Pillar AI backfill.** Run `scripts/backfill-pillars-haiku.mjs`. Verify cost ledger reports ~$4 spent. Verify all Recreate Reels and Carousel Projects have Pillar set.
3. **Manual review.** Open `/admin/smm?tab=ai-content`, see the "Untagged / Low-Confidence" panel populated. Tag 5 records manually.
4. **Define a content plan.** In `/admin/smm?tab=strategy`, pick Brielle. Add a row: Mon, IG, Reel, Lifestyle, 11:00-13:00 ET. Save.
5. **Run the warmup-content-fill cron manually.** `curl -X POST -H "Authorization: Bearer ${CRON_SECRET}" http://localhost:3000/api/cron/warmup-content-fill`. Verify tomorrow's Brielle post tasks have Linked Asset + Caption (Suggested) + Hashtags (Suggested) filled.
6. **Reroll.** Open Tomorrow Preview, click Reroll. Verify a different asset is selected (or same with explanation if pillar has only 1 candidate).
7. **Override.** Click Override Asset, pick a different reel manually. Verify task is patched.
8. **Cross-account caption dedup.** Add a caption to Amelia (real creator) → Posts with `Posted At = today`. Try to select that exact caption via the engine for Brielle. Verify it's rejected.
9. **Hashtag denylist.** Add `#onlyfans` to Hashtag Denylist. Add a pool containing `#onlyfans`. Try to fill a task — verify the engine errors with "Hashtag pool has <3 valid tags after denylist filter" (or skips that pool gracefully).
10. **Pillar coverage.** Set Brielle's Fashion library to <5 candidates. Verify the warning surfaces in the UI.
11. **Live-state fill.** Manually set Brielle's Warmup Status = 'Live'. Run `/api/cron/content-engine-fill-live`. Verify a Posts row is created with `Status = 'Prepping'`, `Pipeline Target = 'Publer'`.

## Rollback procedure

```
git checkout dev
git branch -D smm-consolidation
```

Then in Airtable:
1. Delete the pillar fields on Recreate Reels, Carousel Projects, Inspiration, Assets (Pillar, Pillar Source, Pillar Confidence). Also delete `Source Reel` on Assets.
2. Delete the 4 new tables: Creator Content Plan, Caption Templates, Hashtag Pools, Hashtag Denylist.
3. Remove the two new cron entries from `vercel.json` (handled by the git revert).

## Estimated time

30-40 hours. Breakdown:
- Airtable schema + pillar field additions (manual): 1-2h
- Pillar backfill scripts + execution: 3-4h
- `lib/contentEngine.js` + scoring helpers: 6-8h
- API routes (8 routes): 6-8h
- Strategy UI (week plan + tomorrow preview + pillar coverage): 8-10h
- Caption + Hashtag pool UIs: 4-5h
- Cron registration + manual cron testing: 2-3h
- Manual test + bugfix: 4-6h

## Success criteria

- [ ] Every Recreate Reel, Carousel Project, Inspiration row, and Asset has a Pillar value.
- [ ] Owner can edit pillar taxonomy, captions, hashtag pools without a deploy.
- [ ] Daily warmup cron pre-fills tomorrow's post tasks for all active AI accounts.
- [ ] Reroll + override work end-to-end.
- [ ] Cross-account caption dedup confirmed (test step 8).
- [ ] Hashtag denylist confirmed (test step 9).
- [ ] Pillar coverage chart renders correctly.
- [ ] Pillar backfill total cost is documented and matches the ~$4 estimate (within 50%).
- [ ] `next build` passes; lint clean.
- [ ] Handoff doc `batch-3-handoff.md` written.
