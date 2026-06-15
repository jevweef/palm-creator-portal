# Batch 2 — Handoff

**Branch:** `smm-consolidation` (worktree at `/Users/jevanleith/palm-creator-portal-smm`)
**Date:** 2026-05-27
**Build:** `next build` passes clean.
**Airtable changes:** 2 new tables + 1 new field (additive only).

## What shipped

The "Coming in Batch 2" placeholder in the AI Content → Warm-Up tab is now a real, working surface. Operator can:

1. **Add a new AI account** ("+ New Account" button) — instantiates the 27-task playbook in one click.
2. **See today's tasks across all active accounts** — one card per account, checkbox per task. Auto-blocks tasks whose prerequisite isn't Done or whose owner approval isn't granted.
3. **Drill into a per-account view** — full task schedule grouped by phase (Setup / Build / Build-Steady / Steady / Live), expandable rows with description + notes textarea, status controls (Done / Skip / Reopen), per-task owner-approval grant button.
4. **Manage account state** — Mark Account Created (Setup → Warming Up, stamps Day-1 start), Pause, Resume, Retire.
5. **Edit profile fields** — Pixel Device, FB Profile Slot, Beacons URL, vault item IDs (IG / FB / Gmail / Recovery Codes — IDs only, not secrets), Persona Notes.
6. **See accurate warm-up count** in the Marketing Content hub's "Active warm-ups" tile.

## Airtable schema (additive only)

1. **New table: `AI Account Profile`** (`tbloVP7ocqHpeK9mo`)
   - One row per AI persona. Holds warmup state, hardware slot, vault refs, link to Publer Accounts.
   - 15 fields including: Persona Name, Persona Handle, Real Creator (→ Palm Creators, single-link-preferred), Warmup Status (`Setup`/`Warming Up`/`Live`/`Paused`/`Retired`), Warmup Start Date, Days Paused, Beacons URL, FB Profile Slot, Pixel Device, IG/FB/Gmail/Recovery Vault Item IDs, Persona Notes, Linked Publer Accounts.

2. **New table: `Warmup Tasks`** (`tblbj1dYPbS2o58sM`)
   - One row per (Account, playbook task). 27 rows are instantiated per account on creation.
   - 16 fields including: Task Title, Account (→ AI Account Profile), Day, Phase, Task Key, Description, Required, Status (`Pending`/`Done`/`Skipped`/`Blocked`/`Awaiting Approval`), Requires Owner Approval, Owner Approved, Owner Approved At, Prerequisite Task Key, Completed By, Completed At, Notes, Template Version.

3. **New field on existing `Publer Accounts` table:** `Warmup Telegram Topic ID` (single-line text) — forum topic ID for warmup-phase manual posts to Amin. Critical for the Batch 4 routing fix.

4. **Auto-created inverse field on `Publer Accounts`:** "AI Account Profile" link (Airtable auto-created when I added the link from AI Account Profile → Publer Accounts).

No existing fields renamed, no schema deletes, no data migrations. If you delete the new tables in Airtable UI, the new code paths silently return zero results (no errors); existing code is untouched.

## 90-day playbook (in code, versioned)

`lib/warmupPlaybook.js` (`PLAYBOOK_VERSION = 1`). 27 tasks across:

- **Setup (Day 0):** 4 tasks — vault storage, Pixel slot, SIM, Gmail aging
- **Build (Days 1-21):** 17 tasks — IG creation, bio, profile pic, engagement quotas, link-in-bio (Day 10), first content (Day 8), FB compound (Day 21 = 5 sub-steps with prerequisite chaining)
- **Build-Steady (Days 22-29):** 3 tasks — cadence reduction, Publer authorization (Day 23, prereq-chained to Day-21 step 5), Publer mapping (Day 23, prereq-chained to Publer auth)
- **Steady (Days 30-89):** 5 tasks — Day 30 cadence transition + health check, Day 45 OF CTA (owner-approval gated + prereq-chained add-CTA action), Day 60 monetization + health check
- **Live (Day 90):** 1 task — graduate to Live

**High-risk gates:**
- **Day-21 FB compound** = 5 chained sub-steps. Step N can't be marked Done until Step N-1 is Done. API enforces (returns `PREREQUISITE_NOT_DONE` 409), UI enforces (mark-done button shows "blocked" state).
- **Day-45 OF CTA flip** = `Requires Owner Approval` checkbox set. API rejects "Done" with 409 `OWNER_APPROVAL_REQUIRED` unless `Owner Approved` is true. The "Grant Owner Approval" button is admin-only (checks `requireAdmin`).

## API routes added

| Path | Method | Purpose |
|---|---|---|
| `/api/admin/smm/warmup/accounts` | GET | List all AI Account Profiles. admin + social_media. |
| `/api/admin/smm/warmup/accounts` | POST | Create new profile + instantiate 27 tasks. admin only. |
| `/api/admin/smm/warmup/accounts/[id]` | GET | Per-account: profile + all tasks + currentDay. admin + social_media. |
| `/api/admin/smm/warmup/accounts/[id]` | PATCH | Update profile fields, mark account created, pause/resume/retire. admin only. |
| `/api/admin/smm/warmup/today` | GET | Today's tasks across active accounts (Setup + Warming Up). admin + social_media. |
| `/api/admin/smm/warmup/tasks/[id]` | PATCH | Status transitions, owner approval, notes. Done is gated on prereq + approval. admin + social_media (approval restricted to admin). |
| `/api/admin/marketing-content/overview` | GET (updated) | Now returns real `activeWarmups` count. |

## Files added/modified

```
+ lib/warmupPlaybook.js                                        (NEW — 27-task playbook + helpers)
+ app/api/admin/smm/warmup/accounts/route.js                   (NEW)
+ app/api/admin/smm/warmup/accounts/[id]/route.js              (NEW)
+ app/api/admin/smm/warmup/today/route.js                      (NEW)
+ app/api/admin/smm/warmup/tasks/[id]/route.js                 (NEW)
+ app/admin/recreate-source/_warmup/TodayView.js               (NEW)
+ app/admin/recreate-source/_warmup/AccountView.js             (NEW)
+ app/admin/recreate-source/_warmup/NewAccountForm.js          (NEW)
M app/admin/recreate-source/WarmupTab.js                       (was placeholder → now view dispatcher)
M app/api/admin/marketing-content/overview/route.js            (wire real activeWarmups count)
+ docs/build-plans/smm-consolidation/batch-2-handoff.md        (this file)
```

## Deviations from the batch doc

1. **Smaller schema than master-plan called for.** The master plan listed `Warmup Playbook Templates`, `Warmup Incidents`, `Hashtag Denylist`, `Pixel Devices`, `SIM Inventory` as Batch 2 tables. I shipped only `AI Account Profile` + `Warmup Tasks`. Rationale: the playbook lives in code (`lib/warmupPlaybook.js`), which is simpler than an editable table for v1 and gets you usable warmup tracking faster. Incidents/Denylist/Pixel/SIM are deferred to a polish pass — they're operational tracking tables, not blockers for the day-counter UI.
2. **Versioned playbook is partial.** Each task row carries `Template Version`, but the "patch in-flight accounts to new template version" admin action isn't built yet. Defer to polish.
3. **Vault item IDs are stored as text on the profile**, not via a Vault references table. Matches the synthesizer's "store the item ID, surface a Copy Vault Link button" pattern — but the Copy Link button isn't built yet (deferred until you pick 1Password vs Bitwarden as the base URL).

## Test plan — verify in your browser

Restart-free — Next.js dev mode picked up the new routes hot. Open http://localhost:3001 and:

1. **Marketing Content hub** — the "Active warm-ups" tile now reads live (will show 0 until you create one).
2. **AI Content → Warm-Up tab** — click. See "No active warm-up accounts yet." + "+ New Account" button.
3. **Click + New Account** — form opens. Fill in Persona Name = "Brielle", Persona Handle = "briel.ai", pick Amelia from the Real Creator dropdown (if she's in Palm Creators), maybe leave hardware fields blank for now. Click Create Account.
4. **Lands on per-account view** — see 27 tasks grouped by phase (Setup 4, Build 17, Build-Steady 3, Steady 5, Live 1). Warmup Status = Setup, no Day counter yet.
5. **Expand any task** — click the title row. See description + notes textarea + Skip button.
6. **Click "Mark Account Created"** — Warmup Status → "Warming Up". Page reloads with current day = 0 (today).
7. **Back to Today** — see Brielle's card with Day-0 + Day-1 tasks visible (Day-0 tasks immediately due).
8. **Try to complete Day-21 Step 2** — it should refuse and tell you Step 1 isn't Done yet.
9. **Try to complete Day-45 "Add OF CTA"** — it should refuse and say owner approval required.
10. **Open Day-45 approval task** — click "⚠ Grant Owner Approval" button. Now the "Add OF CTA" task unblocks.

If anything's broken, point at it.

## Rollback

```
# remove the worktree + branch
cd /Users/jevanleith/palm-creator-portal
git worktree remove ../palm-creator-portal-smm
git branch -D smm-consolidation
git push origin :smm-consolidation

# remove the new Airtable tables in the UI (60 seconds)
#  - AI Account Profile
#  - Warmup Tasks
# and remove the new field on Publer Accounts:
#  - Warmup Telegram Topic ID
# (the auto-created inverse "AI Account Profile" field on Publer Accounts
#  goes away when you delete the AI Account Profile table)
```

`dev` and `main` untouched.

## What's next

Continuing into Batch 3 (Content Strategy + Post Prep automation + Carousel auto-grouping) per the user's "see it all fleshed out" directive. Will commit per-batch + write handoff per-batch as I go.
