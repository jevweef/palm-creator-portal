# Palm Creator Portal — house rules for Claude sessions

Read this first. The most important rules here are about **not losing work when
more than one Claude session is open at the same time.**

## 🪑 One builder per desk (avoid the shared-tree mixup)

This repo is often worked on by **several Claude sessions at once**. They share
one working directory by default, and when one session switches git branches it
can stash/clear the shared tree — which makes another session's *uncommitted*
work look like it vanished. (It's recoverable, but it's scary and wastes time.)

**Rule:** If it's plausible another Claude session is active in this repo at the
same time as you, **work in your own git worktree**, not the shared main
checkout. One session per working directory.

- Preferred: use the **EnterWorktree** tool to get an isolated worktree+branch.
- Or manually: `git worktree add ../pcp-<feature> -b <feature>` and work there.
- Existing parallel worktrees live under `.claude/worktrees/`.
- Exception: a background job may be explicitly configured to "work in place."
  Honor that, **but commit early and often** (see below) so nothing is at risk.

## 🗄️ Commit early and often (the real safety net)

Branch switches and tree-clears only ever endanger **uncommitted** work. Saved
(committed) work cannot be lost this way.

**Rule:** Don't accumulate large uncommitted changes. Commit each coherent
chunk as you go. If you're about to hand off, pause, or the user steps away,
commit first. When working in the shared tree alongside other sessions, treat
"commit often" as mandatory, not optional.

- Branch policy: never push to `origin/main`. Feature work targets `dev` (or a
  feature branch off it) unless the user says otherwise.
- When committing in a shared tree, stage **only your own files** (explicit
  paths), never `git add -A` — other sessions' uncommitted WIP may be present.

## ✅ Safe order when you must change branches in a shared tree

1. Commit (or stash) **your** in-progress work first.
2. Then switch branches / pull / merge.
3. Verify your files are intact afterward.

## End-of-commit message convention

End git commit messages with:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
