# Onboarding Automation Offload Tracker

**Goal:** every step of the creator-onboarding workflow runs from portal code we
control (Next.js routes + `lib/creatorSetup.js`), with **zero** Make.com
scenarios or Airtable automations firing for onboarding.

**Status legend:** ✅ offloaded to code · 🟡 overlap (code + external both armed → risk) ·
⛔ still external only · ❓ needs your eyes (API can't see it)

_Last updated: 2026-05-31. Evidence: codebase audit + "Palm Mgmt System To-dos"
registry (HQ base, tbl9PNw5q1TTOrToG)._

---

## Definition of done (how we KNOW it's fully offloaded)

Onboarding is fully offloaded when **all** of these hold for a brand-new test creator:

1. Clicking **Run Setup** in the onboarding drawer produces the complete correct
   end state: default accounts, credentials, Dropbox folder tree (matching the
   canonical template), Social + Long Form file requests, SM Setup Request row,
   and all status fields stamped.
2. During and after that run, **Make.com execution history shows 0 runs** for any
   onboarding scenario, and **Airtable automation run history shows 0 runs** on
   the HQ Onboarding / HQ Creators tables.
3. Re-running Run Setup creates **no duplicates** (idempotency holds).
4. No code path writes a field whose only purpose was to trigger an external
   automation.

When 1–4 pass on a test creator, onboarding is code-owned. ✅

---

## A. Onboarding automations — inventory & status

| # | Automation (source) | What it does | Replacement in code | Status |
|---|---|---|---|---|
| 1 | **"Create Default Accounts"** (Make scenario) | Webhook (HQ Creator Record ID + AKA) → create default social accounts; stamp `Defaults Created At`; error-handler row | `createDefaultSocialAccounts()` in `lib/creatorSetup.js` (now idempotent) | 🟡 code does it, **but Make scenario may still be armed** via trigger field |
| 2 | **"Provision Dropbox Folders for Creator"** (Make scenario, registry = Complete) | **Copy Dropbox template folder → `/Creators/{AKA}/`**; create `01_Incoming` file request; write File Request URL back to HQ | `createCreatorFolders()` + `createCreatorFileRequests()` | 🟡 **code now does a template copy when `DROPBOX_CREATOR_TEMPLATE_PATH` is set** (falls back to hand-rolled tree when unset — zero behavior change until configured). Pending: the template path + confirming its subfolders match `buildFolderPaths()`. Make may still be armed |
| 3 | Trigger field writes (`Trigger Social Accounts Records`, `Create Dropbox Folders`) | Single-selects on HQ Onboarding that Make/Airtable automations watch | `runFullCreatorSetup()` still **writes** these (`creatorSetup.js` ~line 345-346) | ⛔ **liability** — remove the writes once #1/#2 Make scenarios are off |
| 4 | `'Create Defaults'` button/trigger on HQ Creators (registry: Pending — never finished) | Was meant to kick off provisioning | Drawer **Run Setup** button → `POST /run-setup` | ✅ superseded by UI |
| 5 | Auto-trigger provisioning after "Defaults Created" (registry: Pending) | Chain accounts→folders automatically | `runFullCreatorSetup()` orchestrates both in sequence | ✅ superseded by orchestration |
| 6 | SM Setup Request creation (was Make → moved to Ops) | Row for SMM to set up Palm IG 1/2/3 | `createSmSetupRequest()` | 🟡 code does it, but uses the **broken linked-record filter** (see note) — verify idempotency |
| 7 | Standard platform set: registry says "IG x3, TikTok, X, YT, OFTV" | Which default accounts to create | Code creates **TikTok, YouTube, OFTV (+ IG Main if handle given)**; Palm IG x3 → SM Setup Request; **does NOT create X/Twitter** | ❓ confirm intended set — divergence from registry |

### Airtable automations (API cannot read these — needs your eyes)
Likely candidates, all ❓ until confirmed from each base's **Automations** panel:
- Any automation on **HQ Onboarding** watching `Trigger Social Accounts Records` or `Create Dropbox Folders`.
- Any automation on **HQ Creators** watching a `Create Defaults` field.
- "Scheduled Invoice Creation for Creators" + "Snapshot Commission %" → **already replaced** by `app/api/cron/generate-invoices` (Vercel cron). Confirm the Airtable versions are OFF.

### Still-active app webhooks (downstream, not onboarding — left as-is)
- `app/api/admin/mirror-asset` — receives Airtable/Make calls to mirror assets to Cloudflare.
- `app/api/inbox/telegram` — Telegram heartbeat ingestion.
- `app/api/webhooks/clerk` — Clerk user lifecycle.

---

## B. Decommission sequence (safe order)

1. **See the truth.** Enumerate live Make scenarios (connect Make connector or paste list) + list Airtable automations on HQ Onboarding/Creators.
2. **Match the template.** ~~switch `createCreatorFolders()` to a single `copy_v2`~~ — **DONE in code** (`copyDropboxFolder()` in `lib/dropbox.js`; `createCreatorFolders()` copies the template when `DROPBOX_CREATOR_TEMPLATE_PATH` is set, else hand-rolled tree). Remaining: set `DROPBOX_CREATOR_TEMPLATE_PATH` env var in Vercel (+ `.env.local`) to the canonical template path, and confirm the template contains `Social Media/00_INCOMING_FILE_REQUEST` + `Long Form/10_UNREVIEWED_LIBRARY` so file-request destinations line up. [resolves onboarding gap Q6]
3. **Turn OFF** Make "Create Default Accounts" + "Provision Dropbox Folders for Creator", and any Airtable automation watching the trigger fields.
4. **Remove the trigger-field writes** (`creatorSetup.js` ~line 345-346) — they're dead weight once #3 is done.
5. **Verify** against the Definition of Done on a fresh test creator.

---

## C. Open inputs needed from Evan
- [ ] **Make.com connector auth** — run `/mcp` in Claude Code and authorize "claude.ai Make" (the connector tool can't complete OAuth headlessly). Then I can enumerate every scenario + on/off + webhook triggers.
- [ ] Airtable automations list on HQ Onboarding + HQ Creators (Automations panel — the API can't read these).
- [ ] Canonical Dropbox **template folder path** + its full subfolder structure → set as `DROPBOX_CREATOR_TEMPLATE_PATH`. (Code path is built and waiting; see A#2 / B#2.)
- [ ] Confirm default platform set (is X/Twitter supposed to be auto-created? current code: TikTok/YouTube/OFTV + IG Main-if-handle; Palm IG ×3 → SM Setup Request).

## D. Out of onboarding scope (separate offload, Make-heavy — track elsewhere)
Daily Dropbox Ingestion, Duplicate Ready File / platform routing, Historical
Content Backfill, Ops sync tables. These are the content-pipeline automations,
not onboarding — flagged so we don't conflate "onboarding done" with "everything done."
