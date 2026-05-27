# Batch 2 — Account Warm-Up Flow

**Status:** READY AFTER BATCH 1 LANDS
**Branch:** `smm-consolidation`
**Estimated time:** 50-70 hours
**Airtable changes:** ADDITIVE — 6 new tables, 3 new fields on Publer Accounts
**Predecessor:** master-plan.md, batch-1-nav-consolidation.md

## Goal

Ship the per-AI-account warm-up flow that the three in-flight personas (Brielle, Lily, Katie Rosie) need to operate against the 90-day playbook with zero mental load: day-counter-driven Today view, per-account Schedule / Credentials / History / Incidents tabs, owner-only Playbook Editor, Day-21 sub-task decomposition with prerequisite chaining, Day-45 owner-approval gate, backfill / catch-up mode, versioned templates, and a Pixel/SIM hardware inventory.

## Prerequisites

- [ ] Batch 1 merged into branch and owner-approved.
- [ ] `/admin/smm?tab=warmup` placeholder card is live (it'll be replaced).
- [ ] Owner has decided on credential vault: **Bitwarden vs 1Password** (Open Question 1). Default recommendation: Bitwarden Family ($40/yr). Env var `VAULT_BASE_URL` set to the vault's URL prefix.
- [ ] Owner has confirmed pillar taxonomy (Open Question 5). Default: Lifestyle / Fitness / Flirty / Behind-the-Scenes / Fashion / Trend Reaction / Q&A.
- [ ] Brielle's current state confirmed (Open Question 3): is she past Day 1? If yes, batch ships with backfill mode active.

## Airtable schema changes — additive only

### New table 1: `AI Account Profile`

One row per AI persona. Operator-curated; never touched by Publer sync.

| Field | Type | Notes |
|---|---|---|
| Account Handle | Single line text | Primary — e.g. `briel.ai` |
| Persona Name | Single line text | Display — e.g. `Brielle` |
| Linked Real Creator | Link → Palm Creators | Single. Empty for standalone (Katie Rosie). Note: Batch 4 creates a stub Palm Creators row for standalone personas. |
| Linked Publer Account (IG) | Link → Publer Accounts | Single. Populated Day 23. |
| Linked Publer Account (FB) | Link → Publer Accounts | Single. Populated Day 23. |
| Account Type | Single select: `AI` | Sanity column |
| Account Created Date | Date | Day 0 anchor. Null until operator marks "Account Created." |
| Hardware Prep Started Date | Date | Optional, Days −7 to 0 |
| Days Paused | Number | Default 0 |
| Warmup Status | Single select | `Hardware Prep` / `Active Warmup` / `Paused — Flagged` / `Paused — Operator` / `Warmup Complete` / `Live` / `Retired` |
| Instantiated Against Template Version | Number | The `Warmup Playbook Templates.Template Version` value used at instantiation |
| Is Insurance Account | Checkbox | Day-7 twin/insurance per playbook |
| Sibling AI Account | Link → AI Account Profile | Single. If Insurance, points to primary. |
| Bio (Current) | Long text | Free text |
| IG Handle | Single line text | |
| IG Username (vault item ID) | Single line text | Vault item ID, not URL |
| IG Password (vault item ID) | Single line text | Vault item ID |
| IG TOTP Seed (vault item ID) | Single line text | |
| FB Profile Name | Single line text | |
| FB Profile (vault item ID) | Single line text | |
| Gmail Address | Single line text | |
| Gmail Password (vault item ID) | Single line text | |
| Gmail TOTP Seed (vault item ID) | Single line text | |
| Recovery Email | Single line text | |
| Recovery Phone | Single line text | The Mint SIM number |
| Recovery Codes (vault item ID) | Single line text | |
| Linked SIM | Link → SIM Inventory | Single |
| Linked Pixel Device | Link → Pixel Devices | Single |
| GrapheneOS Profile Name | Single line text | "Amelia profile" |
| Beacons URL | URL | |
| Beacons (vault item ID) | Single line text | |
| TGP Consent Record ID | Single line text | Mirrors Publer Accounts.AI Consent on File |
| Notes | Long text | |
| Created At | Created time | |

### New table 2: `Warmup Tasks`

One row per (Account × Day × Task). ~360-400 rows per account.

| Field | Type | Notes |
|---|---|---|
| Task Name | Single line text | "Day 10 — Add Beacons link to IG bio" |
| AI Account | Link → AI Account Profile | Single, required |
| Day Number | Number | -7 to 90 |
| Sub-Step Order | Number | For Day-21 chained sub-steps. Default 0; chain uses 1..5 |
| Prerequisite Task | Link → Warmup Tasks | Single. If set, this task can't transition to In Progress until the prereq is Done. |
| Task Type | Single select | `Hardware` / `Account Setup` / `Bio Update` / `Profile Pic` / `Engagement` / `Post` / `Story` / `Reminder` / `Publer Setup` / `Beacons` / `Monetization` / `Hygiene Check` / `Owner Approval` |
| Posting Channel | Single select | `IG` / `FB` / `Both` / `—` |
| Window Start (ET) | Single line text | "13:00" |
| Window End (ET) | Single line text | "15:00" |
| Quota Target | Number | |
| Quota Actual | Number | |
| Task Detail | Long text | The how, with `{persona}`, `{real_handle}`, `{beacons_url}` resolved at instantiation |
| Bio Target | Long text | For Bio Update tasks |
| Linked Asset | Link → Assets | Populated by Batch 3 content engine |
| Linked Carousel Project | Link → Carousel Projects | |
| Caption (Suggested) | Long text | Populated by Batch 3 |
| Hashtags (Suggested) | Long text | Populated by Batch 3 |
| Status | Single select | `Pending` / `In Progress` / `Done` / `Skipped` / `Failed` / `Sent to Amin` / `Awaiting Approval` |
| Requires Owner Approval | Checkbox | True for Day-45 OF CTA task |
| Approved By | Single line text | Clerk email of approving owner |
| Approved At | Datetime | |
| Completed At | Datetime | Auto-stamped on Status → Done |
| Completed By | Single line text | Clerk email |
| Skipped Reason | Long text | |
| Operator Notes | Long text | |
| Telegram Sent At | Datetime | Stamped by Batch 4's send-to-amin route |
| Telegram Message ID | Single line text | |
| Amin Confirmed | Checkbox | Set by Batch 4's `/posted` webhook |
| Posted At | Datetime | Set by Batch 4's `/posted` webhook |
| Post Link | URL | Set by Batch 4's `/posted` webhook |
| Created At | Created time | |

### New table 3: `Warmup Playbook Templates`

The canonical 90-day playbook in structured form. ~150-200 rows.

| Field | Type | Notes |
|---|---|---|
| Template Name | Single line text | "Day 1 — Lifestyle Post #1" |
| Template Version | Number | Increments on every edit; instantiation captures this on the AI Account Profile |
| Day Number | Number | -7 to 90 |
| Sub-Step Order | Number | For Day-21 chain |
| Prerequisite Template | Link → Warmup Playbook Templates | Single. Used at instantiation to wire prereq links between Warmup Tasks rows |
| Task Type | Single select | Same options as Warmup Tasks |
| Task Detail | Long text | With `{persona}`, `{real_handle}`, `{beacons_url}` placeholders |
| Posting Channel | Single select | |
| Window Start (ET) | Single line text | |
| Window End (ET) | Single line text | |
| Quota Target | Number | |
| Bio Target | Long text | |
| Requires Owner Approval | Checkbox | |
| Active | Checkbox | Owner toggles off without delete |
| Insurance Variant | Checkbox | If True, only used when instantiating an Insurance Account |

### New table 4: `Warmup Incidents`

| Field | Type | Notes |
|---|---|---|
| Incident Name | Single line text | Auto-generated: "Brielle — Shadowban — 2026-06-10" |
| AI Account | Link → AI Account Profile | Required |
| Incident Type | Single select | `Suspended at Creation` / `Shadowban Detected` / `Page Disabled` / `BM Restricted` / `Account Locked` / `Other` |
| Detected At | Datetime | |
| Day Number When Detected | Number | Snapshot at time of detection |
| Resolution Status | Single select | `Open` / `Appealing` / `Recovered` / `Abandoned` |
| Appeal Count | Number | Hard cap 1 (validated server-side). Per playbook recovery rules. |
| Recovery Steps Completed | Long text | Checklist progress |
| Resolved At | Datetime | |
| Recovery Notes | Long text | |
| Created At | Created time | |

### New table 5: `Pixel Devices`

| Field | Type | Notes |
|---|---|---|
| Device Label | Single line text | "Pixel 8a #1" |
| Purchase Date | Date | |
| Status | Single select | `Active` / `Offline` / `Returned` / `Damaged` |
| Linked AI Accounts | Multi-link → AI Account Profile | |
| Storage | Single select | `128GB` / `256GB` / `512GB` |
| GrapheneOS Version | Single line text | |
| Notes | Long text | |

### New table 6: `SIM Inventory`

| Field | Type | Notes |
|---|---|---|
| SIM Label | Single line text | "Mint $15 — Brielle" |
| Phone Number | Single line text | |
| Carrier | Single select | `Mint Mobile` / `Ultra Mobile PayGo` / `Other` |
| Monthly Cost (USD) | Number | |
| Status | Single select | `Active` / `Stored` / `Cancelled` |
| Linked AI Account | Link → AI Account Profile | Single |
| Activated At | Date | |
| Notes | Long text | |

### Fields added to `Publer Accounts` (existing table — additive)

| Field | Type | Notes |
|---|---|---|
| Warmup Telegram Topic ID | Single line text | Set by Batch 4's create-telegram-topic route |
| AI Account Profile | Link → AI Account Profile | Single |
| Warmup Day (Formula) | Formula | `IF({AI Account Profile}, DATETIME_DIFF(TODAY(), {AI Account Profile: Account Created Date}, 'days') - {AI Account Profile: Days Paused}, BLANK())` |

## Day counter logic

Server-side helper in `lib/warmupSchedule.js`:

```
export function getWarmupDay(accountProfile, now = new Date()) {
  if (!accountProfile.accountCreatedDate) return null;
  const todayET = floorToETMidnight(now);
  const createdET = floorToETMidnight(parseDate(accountProfile.accountCreatedDate));
  const elapsedDays = Math.floor((todayET - createdET) / DAY_MS);
  return elapsedDays - (accountProfile.daysPaused || 0);
}

export function getTodaysTasks(accountId, day) {
  return fetchAirtableRecords('Warmup Tasks', {
    filterByFormula: `AND({AI Account} = '${accountId}', {Day Number} = ${day}, {Status} != 'Done', {Status} != 'Skipped')`
  });
}
```

Use `Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York' })` to derive the calendar day, not naive UTC subtraction. Edge cases:
- Daylight Saving: handled by ET calendar floor.
- Late-evening creation (e.g. 11pm ET): Day 1 starts on the same calendar day; operator gets a brief Day 1.
- Paused account: Today view shows "Warmup paused — Day frozen at N."

## Playbook template → per-account task instantiation

When operator clicks "Mark Account Created":

1. Server reads the latest version of `Warmup Playbook Templates` where `Active = true`, plus `Insurance Variant = Is Insurance Account`.
2. For each template row, creates a `Warmup Tasks` row with the template's fields verbatim, but:
   - Template variables resolved: `{persona}` → AI Account Profile.Persona Name, `{real_handle}` → Linked Real Creator's handle, `{beacons_url}` → AI Account Profile.Beacons URL.
   - `Status = 'Pending'` (or `'Awaiting Approval'` if Requires Owner Approval).
   - `Prerequisite Task` resolved: lookup the just-created Warmup Task for the template's `Prerequisite Template` and link it.
   - `Linked Asset`, `Caption (Suggested)`, `Hashtags (Suggested)` left null — Batch 3's content engine fills them.
3. Set `AI Account Profile.Account Created Date = today`, `Warmup Status = 'Active Warmup'`, `Instantiated Against Template Version = latest version`.

### Day-21 sub-task chain (5 rows, prereq-chained)

| Sub-Step Order | Task Name | Prereq |
|---|---|---|
| 1 | Day 21.1 — Create FB Additional Profile under agency account | none |
| 2 | Day 21.2 — Create FB Page admin'd by Additional Profile | Sub-step 1 |
| 3 | Day 21.3 — Create dedicated Business Portfolio | Sub-step 2 |
| 4 | Day 21.4 — Link Page to IG via Account Center | Sub-step 3 |
| 5 | Day 23 — Authorize Publer via "Professional (via Facebook)" | Sub-step 4 |

Today view renders Day 21 as a 5-step numbered sequence. Each sub-step's "Mark Done" button is disabled until the prereq's Status = Done. Server-side check on the PATCH route also enforces.

### Day-45 OF CTA approval gate

The Day-45 template row has `Requires Owner Approval = true` and `Task Type = 'Owner Approval'`. At instantiation:
- The actual "Add OF CTA to Beacons" task is created with `Status = 'Awaiting Approval'`.
- A separate Owner Approval task is created on Day 43 (48h pre-flight): "Owner Approval — Day 45 OF CTA for {persona}." When owner sets `Approved By` and `Approved At`, the dependent task's `Status` flips to `Pending` and surfaces on the Today view 48h later.

Server-side validator on the PATCH route: any task with `Requires Owner Approval = true` and `Approved By IS BLANK` cannot transition to In Progress or Done.

### Template versioning + patch-in-flight admin action

`POST /api/admin/smm/warmup/patch-from-latest` body: `{ accountProfileId }`. Logic:
1. Read `AI Account Profile.Instantiated Against Template Version`.
2. Read the latest `Warmup Playbook Templates` version.
3. For each template row at `Template Version > instantiated_version` where `Day Number >= currentDay + 1`:
   - If a corresponding `Warmup Tasks` row exists at `Day Number` for this account AND it has `Status = 'Pending'`, replace its content with the latest template (keep the row ID so prereq links don't shatter).
   - If no corresponding row exists, create one.
4. Update `Instantiated Against Template Version` on the profile.
5. Done-tasks are never touched.

Surfaced via a button on `/admin/smm/warmup/[accountId]` Schedule tab: "Update from latest playbook (v{N})."

### Backfill / Catch-up Mode

On `/admin/smm/warmup/[accountId]` Today view, if any prior-day tasks exist in `Pending`:
- Show a "Catch up on N tasks from prior days" affordance at the top.
- Click reveals a list grouped by day, each with `[Bulk-mark done]` and per-task `[Skip with reason]` actions.
- Skipped post tasks DO NOT push the calendar back (engagement / story tasks are time-bounded; the calendar continues to Day N).
- New `Status = 'Skipped'` with `Skipped Reason` required if skipping a post task.

On "Mark Account Created" there's a "Backfill Mode" toggle that lets the operator specify a past date as the `Account Created Date`. When toggled, the instantiation step also lets the operator bulk-mark prior-day tasks as Done from memory.

## High-risk task gates summary

- **Day 21 (5 sub-steps):** prereq-chained, server-validated, no skip-ahead.
- **Day 45 (OF CTA flip):** `Requires Owner Approval` boolean + 48h soft delay between approval and surfacing.
- **Multiple appeals on a flagged account:** server-side validator on `Warmup Incidents.Appeal Count` rejects writes that would make it >1 within a 30-day window.
- **Insurance account at Day 7:** template row tagged `Insurance Variant`; flagged for operator decision at Day 7 — "Spin up insurance account now?"

## Files to create

- `lib/warmupSchedule.js` — Day counter + task helpers.
- `lib/warmupInstantiate.js` — Template → task instantiation logic.
- `lib/warmupValidators.js` — Server-side validators for prereq chain + owner approval + appeal cap.
- `app/api/admin/smm/warmup/profile/route.js` — GET/POST/PATCH for AI Account Profile.
- `app/api/admin/smm/warmup/profile/[id]/mark-created/route.js` — Instantiation endpoint.
- `app/api/admin/smm/warmup/profile/[id]/pause/route.js` — Pause / resume.
- `app/api/admin/smm/warmup/profile/[id]/patch-from-latest/route.js` — Template patch action.
- `app/api/admin/smm/warmup/tasks/route.js` — Today's tasks query.
- `app/api/admin/smm/warmup/tasks/[id]/route.js` — Single-task PATCH with validators.
- `app/api/admin/smm/warmup/tasks/[id]/approve/route.js` — Owner approval endpoint.
- `app/api/admin/smm/warmup/incidents/route.js` — Incident CRUD.
- `app/api/admin/smm/warmup/templates/route.js` — Template CRUD (owner-only).
- `app/admin/smm/warmup/page.js` — Today view (replaces Batch 1 placeholder).
- `app/admin/smm/warmup/[accountId]/page.js` — Per-account 5-tab view.
- `app/admin/smm/warmup/template/page.js` — Playbook editor (owner-only).
- `components/warmup/TodayTaskCard.js` — Single task card with action button + status pill.
- `components/warmup/AccountSummary.js` — Account header (day counter + status badge).
- `components/warmup/Day21Chain.js` — Special renderer for the 5-step chain.
- `components/warmup/CatchUpDrawer.js` — Catch-up mode panel.
- `components/warmup/VaultLink.js` — Renders a "Copy Vault Link" client-side button.

## Files to modify

- `app/admin/smm/page.js` — `?tab=warmup` now renders the real warmup page instead of the placeholder.
- `lib/sidebarConfig.js` — Account Warm-Up sub-node loses its placeholder badge.
- `lib/adminAuth.js` — no new helpers required; reuse `requireAdmin` and `requireAdminOrAiEditor`. (If Critique A's `requireAdminOrSocialMediaReadonly` was deferred — it stays deferred here.)

## UI surfaces — proposed

### 1. `/admin/smm?tab=warmup` — Today view (the home view)

Default landing when SMM is opened during warmup era. Vertical list of AI Account cards. Each card:
- Header: persona name, handle, "Day N / 90", Warmup Status badge, "View full profile →".
- Body: today's tasks grouped by Task Type, sorted by Window Start. Each task is a `TodayTaskCard` with appropriate action.
- Footer (if Pending tasks from prior days): "Catch up on N tasks from prior days" → opens `CatchUpDrawer`.
- Banner if paused: "Warmup paused — Day frozen at N" + Resume button.

### 2. `/admin/smm/warmup/[accountId]` — Per-account 5-tab view

- **Today** — same as the home view but filtered to this account.
- **Schedule** — accordion of all 90 days. Today highlighted. "Update from latest playbook" button. Each future day expandable to see "what's coming."
- **Credentials & Profile** — read-only display of all AI Account Profile fields. `VaultLink` button per credential. Edit-in-place for bio/notes.
- **History / Audit log** — every Done/Skipped task with timestamp + operator.
- **Incidents** — Warmup Incidents timeline + "Log new incident" button.

### 3. `/admin/smm/warmup/template` — Playbook editor (owner-only)

`requireAdmin`. CRUD on Warmup Playbook Templates. Version increments on every save. "Active" toggle for soft-delete.

## Today view logic (pseudocode)

```
function TodayView({ role, userId }) {
  const profiles = await fetchActiveProfiles();  // Warmup Status IN ['Active Warmup', 'Paused — Operator', 'Paused — Flagged']
  return profiles.map(profile => {
    const day = getWarmupDay(profile);
    const todays = await getTodaysTasks(profile.id, day);
    const stale = await getPriorPendingTasks(profile.id, day);
    const isPaused = profile.warmupStatus.startsWith('Paused');
    return <AccountCard
      profile={profile}
      day={day}
      todays={todays}
      stale={stale}
      isPaused={isPaused}
    />;
  });
}
```

`TodayTaskCard` rendering by Task Type:
- **Engagement:** title + target quota + actual-input + Mark Done.
- **Bio Update:** current bio + target bio side-by-side + "Mark bio updated" (copies target → current on success).
- **Profile Pic:** "Profile pic set?" boolean.
- **Post:** thumbnail of Linked Asset, caption preview, hashtag preview, posting window + "Send to Amin" (Batch 4 wires this).
- **Publer Setup (Day 21 chain):** rendered via `Day21Chain` as numbered sequence.
- **Owner Approval:** "Approve" button (only renders if currentUser is owner per `requireAdmin`).
- **Reminder:** static info card + "Acknowledge" button.

## Pause / extend / retire flows

**Pause:** PATCH `/api/admin/smm/warmup/profile/[id]/pause` with `{ reason: 'Flagged' | 'Operator hold' | 'Hardware issue' }`. Server stamps `Warmup Status` accordingly. While paused, day counter is frozen; on resume, `Days Paused` increments by `daysSincePauseStarted`.

**Extend:** No-op. Once past Day 90, operator manually sets `Warmup Status = 'Live'`. Tasks for Day > 90 don't exist; the content engine in Batch 3 starts writing to Posts instead of Warmup Tasks.

**Retire:** PATCH `Warmup Status = 'Retired'`. Existing Warmup Tasks rows preserved for audit. New AI Account Profile created if operator is spinning a fresh persona.

**Hardware prep (Days −7 to 0):** template rows with `Day Number < 0` are visible on Today view when `Hardware Prep Started Date` is set but `Account Created Date` is null. Pre-flight on "Mark Account Created" warns if any prior-day-< 0 tasks are still Pending.

## Credentials storage

**Decision: Vault item IDs, not URLs, with client-side URL construction.**

- Owner picks Bitwarden Family ($40/yr) OR 1Password Team ($8/mo/user). Recommendation: Bitwarden — cheaper, sufficient for agency scale.
- Env var `VAULT_BASE_URL` = `https://vault.bitwarden.com/#/vault?itemId=` (or 1Password equivalent).
- Each credential field on `AI Account Profile` stores the vault item ID only (e.g. `f7c8a1d2-3456-7890-abcd-ef1234567890`).
- UI uses `VaultLink` component to construct the URL client-side: `${process.env.NEXT_PUBLIC_VAULT_BASE_URL}${itemId}`. "Copy Vault Link" button → clipboard.
- If Airtable backup leaks, attackers get item IDs that are useless without the vault account.

**Naming convention for vault items:** `AI Account / {Persona Name} / {Credential Type}` — e.g. `AI Account / Brielle / IG Password`. Owner standardizes during Batch 2 setup.

**Specifically NOT stored in Airtable:** raw passwords, raw TOTP seeds, raw recovery codes. Only the vault item ID.

## Test plan

End-to-end test sequence:

1. **Create profile.** POST `/api/admin/smm/warmup/profile` with `{ accountHandle: 'briel.ai', personaName: 'Brielle', linkedRealCreator: 'recAmeliaXXX' }`. Verify a new `AI Account Profile` row exists with `Warmup Status = 'Hardware Prep'`.
2. **Add hardware metadata.** Create Pixel Device row, SIM Inventory row, link both to the profile.
3. **Mark hardware prep done.** Toggle the 4 hardware tasks on Days -7 to 0 to Done.
4. **Mark Account Created.** Click the button. Verify ~360-400 `Warmup Tasks` rows are created with `AI Account` = Brielle. Verify `Account Created Date = today`. Verify `Warmup Status = 'Active Warmup'`. Verify `Instantiated Against Template Version` = latest.
5. **Open Today view.** Visit `/admin/smm?tab=warmup`. See Brielle card with "Day 1 / 90" + Day 1 tasks listed.
6. **Complete a task.** Click Mark Done on the Day 1 lifestyle-post task. Verify `Status = 'Done'`, `Completed At = now`, `Completed By = current user`.
7. **Pause warmup.** Click Pause with reason "Operator hold." Verify `Warmup Status = 'Paused — Operator'`, Today view shows pause banner.
8. **Resume.** Click Resume after 2 days. Verify `Days Paused += 2`, day counter still says "Day 1" (because elapsed - paused = 1).
9. **Day-21 chain.** Fast-forward (mark `Account Created Date` to 21 days ago). Verify Day 21 shows the 5-step chain. Try clicking Step 2's Mark Done before Step 1 → server rejects with prereq error.
10. **Day-45 approval.** Fast-forward to Day 43. Verify the Owner Approval task shows up. Click Approve as owner. Verify Day 45's OF CTA task transitions from `Awaiting Approval` to `Pending` exactly 48h later (use a date override for testing).
11. **Patch from latest template.** Edit a Day 60 template row, bump Template Version. Click "Update from latest playbook" on Brielle's Schedule tab. Verify Day 60's task content is updated, Day 1's is not.
12. **Incident logging.** Click "Log new incident" → Type = Shadowban, Detected At = now. Verify a `Warmup Incidents` row exists; `Warmup Status` does NOT auto-flip (operator chooses to pause separately).
13. **Backfill mode.** Create a new profile, toggle Backfill Mode, set Account Created Date = 14 days ago. Verify the instantiation creates tasks for Days 1-14 and the operator can bulk-mark prior days as Done.
14. **Catch-up.** Leave a task in Pending past its day. Open Today view next day. Verify the "Catch up on N tasks" affordance appears.
15. **Vault link.** Add a vault item ID to IG Password. Click "Copy Vault Link." Verify clipboard contains `${VAULT_BASE_URL}${itemId}`.

## Rollback procedure

```
git checkout dev
git branch -D smm-consolidation
```

Then in Airtable, delete (in order):
1. The 3 added fields on `Publer Accounts` (Warmup Telegram Topic ID, AI Account Profile, Warmup Day formula).
2. The 6 new tables: AI Account Profile, Warmup Tasks, Warmup Playbook Templates, Warmup Incidents, Pixel Devices, SIM Inventory.

(Backup the schema first if owner wants audit history — Airtable's revision history retains 1 year on Business plan.)

## Estimated time

50-70 hours. Breakdown:
- Airtable schema setup (manual, owner-driven): 3-4h
- Playbook template seeding (manual data entry from the markdown playbook into 150-200 template rows): 6-8h
- `lib/warmupSchedule.js` + `lib/warmupInstantiate.js` + validators: 6-8h
- API routes (10 routes): 12-15h
- Today view + per-account view: 12-15h
- Playbook editor: 4-6h
- Day-21 chain UI + Day-45 approval flow: 4-6h
- Backfill / catch-up mode: 4-5h
- Vault link integration: 2h
- Manual test + bugfix: 6-10h

## Success criteria

- [ ] All 6 new Airtable tables exist with the documented schema.
- [ ] 3 new fields on Publer Accounts exist.
- [ ] Brielle can be created end-to-end: profile → hardware → mark created → see Day 1 tasks.
- [ ] Day-21 sub-task chain enforces prereqs server-side (test confirms).
- [ ] Day-45 OF CTA cannot transition to Done without owner approval (test confirms).
- [ ] Template versioning works: edits to a template don't disturb in-flight accounts unless owner clicks "Update from latest playbook."
- [ ] Backfill mode lets operator create a profile already at Day 14.
- [ ] Catch-up mode surfaces stale Pending tasks from prior days.
- [ ] Vault links work end-to-end (item ID → clipboard URL).
- [ ] Today view loads in <500ms for 3 active accounts.
- [ ] `next build` passes; lint clean.
- [ ] Handoff doc `batch-2-handoff.md` written.
