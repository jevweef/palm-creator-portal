#!/usr/bin/env python3
"""
yt_enrich.py — Fetch channel/video credibility metadata for a set of videos and
write it as a JSON sidecar. Powers the Research tab's source-video cards: thumbnail,
channel name + subscriber count, view count, upload date (for recency/half-life).

Usage:
    python3 scripts/yt_enrich.py <out.json> <videoIdOrUrl> [more...]
    python3 scripts/yt_enrich.py research/meta/2026-05-30.json 118P4rIlfl0 o4s_nKjm2fw ...

Free: uses yt-dlp metadata only (no download).
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path


def vid_of(s: str) -> str:
    s = s.strip()
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", s):
        return s
    m = re.search(r"(?:v=|youtu\.be/|/shorts/|/embed/)([A-Za-z0-9_-]{11})", s)
    return m.group(1) if m else s


def fetch(vid: str) -> dict | None:
    try:
        proc = subprocess.run(
            ["yt-dlp", "--no-warnings", "--skip-download", "--dump-json",
             f"https://www.youtube.com/watch?v={vid}"],
            capture_output=True, text=True, timeout=60,
        )
    except Exception:
        return None
    if proc.returncode != 0 or not proc.stdout.strip():
        return None
    try:
        d = json.loads(proc.stdout.splitlines()[0])
    except (json.JSONDecodeError, IndexError):
        return None
    return {
        "id": d.get("id"),
        "title": d.get("title"),
        "channel": d.get("channel"),
        "channel_id": d.get("channel_id"),
        "channel_url": d.get("channel_url"),
        "channel_followers": d.get("channel_follower_count"),
        "views": d.get("view_count"),
        "likes": d.get("like_count"),
        "upload_date": d.get("upload_date"),
        "duration_string": d.get("duration_string"),
        "thumbnail": d.get("thumbnail"),
        "url": f"https://www.youtube.com/watch?v={d.get('id')}",
    }


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__)
        return 1
    out = Path(argv[1])
    out.parent.mkdir(parents=True, exist_ok=True)
    records = []
    for arg in argv[2:]:
        vid = vid_of(arg)
        rec = fetch(vid)
        if rec:
            records.append(rec)
            subs = rec["channel_followers"]
            print(f"  ok  {rec['channel']!r:26} "
                  f"{(str(subs)+' subs') if subs else 'subs ?':>12} | {rec['title'][:54]}")
        else:
            print(f"  FAIL {vid}")
    out.write_text(json.dumps(records, indent=2), encoding="utf-8")
    print(f"\nwrote {len(records)} record(s) -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
