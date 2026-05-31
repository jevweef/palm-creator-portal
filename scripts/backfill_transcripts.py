#!/usr/bin/env python3
"""
backfill_transcripts.py — Serially transcribe videos that were ENRICHED (stats pulled into
research/meta/*.json) but never transcribed, with gentle pacing to avoid re-triggering YouTube's
rate-limit. Safe to run in the background; resumable (skips anything already transcribed).

Usage:
  python3 scripts/backfill_transcripts.py            # process all missing, ~8s between videos
  python3 scripts/backfill_transcripts.py --delay 12 # custom pacing
  python3 scripts/backfill_transcripts.py --limit 20 # cap per run
"""
from __future__ import annotations
import glob, json, re, subprocess, sys, time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
META = REPO / "research" / "meta"
TRANS = REPO / "research" / "transcripts"
YT = REPO / "scripts" / "yt_transcript.py"
DENYLIST = REPO / "research" / "denylist.txt"


def denied_ids() -> set[str]:
    """Video IDs intentionally excluded (flagged/junk) — never re-transcribe these."""
    ids = set()
    if DENYLIST.exists():
        for line in DENYLIST.read_text(encoding="utf-8").splitlines():
            line = line.split("#", 1)[0].strip()
            if re.fullmatch(r"[A-Za-z0-9_-]{11}", line):
                ids.add(line)
    return ids


def transcribed_ids() -> set[str]:
    ids = set()
    for p in TRANS.glob("*.md"):
        if p.name == "README.md":
            continue
        m = re.search(r'video_id:\s*"([A-Za-z0-9_-]{11})"', p.read_text(encoding="utf-8")[:400])
        if m:
            ids.add(m.group(1))
    return ids


def enriched_ids() -> list[str]:
    seen, order = set(), []
    for f in sorted(META.glob("*.json")):
        try:
            arr = json.loads(f.read_text())
        except Exception:
            continue
        if isinstance(arr, list):
            for v in arr:
                vid = v.get("id") if v else None
                if vid and vid not in seen:
                    seen.add(vid); order.append(vid)
    return order


def main(argv):
    delay = 8.0
    limit = None
    if "--delay" in argv:
        delay = float(argv[argv.index("--delay") + 1])
    if "--limit" in argv:
        limit = int(argv[argv.index("--limit") + 1])

    have = transcribed_ids()
    denied = denied_ids()
    todo = [v for v in enriched_ids() if v not in have and v not in denied]
    if limit:
        todo = todo[:limit]
    print(f"backfill: {len(todo)} videos to transcribe (delay {delay}s) "
          f"[{len(denied)} denylisted, skipped]", flush=True)

    ok = fail = 0
    for i, vid in enumerate(todo, 1):
        url = f"https://www.youtube.com/watch?v={vid}"
        r = subprocess.run(["python3", str(YT), url], capture_output=True, text=True)
        out = (r.stdout + r.stderr)
        if "saved ->" in out:
            ok += 1
            print(f"[{i}/{len(todo)}] OK   {vid}", flush=True)
        else:
            fail += 1
            reason = "rate-limited/blocked" if ("IpBlocked" in out or "no caption" in out or "rate" in out.lower()) else "no captions/unavailable"
            print(f"[{i}/{len(todo)}] FAIL {vid} — {reason}", flush=True)
        if i < len(todo):
            time.sleep(delay)
    print(f"\nbackfill done: {ok} transcribed, {fail} failed, {len(have)+ok} total in library", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
