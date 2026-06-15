# OFM Research Knowledge Base — Master Plan

> Evolution of the research feature from "one digest per scrape run" into a living,
> cross-corpus **knowledge base** organized by agency department, with consensus-weighted
> confidence, a daily brief, Q&A over the corpus, and selective on-screen (vision) deep-dives.
> Approved 2026-05-30: "make a plan for all of this and do all of it."

## Context / why

First version shipped a good *finding card* (what they do / vs us / recommendation / sources
with thumbnails + jump-to-timestamp + credibility note). Evan's feedback reframed the target:

1. **It should be a knowledge base, not a pile of run-digests.** Navigate **Department →
   sub-topic → findings** (e.g. Instagram Marketing → "account warming" → finding cards).
   Plus a summarized overview and search by department/aspect.
2. **Confidence = consensus.** The more *independent creators* repeat the same claim, the higher
   the confidence; when they contradict each other, mark it low/contested. (Evan: consensus
   SCORE only — don't need the dissent laid out, just the score.)
3. **Findings merge across the corpus.** 10 Instagram videos → one consolidated, re-weighted
   Instagram view, not 10 separate cards.
4. **Daily brief** = what's NEW since yesterday (the diff), once scheduled.
5. **Q&A over the corpus** — ask questions against all findings + full transcripts.
6. **On-screen deep-dives.** Some videos (e.g. DylanOFM "$12k→$282k in 60 days", `dt4Lq6fuua8`)
   show the operating system as an on-screen FLOWCHART. Captions miss it. Build the deferred
   frame→vision pipeline, used SELECTIVELY on flagged deep-dive videos.
7. **Baseline accuracy is foundational.** v1 wrongly said "Palm has no productized operating
   system" — Palm HAS the 8-step inspo→film→edit→post engine. The "vs us" is only as good as my
   model of Palm. Must deepen `docs/palm-operating-system.md` from the actual codebase first.

Invariants kept: **full transcripts always retained** (`research/transcripts/*.md`); synthesis
runs in-session (Claude Code usage, no separate API bill); every finding cites real, verified
sources (`verify_digest.py` guard — already caught 4 fabricated citations).

## Target architecture

```
research/
  transcripts/*.md         full transcripts (permanent archive, unchanged)
  meta/*.json              per-video credibility stats (subs/views/date/thumb)
  frames/<videoId>/*.json  vision deep-dive output (on-screen text/charts), keyed to timestamps
  knowledge/
    findings.json          THE corpus: every finding, each tagged {department, topic},
                           with consensus = # independent creators asserting it + score,
                           sources[], palm_comparison, recommendation, first_seen, last_seen
    taxonomy.json          department → sub-topic tree (editable)
  digests/
    daily/YYYY-MM-DD.json  the daily "what's new" diff brief
    runs/*.json            raw per-run synthesis (intermediate; folded into findings.json)
```

Confidence (consensus-only): `score = f(distinct_creators_agreeing, contradiction_flag)`.
High = ≥3 independent creators agree; Medium = 2; Low/contested = 1 or conflicting claims.
"Independent" = distinct channel_id (not 3 videos from the same person).

## Build phases (doing all)

**P1 — Deepen Palm baseline.** Re-scrape codebase + SMM plan via Explore agents; rewrite
`docs/palm-operating-system.md` so every department reflects what Palm actually does (fix the
"no operating system" error). This gates accurate "vs us".

**P2 — Knowledge-base data model.** Define taxonomy.json (departments/topics) + findings.json
schema (corpus-wide, deduped/merged, consensus-scored). Write `scripts/kb_build.py` that folds
run-digests into findings.json, merging same-claim findings across creators and computing
consensus. Re-fold the existing DylanOFM + topic-search digests into it (so the 10 topic videos
finally surface).

**P3 — Rebuild Research UI.** Department overview (cards w/ counts + top findings) → topic view
→ finding cards (existing design). Add search by department/keyword. Keep credibility/source
chips + jump-to-timestamp. API serves from findings.json/taxonomy.json.

**P4 — Daily brief.** `digests/daily/YYYY-MM-DD.json` = findings added/changed since prior run;
a "Today" view on the tab. (Wired to schedule in P7.)

**P5 — Q&A over corpus.** `/admin/research` Q&A box → `/api/admin/research/ask` that retrieves
relevant findings + transcript excerpts and answers with citations. (Synthesis in-session.)

**P6 — Vision deep-dive pipeline.** `scripts/yt_frames.py`: ffmpeg scene-change frame sampling
→ vision read (on-screen text/flowcharts) → `research/frames/<id>/*.json` keyed to timestamps.
A "deep-dive" synthesis mode that mines a flagged video exhaustively for *implementable* tactics
mapped to Palm. First target: the 282k flowchart video.

**P7 — Schedule daily.** Once trusted, schedule the daily run (discover→transcribe→synthesize→
kb_build→daily brief→Telegram). Add residential proxy only if cloud fetch miss-rate warrants.

## Open input needed
- **New channel URL** (Evan wants ~all videos from the last ~10 months) — not yet provided.
