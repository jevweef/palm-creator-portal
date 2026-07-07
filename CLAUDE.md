# Palm Creator Portal — Claude rule book

This repo is the **Next.js web app** (`app.palm-mgmt.com`): Clerk auth (admin /
creator / editor / chat_manager / social_media roles), Airtable + Dropbox, Vercel.

The Python **inspo-pipeline** lives in `pipeline/` and has its own detailed rule
book at `pipeline/CLAUDE.md` — read that one when working inside `pipeline/`.

---

## 🚨 CRITICAL — Account separation (read first)
**NEVER put any Palm Management content on the `flylisted` GitHub account or any
flylisted-associated infrastructure.** Evan runs two separate businesses and
`flylisted` must have zero knowledge of or connection to Palm Management.
- Palm Management GitHub: use `jevweef` — NEVER `flylisted`.
- Palm Management Vercel: team `evan-5378's projects` (hosts `palm-creator-portal`, `palm-website`, `palm-website-v2`).
- Commit email: `evan@palm-mgmt.com`.
- Before ANY `gh repo create`, `git remote add`, or `vercel` command, run
  `gh auth status` and confirm it is NOT `flylisted`. If unsure, STOP and ask.

## 🚨 CRITICAL — React Hooks placement
All `useState` / `useMemo` / `useEffect` hooks MUST be placed BEFORE any
conditional `return`. Hooks after `if (loading) return ...` cause React error
#310 (different hook count between renders) — this has crashed the entire admin
section twice. Always: hooks first, early returns after.

## 🚨 CRITICAL — Airtable REST API, linked records
- **Writing** `multipleRecordLinks`: use plain string arrays — `["recXXX"]`,
  NOT `[{"id":"recXXX"}]` (the object form 422s via REST; it's SDK-only).
- **Matching/filtering** a link by record ID: you CANNOT use
  `FIND("recXXX", ARRAYJOIN({Link}))` — a formula sees the link as its primary
  *display value*, not the ID, so it never matches and silently creates
  duplicates. Narrow by a text field, then JS-match the link array (the REST API
  returns links as arrays of ID strings). See `lib/onboarding/checklist.js` and
  the `reference-airtable-linked-record-filter` memory.

## 🚨 CRITICAL — Design API routes timeout-first (Vercel guillotine)
Four features 504'd in one day (2026-07-07) because routes assumed they could
run to completion. Every route that fans out over the network (OF API
pagination, PDF + Dropbox + Telegram chains, LLM calls, full Airtable scans)
MUST be built assuming Vercel kills it:
1. **Unbounded work → chunk protocol**: cursor in/out, client loops, each
   request bounded (see pull-chat's shard protocol — chunks write small shard
   files, one finalize merges; NEVER read-modify-write a growing blob per chunk).
2. **Time-box internal loops** with a `deadline` param (~45-60s) and return
   partial progress — a deadline stop is `morePages`, not an error.
3. **`export const maxDuration = 300`** on anything doing >2 network calls.
4. **Clients never blind `res.json()`** — parse text; treat 5xx as a retryable
   blip (progress persisted server-side means retry resumes, never restarts).
See `feedback_timeout_first_design` memory for the incident list.

## OnlyFans time conventions (earnings & invoicing)
- Transaction-sheet times (Google Sheets) are **ET**, not UTC.
- OF's daily graph buckets by **UTC** day; the boundary = midnight UTC = **8 PM ET** (EDT).
- To match OF's UI: treat sheet timestamps as ET, end-of-day cutoff = 20:00 ET.
- Invoice periods in Airtable use ET-aligned dates.

---

## 🪑 One builder per desk (avoid the shared-tree mixup)
This repo is often worked on by **several Claude sessions at once**, sharing one
working directory. When one session switches branches/merges, git stashes/clears
the shared tree, making another session's *uncommitted* work appear to vanish
(recoverable, but scary — happened 2026-05-31).

**Rule:** If another Claude session may be active here at the same time, work in
your **own git worktree**, not the shared main checkout. One session per dir.

**At the START of a session, before any work**, isolate yourself:
1. Pick a short, descriptive kebab-case name for the task (`onboarding-checklist`,
   `invoicing-pdf-fix`) — not generic, not random.
2. `git fetch origin`, then create the worktree **based on the latest `dev`**.
   - Preferred: the **EnterWorktree** tool, passing that name explicitly.
   - Or: `git worktree add ../pcp-<name> -b <name> origin/dev`.
3. Work from that worktree for the rest of the session.
- Existing parallel worktrees live under `.claude/worktrees/`.
- Exception: a background job explicitly configured to "work in place" — honor
  that, but commit early and often.

## 🗄️ Commit early and often (the real safety net)
Branch switches only endanger **uncommitted** work; committed work is safe.
- Don't accumulate large uncommitted changes — commit each coherent chunk.
- Feature work targets `dev` (or a branch off it). Don't push to `origin/main`
  on your own — `main` is the LIVE site. Push to `main` only when the user
  explicitly asks (see "Staying current & shipping" below for the creator rule).
- In a shared tree, stage **only your own files** (explicit paths) — never
  `git add -A` — other sessions' WIP may be present.

## ✅ Safe order when changing branches in a shared tree
1. Commit (or stash) **your** in-progress work first.
2. Then switch / pull / merge.
3. Verify your files are intact afterward.

## 🔄 Staying current & shipping (every session, automatic)
Many named sessions run in parallel, each on its own worktree/branch. The shared
trunk everyone syncs through is `origin/dev` (GitHub) — Vercel builds the dev
preview from it. Goal: hop into any session, work, leave, come back always
current, with nothing reaching the website by accident.

**Auto-grab — do this WITHOUT being asked.** At the start of any new task, before
editing, bring this branch up to date with the shared trunk:
- Only when the working tree is **clean** (commit or stash your work first).
- `git fetch origin && git merge origin/dev`
- Safe and silent. NEVER grab mid-edit — it can yank the floor out from a build.

**Ship only on request.** Default to localhost iteration; never push on your own
(see [[feedback_localhost_not_dev]]). When the user says "ship it" / "push it" /
"put it on the website":
- Default target → `dev` (updates the Vercel dev preview, ~1 min build).
- If the change is **creator-facing** (anything on the creator view), ASK whether
  to push to `dev`, `main`, or both — never assume.
- `main` = the LIVE site. Confirm explicitly before any `main` push.
- Commit first (your own files, explicit paths), then push the branch / merge
  into the chosen target.

---

## 🌐 Site Bible — read first, keep current (do this without being asked)
The **Site Bible** is the source of truth for how the app works TODAY. It lives in
`~/.claude/projects/-Users-jevanleith-palm-creator-portal/memory/`: `MEMORY.md` is the
index, and the `reference_site_*` files describe each admin surface (auth/roles, creators,
earnings/invoicing, editor, fan CRM, integrations, onboarding, photo library, inspo,
posts/outbound, publer, research, social hub, warmup).
- **Before changing a surface, READ its `reference_site_*` file** — it captures the current
  behavior, invariants, and gotchas so you don't relearn them the hard way.
- **When you add / change / remove a surface, route, table, or invariant, UPDATE its
  `reference_site_*` file in the SAME session** (don't defer to "later"). New surface → new
  `reference_site_<name>.md` + one index line in `MEMORY.md`. Fix stale entries in place.
- Detail/WHY/decisions/gotchas go in the memory file, NOT in this CLAUDE.md.

## Detailed per-area context
Lives in memory files (admin surfaces, earnings, fan CRM, per-account coverage,
invoicing, onboarding, music selector, editor slots, website). `pipeline/CLAUDE.md`
holds the canonical pointer list. Capture WHY/decisions/gotchas in memory, not here.

## Commit message convention
End commit messages with:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
