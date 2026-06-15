#!/usr/bin/env python3
"""
yt_discover.py — Find NEW OFM-agency YouTube videos to research.

Two discovery modes, combined:
  1. TOPIC search  — search YouTube for OFM agency terms (research/topics.txt)
  2. WATCHLIST     — recent uploads from specific channels (research/watchlist.txt)

Output: video URLs that are NOT already transcribed in research/transcripts/
(dedup by 11-char video id). Prints them one per line; pass to yt_transcript.py.

Usage:
    python3 scripts/yt_discover.py                 # both modes, default limits
    python3 scripts/yt_discover.py --topics-only
    python3 scripts/yt_discover.py --watchlist-only
    python3 scripts/yt_discover.py --per-topic 5 --per-channel 3 --max-age-days 14
    python3 scripts/yt_discover.py --json           # machine-readable output
    python3 scripts/yt_discover.py --transcribe     # also run yt_transcript.py on results

Relies on yt-dlp (already installed). Network access required.

NOTE on reliability: yt-dlp search/listing runs fine from a residential IP. From a
datacenter IP (cloud runner) YouTube may bot-gate some requests; discovery failures are
reported, not silently swallowed (see --json 'errors').
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TRANSCRIPTS_DIR = REPO_ROOT / "research" / "transcripts"
WATCHLIST_FILE = REPO_ROOT / "research" / "watchlist.txt"
TOPICS_FILE = REPO_ROOT / "research" / "topics.txt"


def read_list(path: Path) -> list[str]:
    """Read a config list file: one entry per line, '#' comments and blanks ignored."""
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            out.append(line)
    return out


def already_have_ids() -> set[str]:
    """Video ids already transcribed — read from frontmatter of files in transcripts/."""
    ids: set[str] = set()
    if not TRANSCRIPTS_DIR.exists():
        return ids
    for p in TRANSCRIPTS_DIR.glob("*.md"):
        if p.name == "README.md":
            continue
        try:
            head = p.read_text(encoding="utf-8")[:600]
        except Exception:
            continue
        m = re.search(r'video_id:\s*"([A-Za-z0-9_-]{11})"', head)
        if m:
            ids.add(m.group(1))
    return ids


def ytdlp_json(args: list[str]) -> tuple[list[dict], str | None]:
    """Run yt-dlp with --dump-json --flat-playlist; return (entries, error)."""
    cmd = ["yt-dlp", "--no-warnings", "--flat-playlist", "--dump-json", *args]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except FileNotFoundError:
        return [], "yt-dlp not installed"
    except subprocess.TimeoutExpired:
        return [], "yt-dlp timed out"
    entries = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entries.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    err = None
    if not entries and proc.returncode != 0:
        err = (proc.stderr or "unknown error").strip().splitlines()[-1][:200]
    return entries, err


def search_topic(term: str, limit: int) -> tuple[list[dict], str | None]:
    """YouTube search for a term, newest-ish first via ytsearch."""
    return ytdlp_json([f"ytsearch{limit}:{term}"])


def channel_recent(channel: str, limit: int) -> tuple[list[dict], str | None]:
    """Recent uploads from a channel handle/URL."""
    url = channel
    if not channel.startswith("http"):
        handle = channel if channel.startswith("@") else f"@{channel}"
        url = f"https://www.youtube.com/{handle}/videos"
    return ytdlp_json(["--playlist-end", str(limit), url])


def to_record(entry: dict, source: str) -> dict | None:
    vid = entry.get("id")
    if not vid or not re.fullmatch(r"[A-Za-z0-9_-]{11}", vid):
        return None
    return {
        "id": vid,
        "url": f"https://www.youtube.com/watch?v={vid}",
        "title": entry.get("title") or "",
        "channel": entry.get("channel") or entry.get("uploader") or "",
        "duration": entry.get("duration"),
        "found_via": source,
    }


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Discover new OFM-agency YouTube videos.")
    ap.add_argument("--topics-only", action="store_true")
    ap.add_argument("--watchlist-only", action="store_true")
    ap.add_argument("--per-topic", type=int, default=6, help="results per search term")
    ap.add_argument("--per-channel", type=int, default=4, help="recent uploads per channel")
    ap.add_argument("--min-duration", type=int, default=120,
                    help="skip videos shorter than N seconds (filter Shorts); 0 to disable")
    ap.add_argument("--json", action="store_true", help="emit JSON")
    ap.add_argument("--transcribe", action="store_true",
                    help="also run scripts/yt_transcript.py on the new URLs")
    args = ap.parse_args(argv[1:])

    do_topics = not args.watchlist_only
    do_watch = not args.topics_only

    have = already_have_ids()
    seen: set[str] = set()
    found: list[dict] = []
    errors: list[dict] = []

    if do_topics:
        topics = read_list(TOPICS_FILE)
        if not topics:
            errors.append({"source": "topics", "error": f"no terms in {TOPICS_FILE}"})
        for term in topics:
            entries, err = search_topic(term, args.per_topic)
            if err:
                errors.append({"source": f"topic:{term}", "error": err})
            for e in entries:
                rec = to_record(e, f"topic:{term}")
                if rec:
                    found.append(rec)

    if do_watch:
        channels = read_list(WATCHLIST_FILE)
        if not channels:
            errors.append({"source": "watchlist", "error": f"no channels in {WATCHLIST_FILE}"})
        for ch in channels:
            entries, err = channel_recent(ch, args.per_channel)
            if err:
                errors.append({"source": f"channel:{ch}", "error": err})
            for e in entries:
                rec = to_record(e, f"channel:{ch}")
                if rec:
                    found.append(rec)

    # Filter: dedup, drop already-transcribed, drop shorts.
    new: list[dict] = []
    for rec in found:
        vid = rec["id"]
        if vid in have or vid in seen:
            continue
        dur = rec.get("duration")
        if args.min_duration and isinstance(dur, (int, float)) and dur < args.min_duration:
            continue
        seen.add(vid)
        new.append(rec)

    if args.json:
        print(json.dumps({"new": new, "errors": errors,
                          "counts": {"new": len(new), "already_have": len(have),
                                     "errors": len(errors)}}, indent=2))
    else:
        for rec in new:
            dur = rec.get("duration")
            dmin = f"{int(dur)//60}m" if isinstance(dur, (int, float)) else "?"
            print(f"{rec['url']}  [{dmin}] {rec['channel']} — {rec['title']}  ({rec['found_via']})")
        print(f"\n{len(new)} new video(s) | {len(have)} already in library | "
              f"{len(errors)} discovery error(s)", file=sys.stderr)
        for e in errors:
            print(f"  ! {e['source']}: {e['error']}", file=sys.stderr)

    if args.transcribe and new:
        script = REPO_ROOT / "scripts" / "yt_transcript.py"
        urls = [r["url"] for r in new]
        print(f"\n>> transcribing {len(urls)} video(s)...", file=sys.stderr)
        subprocess.run(["python3", str(script), *urls])

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
