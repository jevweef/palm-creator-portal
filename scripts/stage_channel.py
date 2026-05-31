#!/usr/bin/env python3
"""
stage_channel.py — Enrich a list of video IDs, keep only those uploaded within the
last N days, and write them to a research/meta/<name>.json so the Apify backfill
will transcribe them. Used to onboard a new channel with a date cutoff.

Usage:
  python3 scripts/stage_channel.py <name> <ids_tsv> [--since YYYYMMDD] [--limit N]
    ids_tsv : file with "video_id<TAB>title" per line (title optional)
"""
import sys, json, subprocess, os, re

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def enrich(vid):
    try:
        p = subprocess.run(
            ["yt-dlp", "--no-warnings", "--skip-download", "--dump-json",
             f"https://www.youtube.com/watch?v={vid}"],
            capture_output=True, text=True, timeout=60)
        if p.returncode != 0 or not p.stdout.strip():
            return None
        d = json.loads(p.stdout.splitlines()[0])
        return {
            "id": d.get("id"), "title": d.get("title"), "channel": d.get("channel"),
            "channel_id": d.get("channel_id"), "channel_followers": d.get("channel_follower_count"),
            "views": d.get("view_count"), "likes": d.get("like_count"),
            "upload_date": d.get("upload_date"), "duration_string": d.get("duration_string"),
            "thumbnail": d.get("thumbnail"), "url": f"https://www.youtube.com/watch?v={d.get('id')}",
        }
    except Exception:
        return None


def main(argv):
    name = argv[1]
    tsv = argv[2]
    since = "20250530"
    limit = 100
    if "--since" in argv: since = argv[argv.index("--since") + 1]
    if "--limit" in argv: limit = int(argv[argv.index("--limit") + 1])

    ids = []
    for line in open(tsv):
        line = line.rstrip("\n")
        if not line.strip():
            continue
        vid = re.split(r"[\t|]", line)[0].strip()
        if re.fullmatch(r"[A-Za-z0-9_-]{11}", vid):
            ids.append(vid)
    ids = ids[:limit]

    kept, old, fail = [], 0, 0
    log = []
    for i, vid in enumerate(ids, 1):
        rec = enrich(vid)
        if not rec:
            fail += 1; log.append(f"{i}/{len(ids)} FAIL {vid}"); continue
        d = rec.get("upload_date") or "00000000"
        if d >= since:
            kept.append(rec); log.append(f"{i}/{len(ids)} KEEP {vid} {d}")
        else:
            old += 1; log.append(f"{i}/{len(ids)} OLD  {vid} {d}")

    out = os.path.join(REPO, "research", "meta", f"{name}.json")
    json.dump(kept, open(out, "w"), indent=2)
    log.append(f"\nSTAGED {len(kept)} (>= {since}) | old={old} fail={fail} -> {out}")
    print("\n".join(log))


if __name__ == "__main__":
    main(sys.argv)
