#!/usr/bin/env python3
"""dedupe_transcripts.py — find/remove duplicate transcripts (same video_id, multiple files).

Keeps the BEST copy per video_id: prefer (1) a real title (not a bare id),
(2) more words, (3) a non-Apify free-caption source as tiebreak. Removes the rest.

  python3 scripts/dedupe_transcripts.py          # report only
  python3 scripts/dedupe_transcripts.py --apply   # delete the losers
"""
import glob, re, os, sys
from collections import defaultdict

T = "/Users/jevanleith/palm-creator-portal/research/transcripts"


def info(p):
    txt = open(p, encoding="utf-8").read()
    fm = txt[:800]
    g = lambda k: (re.search(rf'^{k}:\s*"(.*?)"', fm, re.M) or [None, ""])[1]
    vid = g("video_id")
    title = g("title")
    words = len(txt.split())
    good_title = bool(title) and title != vid and not re.fullmatch(r"[A-Za-z0-9_-]{11}", title or "")
    return {"path": p, "vid": vid, "title": title, "words": words, "good_title": good_title}


def main():
    apply = "--apply" in sys.argv
    files = [f for f in glob.glob(f"{T}/*.md") if not f.endswith("README.md")]
    by = defaultdict(list)
    noid = []
    for f in files:
        rec = info(f)
        if rec["vid"]:
            by[rec["vid"]].append(rec)
        else:
            noid.append(rec)

    losers = []
    dup_ids = 0
    for vid, recs in by.items():
        if len(recs) < 2:
            continue
        dup_ids += 1
        # rank: good_title desc, words desc
        recs.sort(key=lambda r: (r["good_title"], r["words"]), reverse=True)
        keep = recs[0]
        losers.extend(recs[1:])

    lines = []
    lines.append(f"total files: {len(files)}")
    lines.append(f"unique video_ids: {len(by)}")
    lines.append(f"video_ids with duplicates: {dup_ids}")
    lines.append(f"duplicate files to remove: {len(losers)}")
    lines.append(f"files with NO video_id: {len(noid)}")
    lines.append("")
    for r in losers:
        lines.append(f"  REMOVE {os.path.basename(r['path'])}  (vid={r['vid']} words={r['words']})")
    for r in noid:
        lines.append(f"  NOID   {os.path.basename(r['path'])}")
    report = "\n".join(lines)
    open("/Users/jevanleith/.claude/jobs/54514052/tmp/dedupe.txt", "w").write(report)

    if apply:
        for r in losers:
            os.remove(r["path"])
        remaining = len([f for f in glob.glob(f"{T}/*.md") if not f.endswith("README.md")])
        open("/Users/jevanleith/.claude/jobs/54514052/tmp/dedupe.txt", "a").write(
            f"\n\nAPPLIED: removed {len(losers)} duplicates. LIBRARY NOW: {remaining}")
    print("done")


if __name__ == "__main__":
    main()
