# SMM Consolidation — Research Scope

**Started:** 2026-05-27. Owner: evan@palm-mgmt.com.
**Purpose:** Multi-agent research pipeline to produce a master plan + per-batch detailed work docs for a major Social Media Management refactor + new-feature build. NO code changes during research phase. All output is markdown.

## Owner's vision (paraphrased)

- Consolidate scattered SMM pages under one **Social Media Management** parent in the admin sidebar.
- Role-filter that parent so each role (admin / editor / ai_editor / social_media / chat_manager) sees only their slice. Single nav, multiple views.
- **Inspo Board stays top-level** — purposeful, cross-role (admin / editor / creator). Don't tuck it under SMM.
- Rename **"AI Source" → "AI Content"** (sidebar label only, route stays).
- **New: Account Warm-Up section** — per AI account, day-counter against the 90-day playbook. Operator opens it and sees today's tasks (credentials slot, bio step, profile-pic timing, like/comment quota, when to add link-in-bio, today's manual post + caption, when to hook Publer in). Zero mental load.
- **New: Content Strategy Engine** — answers "what's next for [creator] in TJP?" Picks the next carousel/reel from the library, rotates pillars, manages variations. Eliminates the "wait, what carousel should I bring into image-to-image next for Amelia?" question.
- **New: Amin Manual-Post Bridge** — pre-Publer (during warm-up days), Amin (Indian Telegram-based SMM contractor) gets a daily list: "today at 2pm post this to @handle." Same Telegram pipe that already exists, but driven by the warm-up schedule.
- **Long-term: Publer Phase 3** — jitter, caption/hashtag rotation, monitoring dashboard, alerts. Full automation once accounts pass Day 90.

## Three new AI accounts being warmed up now (priority context)

- **Brielle** (briel.ai) — real creator: Amelia
- **Lily** — real creator: Gracie
- **Katie Rosie** — standalone

All three need the warm-up flow operational soon.

## Hard constraints (apply to the master plan)

- **Airtable changes are ADDITIVE ONLY.** No edits, renames, or deletes of existing fields/tables.
- All code work happens on a new branch off `dev` named `smm-consolidation`, never merged to `dev` or `main` without explicit owner approval.
- Every change must be reversible via `git branch -D` (code) and Airtable column-delete (data).
- The current poster Amin must keep working until Publer fully replaces him (gradual transition, not a flag-day cutover).
- Server-side role gating in `lib/adminAuth.js` is the source of truth — sidebar filtering is courtesy/UX, not a security boundary.

## Pipeline structure

```
Phase 1 (parallel, independent):
  Auditor A → audit-A-section-inventory.md
  Auditor B → audit-B-warmup-strategy.md

Phase 2 (parallel, each reads only one audit):
  Critic A reads audit-A → critique-A.md
  Critic B reads audit-B → critique-B.md

Phase 3 (sequential, reads all 4):
  Synthesizer →
    master-plan.md (overall)
    batch-1-nav-consolidation.md
    batch-2-warmup-flow.md
    batch-3-content-strategy.md
    batch-4-amin-bridge.md
    batch-5-publer-phase3.md
    master-goal-prompt.md (paste-ready for goal-setting mode)
```

## Output location

All docs land in `/Users/jevanleith/palm-creator-portal/docs/build-plans/smm-consolidation/`.

## Reading list (every agent must read these)

**Memory files** (`/Users/jevanleith/.claude/projects/-Users-jevanleith-palm-creator-portal/memory/`):
- MEMORY.md
- user_palm_mgmt_context.md
- project_publer_ai_pipeline.md
- project_ai_account_creation.md
- reference_palm_codebase.md
- feedback_communication_style.md

**Build-plan docs** (`/Users/jevanleith/palm-creator-portal/docs/build-plans/`):
- publer-ai-scheduler.md
- publer-ai-scheduler-phase1-2-handoff.md
- publer-ai-account-creation-playbook.md
