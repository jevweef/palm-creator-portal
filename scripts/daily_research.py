#!/usr/bin/env python3
"""
daily_research.py — The P7 orchestrator: one unattended run of the whole OFM research pipeline.

    discover  → enrich → transcribe → synthesize → verify → kb_build → daily_brief → (notify)

It is the "scheduled Claude agent" made concrete: a single idempotent command a cron/agent runs
once a day. Each stage shells out to the existing single-purpose scripts so this file stays a thin,
auditable conductor (and each stage is still runnable on its own).

What it does, in order:
  1. DISCOVER  new videos from research/watchlist.txt (+ research/topics.txt) via yt_discover.py,
     drop anything already transcribed or on research/denylist.txt, cap at --max.
  2. ENRICH    credibility metadata for the new ids -> research/meta/daily-<date>.json.
  3. TRANSCRIBE via yt_transcript.py (TRANSCRIPT_FORCE_APIFY=1 — reliable on cloud/datacenter IPs).
  4. SYNTHESIZE only the transcripts that are actually NEW this run -> research/digests/runs/
     daily-<date>.json (synthesize_run.py, Anthropic API).
  5. VERIFY     verify_digest.py --fix (strip any fabricated citations — the hard guard).
  6. KB_BUILD   re-fold all run digests into research/knowledge/findings.json.
  7. DAILY_BRIEF diff vs last snapshot -> research/digests/daily/<date>.json + snapshot.
  8. NOTIFY     (optional) Telegram one-liner of the brief headline, if a bot token is configured.

Idempotent: re-running the same day only picks up videos not yet transcribed. If nothing is new,
it still runs the brief (a dated heartbeat: "No new findings since last run").

Usage:
  python3 scripts/daily_research.py                      # today (residential IP: full discover)
  python3 scripts/daily_research.py --date 2026-06-01    # pin the date stamp
  python3 scripts/daily_research.py --max 8              # cap new videos this run
  python3 scripts/daily_research.py --watchlist-only     # skip topic search (less noise)
  python3 scripts/daily_research.py --dry-run            # discover + plan only, no fetch/spend
  python3 scripts/daily_research.py --commit             # git-commit the research/ changes (no push)
  python3 scripts/daily_research.py --no-synth           # fetch only, skip the paid synthesis step

Exit 0 on success (incl. "nothing new"); non-zero only on a hard stage failure.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import date as _date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = REPO / "scripts"
TRANSCRIPTS = REPO / "research" / "transcripts"
DENYLIST = REPO / "research" / "denylist.txt"
META_DIR = REPO / "research" / "meta"
RUNS_DIR = REPO / "research" / "digests" / "runs"


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    """Run a child script with the repo's env (so APIFY/ANTHROPIC keys propagate)."""
    return subprocess.run(cmd, cwd=str(REPO), text=True, **kw)


def read_denylist() -> set[str]:
    ids: set[str] = set()
    if DENYLIST.exists():
        for line in DENYLIST.read_text(encoding="utf-8").splitlines():
            line = line.split("#", 1)[0].strip()
            if re.fullmatch(r"[A-Za-z0-9_-]{11}", line):
                ids.add(line)
    return ids


def transcript_ids() -> dict[str, Path]:
    """video_id -> transcript file path, from frontmatter."""
    out: dict[str, Path] = {}
    if not TRANSCRIPTS.exists():
        return out
    for p in TRANSCRIPTS.glob("*.md"):
        if p.name == "README.md":
            continue
        m = re.search(r'video_id:\s*"([A-Za-z0-9_-]{11})"', p.read_text(encoding="utf-8")[:600])
        if m:
            out[m.group(1)] = p
    return out


def discover(args) -> tuple[list[dict], list[dict]]:
    """Return (new_records, discovery_errors) after denylist + already-have filtering."""
    cmd = ["python3", str(SCRIPTS / "yt_discover.py"), "--json",
           "--per-channel", str(args.per_channel), "--per-topic", str(args.per_topic)]
    if args.watchlist_only:
        cmd.append("--watchlist-only")
    if args.topics_only:
        cmd.append("--topics-only")
    proc = run(cmd, capture_output=True)
    if proc.returncode != 0 and not proc.stdout.strip():
        log(f"  ! discover failed: {proc.stderr.strip()[:300]}")
        return [], [{"source": "discover", "error": proc.stderr.strip()[:300]}]
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        log(f"  ! discover produced no JSON: {proc.stdout[:200]}")
        return [], [{"source": "discover", "error": "no JSON output"}]

    deny = read_denylist()
    have = set(transcript_ids().keys())
    new = [r for r in data.get("new", []) if r["id"] not in deny and r["id"] not in have]
    return new, data.get("errors", [])


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Run the full daily OFM research pipeline once.")
    ap.add_argument("--date", default=_date.today().isoformat(), help="date stamp (YYYY-MM-DD)")
    ap.add_argument("--max", type=int, default=12, help="max new videos to process this run")
    ap.add_argument("--per-channel", type=int, default=5)
    ap.add_argument("--per-topic", type=int, default=4)
    ap.add_argument("--watchlist-only", action="store_true", help="skip topic search")
    ap.add_argument("--topics-only", action="store_true", help="skip channel watchlist")
    ap.add_argument("--model", default="claude-sonnet-4-6", help="synthesis model")
    ap.add_argument("--dry-run", action="store_true", help="discover + plan only; no fetch/spend")
    ap.add_argument("--no-synth", action="store_true", help="fetch transcripts but skip synthesis")
    ap.add_argument("--commit", action="store_true", help="git-commit research/ changes (no push)")
    args = ap.parse_args(argv[1:])

    date = args.date
    summary: dict = {"date": date, "stages": {}}
    log(f"=== daily_research {date} ===")

    # 1. DISCOVER
    new, errors = discover(args)
    new = new[: args.max]
    summary["stages"]["discover"] = {"new": len(new), "errors": len(errors)}
    log(f"[1/7] discover: {len(new)} new video(s), {len(errors)} discovery error(s)")
    for r in new:
        log(f"       + {r['id']}  {r.get('channel','')[:24]:24}  {r.get('title','')[:50]}")
    for e in errors:
        log(f"       ! {e.get('source')}: {e.get('error')}")

    if args.dry_run:
        summary["dry_run"] = True
        print(json.dumps(summary, indent=2))
        return 0

    new_ids = [r["id"] for r in new]
    new_urls = [r["url"] for r in new]

    if new_ids:
        # 2. ENRICH
        meta_path = META_DIR / f"daily-{date}.json"
        log(f"[2/7] enrich -> {meta_path.relative_to(REPO)}")
        run(["python3", str(SCRIPTS / "yt_enrich.py"), str(meta_path), *new_ids])

        # 3. TRANSCRIBE (force Apify — reliable regardless of host IP)
        before = set(transcript_ids().keys())
        env = {**os.environ, "TRANSCRIPT_FORCE_APIFY": "1"}
        log(f"[3/7] transcribe {len(new_urls)} video(s) via Apify")
        run(["python3", str(SCRIPTS / "yt_transcript.py"), *new_urls], env=env)
        after = transcript_ids()
        fetched = sorted(set(after.keys()) - before)
        summary["stages"]["transcribe"] = {"fetched": len(fetched),
                                            "failed": len(new_ids) - len(fetched)}
        log(f"       fetched {len(fetched)} new transcript(s)")
    else:
        fetched = []
        log("[2/7] enrich: skipped (nothing new)")
        log("[3/7] transcribe: skipped (nothing new)")

    # 4. SYNTHESIZE (only the genuinely-new transcripts)
    run_digest = RUNS_DIR / f"daily-{date}.json"
    if fetched and not args.no_synth:
        log(f"[4/7] synthesize {len(fetched)} transcript(s) -> {run_digest.relative_to(REPO)}")
        rc = run(["python3", str(SCRIPTS / "synthesize_run.py"),
                  "--out", str(run_digest), "--model", args.model, "--ids", *fetched]).returncode
        synth_ok = run_digest.exists()
        summary["stages"]["synthesize"] = {"ok": synth_ok, "rc": rc}

        # 5. VERIFY (hard anti-hallucination guard; --fix strips fabricated citations)
        if synth_ok:
            log("[5/7] verify_digest --fix")
            run(["python3", str(SCRIPTS / "verify_digest.py"), str(run_digest), "--fix"])
    elif args.no_synth:
        log("[4/7] synthesize: skipped (--no-synth)")
        log("[5/7] verify: skipped (--no-synth)")
    else:
        log("[4/7] synthesize: skipped (no new transcripts)")
        log("[5/7] verify: skipped (no new transcripts)")

    # 6. KNOWLEDGE BASE — rebuild + semantic merge.
    #    kb_build does keyword clustering (UNDER-merges paraphrases -> consensus too low), so we
    #    follow it with the LLM grouping pass that makes high/medium/low meaningful. This pass MUST
    #    re-run every time the corpus changes: kb_build renumbers finding ids (f0001..) on each
    #    rebuild, so any prior grouping points at the wrong findings. Skipping the merge here would
    #    overwrite the good consensus-weighted corpus with the raw keyword one — so we keep it whole.
    log("[6/7] knowledge base: kb_build -> cluster_findings -> apply_semantic_merge")
    kb = run(["python3", str(SCRIPTS / "kb_build.py")], capture_output=True)
    log("       kb_build: " + (((kb.stdout or kb.stderr).strip().splitlines() or ["ran"])[-1]))
    kb_failed = kb.returncode != 0
    merged_ok = False
    if kb_failed:
        log("       ! kb_build failed; leaving existing findings.json untouched")
    elif args.no_synth:
        log("       semantic merge: skipped (--no-synth: no API spend)")
    else:
        # back up the keyword build before the LLM rewrites findings.json in place
        FINDINGS = REPO / "research" / "knowledge" / "findings.json"
        PRE = REPO / "research" / "knowledge" / "findings.pre-semantic.json"
        try:
            PRE.write_text(FINDINGS.read_text(encoding="utf-8"), encoding="utf-8")
        except Exception:
            pass
        cl = run(["python3", str(SCRIPTS / "cluster_findings.py"), "--model", args.model],
                 capture_output=True)
        if cl.returncode == 0:
            log("       cluster: " + (((cl.stdout or cl.stderr).strip().splitlines() or ["ran"])[-1]))
            am = run(["python3", str(SCRIPTS / "apply_semantic_merge.py")], capture_output=True)
            merged_ok = am.returncode == 0
            log("       merge: " + (((am.stdout or am.stderr).strip().splitlines() or ["ran"])[-1]))
            if not merged_ok:
                # restore the keyword build rather than ship a half-merged corpus
                try:
                    FINDINGS.write_text(PRE.read_text(encoding="utf-8"), encoding="utf-8")
                    log("       ! merge failed; restored pre-semantic findings.json")
                except Exception:
                    pass
        else:
            log("       ! cluster_findings failed; keeping keyword build (consensus under-merged): "
                + (((cl.stdout or cl.stderr).strip().splitlines() or [""])[-1]))
    summary["stages"]["knowledge_base"] = {"kb_build_ok": not kb_failed, "semantic_merged": merged_ok}

    # 7. DAILY_BRIEF (diff vs last snapshot + snapshot current state)
    log(f"[7/7] daily_brief {date}")
    brief = run(["python3", str(SCRIPTS / "daily_brief.py"), date], capture_output=True)
    brief_line = (brief.stdout or brief.stderr).strip()
    log("       " + brief_line)

    # headline for notify/summary
    headline = ""
    brief_path = REPO / "research" / "digests" / "daily" / f"{date}.json"
    if brief_path.exists():
        try:
            headline = json.loads(brief_path.read_text()).get("headline", "")
        except Exception:
            pass
    summary["headline"] = headline

    # 8. NOTIFY (optional Telegram — skips cleanly if no bot token configured)
    notify_telegram(date, headline, len(fetched))

    # optional commit (own paths only; never -A; never auto-push)
    if args.commit:
        commit_changes(date, len(fetched))

    print(json.dumps(summary, indent=2))
    return 0


def _env(key: str) -> str | None:
    if os.getenv(key):
        return os.getenv(key)
    envf = REPO / ".env.local"
    if envf.exists():
        for line in envf.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                if k.strip() == key:
                    return v.strip().strip('"').strip("'")
    return None


def notify_telegram(date: str, headline: str, n_fetched: int) -> None:
    # Same routing as the other local agents (maya_brief etc.): the HEARTBEAT
    # bot into the Palm Team forum, "OFM Research" topic (thread 169). The old
    # TELEGRAM_BOT_TOKEN + SMM-group fallback dropped this digest into Palm
    # Social Media's General topic the day that token appeared locally
    # (2026-07-18 incident).
    token = _env("TELEGRAM_HEARTBEAT_BOT_TOKEN") or _env("TELEGRAM_BOT_TOKEN") or _env("TELEGRAM_TOKEN")
    chat = _env("RESEARCH_TELEGRAM_CHAT_ID") or "-1004293138854"  # Palm Team group
    thread = _env("RESEARCH_TELEGRAM_TOPIC_ID") or "169"          # OFM Research topic
    if not token or not chat:
        log("       notify: skipped (no Telegram bot token / chat id)")
        return
    import urllib.request
    text = f"OFM Research — {date}\n{headline or 'pipeline ran'}\n({n_fetched} new transcript(s))"
    try:
        payload = {"chat_id": chat, "text": text}
        if thread:
            payload["message_thread_id"] = int(thread)
        data = json.dumps(payload).encode()
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage",
            data=data, headers={"content-type": "application/json"})
        urllib.request.urlopen(req, timeout=30)
        log("       notify: sent Telegram brief")
    except Exception as e:
        log(f"       notify: failed ({type(e).__name__})")


def commit_changes(date: str, n_fetched: int) -> None:
    paths = ["research/", "docs/build-plans/ofm-research/"]
    add = run(["git", "add", *paths], capture_output=True)
    if add.returncode != 0:
        log(f"       commit: git add failed: {add.stderr.strip()[:200]}")
        return
    staged = run(["git", "diff", "--cached", "--quiet"], capture_output=True).returncode
    if staged == 0:
        log("       commit: nothing to commit")
        return
    msg = (f"chore(research): daily run {date} (+{n_fetched} transcript(s))\n\n"
           "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>")
    c = run(["git", "commit", "-m", msg], capture_output=True)
    log("       commit: " + ("done" if c.returncode == 0 else f"failed: {c.stderr.strip()[:200]}"))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
