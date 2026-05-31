# Design Loop Spec — For Review tab

**Surface:** `/admin/social?tab=content&sub=review` (Social Media Hub → Content → For Review).
**Goal:** improve UI/UX of the existing review queue WITHOUT breaking functionality. This is an internal daily-use admin tool, not a showcase — usability and zero-regression beat novelty.

## Code (ground every change here)
- `app/admin/editor/page.js` → `ForReview` (~L1986): the review grid (hardcoded `repeat(4, 1fr)`), per-card video strip (real: RAW/EDIT/INSPO; AI: ORIGINAL/OUTPUT), Request Revision / Approve buttons, pagination (REVIEW_PAGE_SIZE=10), controlled `creatorId`/`onCreatorOptions` props.
- `app/admin/social/_components/ContentReview.js` → wrapper: RealAiToggle + Reels/Carousels Segmented + lifted CreatorPicker + state line.
- Reuse primitives in `app/admin/social/_components/` (HubSection, RealAiToggle, FilterBar/Segmented, EmptyState). Don't reinvent.

## Targeted improvements
1. **Responsive grid** — replace hardcoded 4 columns with the `ResizeObserver` column logic already used by `UnreviewedLibrary` in the same file (~L1003). Cards must not be crushed on narrow viewports.
2. **Remove emoji** — "Approve ✓" and any other emoji → clean type/color/SVG (HOUSE RULE).
3. **Density / scannability** — reduce card heaviness; consider details-on-expand so more review decisions fit per screen.
4. **Dead quadrant** — Real + Carousels is permanently empty; disable/hide that combo until real-carousel review exists (in ContentReview).
5. **Consistency** — card bg `rgba(255,255,255,0.02)` + 10px radius; real=`var(--palm-pink)`, AI=`#a78bfa`.

## Hard constraints (must not regress)
- Approve + Request-Revision flows work exactly as before.
- Pagination works.
- `ForReview` is ALSO used standalone at `/admin/editor` — new behavior must be backward-compatible (uncontrolled mode unchanged).
- Real and AI content never shown together.
- Branch `smm-hub-redesign`; do NOT push to any remote.

## Rendering / scoring
Render headlessly via the existing logged-in pipeline (do NOT set up new auth):
`node /Users/jevanleith/.claude-pw-tools/pw-shot.mjs "http://localhost:3000/admin/social?tab=content&sub=review" "screenshots/<name>.png" 6000`
Baseline: `screenshots/BEFORE-review.png`.
