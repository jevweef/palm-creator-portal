# Custom Edit projects on the AI Editor Projects tab

## Problem

When an editor uses `✨ New Project → Direct Upload` (Custom Edit), `/api/ai-editor/upload` runs with `slug: null`. It creates an Asset + Task but **no Stage B Output record**. The Projects tab data source (`/api/admin/recreate-rooms/stage-b/outputs`) only returns Stage B Outputs, so Custom Edit submissions become invisible to the editor after Submit. They only resurface when admin rejects them (via the existing Revisions section).

## Already in place — do not redo

- `adminReviewStatus` per scene in the outputs API response (slug-keyed Task lookup)
- `uploadedThumbnail` per scene (Cloudflare Images CDN URL from linked Asset)
- `sceneStep(s)` derivation + per-group `editorState` ('in-progress' | 'completed')
- In Progress / Completed filter chips
- Thumbnail carousel with parallel preload
- Revisions section reads from `/api/ai-editor/revisions`, works for both workflows
- Cloudflare Stream mirror on every upload via `triggerAssetMirror`
- `/api/ai-editor/upload/route.js` is correct as-is — don't touch the finalize endpoint

## Implementation

### 1. API extension (`outputs/route.js`)

After existing Stage B Outputs fetch, add a batched fetch of Tasks:
- Filter: `Source Type='AI Generated'` AND `Creator` linked to requested creator AND `Asset` set
- Exclude Tasks whose Name (e.g. `AI Review: Aka_R042_S01`) matches an existing Stage B Output Slug — those are already represented as Bedroom scenes
- For each remaining orphan Task, build a synthetic scene record shaped like a Stage B Output scene:
  - `id`: Task ID
  - `source`: `'custom-edit'` (new field to differentiate)
  - `status`: derive from `Admin Review Status` — `Pending Review` → `Approved` (so existing `sceneStep` logic treats as awaiting-admin via `uploadedAt`); `Approved` → `Approved`; `Needs Revision` → `Rejected`
  - `uploadedAt`: Task `Completed At` (always set since these are uploaded)
  - `adminReviewStatus`: Task `Admin Review Status`
  - `image` / `uploadedThumbnail`: linked Asset's `CDN URL`
  - `slug`: parsed from Task `Name` (`AI Review: <slug>`)
  - `reel`: joined from Asset's `Reference Source URL` — find matching Recreate Reel by URL; if none, fabricate `{ url, handle: parsed from URL }` so card still renders
  - `dropbox`: linked Asset's `Dropbox Shared Link` (for the download button)
- Merge into the `outputs` array in the response. Frontend grouping by `reel.id` will naturally fold Bedroom + Custom under the same card when they share a source reel.

### 2. Frontend: workflow badge + step logic (`page.js`)

- Update `sceneStep(s)` — branch on `s.source === 'custom-edit'`:
  - No Started / Generating / Pending / Failed paths
  - `uploadedAt + adminReviewStatus === 'Approved'` → `complete`
  - `uploadedAt + adminReviewStatus === 'Rejected'` → `admin-rejected`
  - Otherwise → `awaiting-admin`
- Workflow-type badge on each card + inside carousel slide indicator:
  - Bedroom (teal pill: "Bedroom")
  - Custom Edit (purple pill: "Custom Edit")
  - Mixed group → both badges
- `Discard reel` button:
  - Bedroom-only or mixed cards: keep existing behavior, but only delete Stage B Outputs (skip Custom variations)
  - Custom-only cards: hide the button (admin owns Tasks; editors shouldn't delete them from this surface)

### 3. CTA + per-variation status on Custom Edit cards

- Custom-only cards: replace "Open workflow" CTA with **"View"** (or no CTA — card display is enough). No StageBPanel navigation since there's no Bedroom Scene to load.
- Mixed cards: keep the existing "Open workflow" CTA so the Bedroom side stays reachable.
- Each carousel slide displays its individual step inline (e.g. `✓ Approved` / `Awaiting admin` / `Rejected`) so editors see per-variation status without expanding anything.

## Field reference

Tasks table (Source Type='AI Generated' is the marker for editor-submitted videos):
- `Name`: `AI Review: <slug>` or `AI Review: @<handle> <reelId>`
- `Status`: `Done` (set on upload finalize)
- `Admin Review Status`: `Pending Review` | `Approved` | `Needs Revision`
- `Admin Feedback`, `Admin Screenshots`: present when Needs Revision
- `Asset`: linked record (one Asset per Task)
- `Creator`: linked Palm Creator record
- `Completed At`: ISO timestamp at upload time

Asset table:
- `CDN URL`: Cloudflare Images thumbnail URL (preferred for display)
- `Dropbox Shared Link`: raw Dropbox link (for download buttons)
- `Reference Source URL`: the original Instagram reel URL (used to join back to Recreate Reel)
- `Source Type`: `AI Generated` (filter marker)

## Constraints

- Localhost only. Don't push to dev. User says when.
- Don't break the existing Bedroom flow — the merge into one Projects list must be additive.
- Don't change `/api/ai-editor/upload/route.js`. Tasks/Assets are created correctly there.
- Cloudflare Stream poster URLs already work for both workflows — verify but don't change.

## Acceptance

- An editor with: (a) one in-progress Bedroom project with 3 variations + (b) one Custom Edit submission of 4 videos for a DIFFERENT reel + (c) one Custom Edit submission of 2 videos for the SAME reel as (a) — sees 2 cards on the Projects tab. Card (a) shows mixed Bedroom + Custom variations in the carousel. Card (b) shows only Custom Edit variations.
- In Progress vs Completed buckets correctly include Custom Edit projects (Completed only when all variations admin-approved).
- Card sub-label uses the same action-oriented copy ("Submitted — awaiting admin" / "Done ✓" / "Rejected — see Revisions") for both workflows.
- Carousel cycles through source reel + every variation (Bedroom + Custom merged) with per-variation status visible.
- Rejected Custom Edit submissions still appear in the existing Revisions section at the top of the Projects tab.
- Cloudflare Stream poster shows for variation thumbnails (not raw Dropbox); download buttons still pull raw Dropbox.
