# Social Media Hub — Redesign Spec & Build Plan (2026-05-29)

**Status:** plan locked, ready to build. Branch `smm-hub-redesign` (checkpoint `d50ac619`).
**Owner:** Evan. **Single source of truth for this redesign — update this file, don't proliferate docs.**
**Supersedes:** the 2026-05-27 "no single parent" nav decision (see `CONTEXT-OVERVIEW-2026-05-28.md` → "Two competing nav visions"). The single `/admin/social` hub is the chosen direction, endorsed by Evan 2026-05-29 ("I like into one section, that makes things a lot easier").

---

## North star (durable)
Many content sources → one automated post-prep-and-schedule funnel. This feature *becomes* the social media manager. **Real and AI content NEVER mix** (AI-ness lives on the Publer account). Two axes drive the entire IA: **Real vs AI** and **Reel vs Carousel vs Photo**. Drafts-first; validate on Amelia (Briel) → Katie Rosie.

---

## Cross-cutting PRINCIPLES (apply to every section, every pass)

1. **Never break existing functionality.** Every current surface is wanted EXCEPT the explicit changes below. When "removing" something (e.g. the Long Form tab), preserve its underlying capability by folding it elsewhere — don't delete the function, just declutter the navigation.
2. **One design language — no per-page reinvention.** All sections must look and feel like the same product: shared container width, spacing, headers, cards, buttons, filter bars, empty states, toasts, pagination. Build/extract **shared primitives** and reuse them everywhere. Moving between tabs should feel seamless, not like landing on a different app.
   - **NO cheap-looking emoji icons** anywhere in the hub (Evan, hard preference). Differentiate with clean typography, weight, and color; use a minimal inline SVG only where an icon genuinely adds clarity. Strip existing emoji icons (nav chips, section headers like "📸"/"✨", toggles) from any surface as it's reworked.
3. **Think like Evan — proactively add what helps.** This is a high-volume content tool. For every surface ask: *what would Evan want here?* Bias toward:
   - **Filterability:** by creator, by content type (reel/carousel/photo), by Real/AI, by status, by date.
   - **Sorting:** newest/oldest, by creator, by status.
   - **Navigation ease:** fast tab/section movement, deep-linkable URL state (`?tab=&sub=`), remembered selections.
   - **Density control:** expand/collapse sections, full-row grids, sensible pagination/load-more.
   - **At-a-glance clarity:** counts/badges, obvious current-selection indicators.
4. **Real/AI must be unmistakable.** Wherever the Real/AI toggle appears, the active state AND the selected creator must be impossible to misread. "Perfect UX" is the bar. Show every such surface on `:3000` for Evan before considering it done.
5. **Two-pass build.** Pass 1 = the structural redesign below. Pass 2 = a holistic self-review of the *whole* hub: how could each section be better, what affordances are missing, how do sections interact, what's inconsistent. Pass 2 findings get logged here and built.

---

## Locked macro-structure
Hub = `/admin/social`. Top-level sections:

1. **Overview** — at-a-glance, two lenses: (a) whole-team / editor workload & throughput ("what the editors have done"), (b) drill into one creator's content + social at a glance. Full-width.
2. **Accounts & Setup** — accounts + credentials (real-posting AND AI-posting), Setup, **Strategy**, Warm-Up.
3. **Content** — creation **and** reviewing, split cleanly across **Real/AI × Reel/Carousel/Photo**. Includes the Creator Library (raw source: video + photo).
4. **Outbound** — prepping + routing to the correct account + scheduling. (Name provisional — Evan unsure "Outbound" is right; candidates: "Scheduling", "Publishing", "Send".)

### Core UX problem — the Real/AI × type matrix (don't stack tabs)
Use a **Real/AI segmented toggle** + a **creator picker**, both unmistakable, instead of nested stacked tabs. Carousels are BOTH real and AI → they live at the content level, never buried in Outbound.

---

## Per-section detail & change list

### Overview  *(currently `MarketingContentPage` — KPI tiles + quick links only)*
- [ ] Full-width (verify `app/admin/layout.js` isn't imposing a max-width wrapper).
- [ ] Lens A: team/editor workload & throughput (who did what, queue depth, turnaround).
- [ ] Lens B: per-creator at-a-glance drill-in (content pipeline + social status).
- [ ] Keep existing KPI tiles + quick links; integrate, don't replace.

### Content  *(the heart of the redesign)*
- [ ] **Creator Library** promoted to first-class; holds video + photo; raw source pool.
  - [ ] Card: show **date uploaded** under image near filename. *(data exists: `asset.createdTime` / `asset.uploadWeek`.)*
  - [ ] **Full-row grid:** compute columns from container width, load a multiple so every row is full (~6–7 full rows). *(today `repeat(auto-fill,minmax(180px,1fr))` + page size 15 → ragged last row.)*
  - [ ] Hide **"✨ Suggest on-screen text"** on **photo** cards (it generates *video* on-screen-text — nonsensical on a still). Keep on video cards.
  - [ ] Filters: creator, type (video/photo), status (see D2), sort.
- [ ] **Review split into four distinct sections: Real Carousel · AI Carousel · Real Reels · AI Reels.** *(data supports: `task.asset.sourceType === 'AI Generated'` flags AI; carousel-vs-reel is component-level.)* Replaces the stacked `CarouselSubmissionsReview` → `ForReview` layout. Drive with the Real/AI toggle + a Reel/Carousel selector.
- [ ] **Submissions** feed (real-creator edits) lives here too; keep Initial/Revision + creator filters.

### Accounts & Setup
- [ ] **Accounts** area: real-posting + AI-posting accounts in one place, clearly separated by type. **Credentials = Bitwarden vault links/IDs only, NEVER plaintext** (warmup playbook rule). Show persona/account metadata + copy/deep-link to vault item.
- [ ] **Setup** tab: widen body (currently `maxWidth:1200` centered) to match hub width.
- [ ] **Strategy:** the Content Strategy Engine (placeholder today, 760px). Pillar taxonomy + DNA-as-thumb-on-scale (see SMM memory). Separate track — can ship after the IA.
- [ ] **Warm-Up:** keep as-is.

### Outbound
- [ ] **Post Prep**, **Grid Planner** (UX "basically correct" — don't redesign), **Publer** (not wired yet — placeholder + link).
- [ ] Organize as review → route-to-account → schedule, not a stack.

### Cross-cutting build
- [ ] **Equal full-width body across ALL sections.** Normalize Setup (1200 centered) + Strategy (760) → full-width to match Overview/Workflow/Warm-Up. Extract a shared `<HubSection>` container so width/padding is defined once.
- [ ] Extract shared primitives: `HubSection`, `FilterBar`, `CreatorPicker`, `RealAiToggle`, `ContentCard`, `Paginator`, `EmptyState`. Reuse across all sections (Principle 2).

---

## Decisions (resolved unless marked CONFIRM)

| # | Decision | Resolution |
|---|----------|-----------|
| D1 | Long Form tab | **Remove the standalone tab, PRESERVE the upload capability** by folding `LongFormUpload` into the OFTV/long-form area as a sub-action. (Finding: OFTV workflow does NOT include long-form upload, so a plain delete would lose it.) |
| D2 | Library status filter (Unused / In editing / Used / Posted) | **Phase it.** Ship Unused vs In-editing now (In-editing = an editor task exists for the asset). Defer Used/Posted pending additive Airtable tracking fields. **CONFIRM** the phased approach. |
| D3 | Submissions Real/AI filter | Submissions are always real-creator edits; AI flows through the review path, not submissions. The Real/AI split belongs in the **Content review** sections (above), not the submissions feed. **CONFIRM** this matches intent. |
| D4 | Account passwords | **Vault links/IDs only, never plaintext** (security rule). Resolved. |

---

## Execution mode: AUTONOMOUS (2026-05-29)
Evan opted to run ALL phases autonomously (no mid-build review checkpoints), followed by a multi-agent review pass that checks the work and proposes improvements. Build every phase in order, commit after each, then run the review. List anything not visually verifiable for Evan to eyeball on return.

### Autonomous run prompt (for resuming in a fresh session / as a goal)
```
Continue the Social Media Hub redesign on branch smm-hub-redesign. Source of
truth: docs/build-plans/smm-consolidation/HUB-REDESIGN-SPEC.md and the plan at
~/.claude/plans/foamy-meandering-elephant.md. Phases 0,1,1b are committed.
Build ALL remaining phases (2->7) in order, AUTONOMOUSLY (no pausing for
review). Commit after each phase. Honor the PRINCIPLES (never break existing
functionality; one design language via app/admin/social/_components primitives;
real/AI never mix; Real/AI toggle unmistakable). Decisions are locked (D1-D4 +
real-carousel wired in + Workflow in Content). Keep the dev server on :3000
healthy (stale .next 500 -> kill, rm -rf .next, restart). When all phases are
done, run a final `next build`, fix any compile errors, then launch 2-3 review
agents to audit the whole hub for correctness, broken functionality,
consistency, and improvements; log findings into "Pass 2 findings" and fix the
high-confidence ones. Do NOT push to any remote.
```

## Phased build order
Each phase ends with a compile/sanity check. Preserve functionality throughout.

- **Phase 0 — Foundations:** extract shared primitives (`HubSection`, `FilterBar`, `CreatorPicker`, `RealAiToggle`, `ContentCard`, `Paginator`, `EmptyState`); normalize all sections to equal full-width. *(enables consistency for everything after)*
- **Phase 1 — Creator Library:** date-on-card, hide AI-suggest on photos, full-row grid, filters (creator/type/status-phase1/sort).
- **Phase 2 — Content review 4-way split:** Real/AI toggle + Reel/Carousel selector over Real Carousel / AI Carousel / Real Reels / AI Reels; fold submissions feed in.
- **Phase 3 — Section restructure:** reorganize hub into Overview / Accounts & Setup / Content / Outbound; re-home Carousels to content level; fold Long Form into OFTV (D1).
- **Phase 4 — Accounts area:** real + AI accounts, vault-linked (D4).
- **Phase 5 — Overview dual-lens:** team workload + per-creator at-a-glance.
- **Phase 6 — Outbound tidy:** review→route→schedule organization; Publer placeholder.
- **Phase 7 — Strategy engine:** Content Strategy Engine (separate, larger track; can run independently).
- **Pass 2 — Holistic UX review:** walk every section as Evan; log improvements (filters, expand/collapse, interactions, consistency gaps) into this file's "Pass 2 findings" section, then build them.

## Pass 2 findings
*(populated during the holistic review pass)*
