#!/usr/bin/env python3
"""find_missing.py — list videos that were enriched (in research/meta/*.json) but have
no transcript yet, with the reason if known. Writes a clean report + a plain id list."""
import glob, re, json, os

REPO = "/Users/jevanleith/palm-creator-portal"
T = f"{REPO}/research/transcripts"
M = f"{REPO}/research/meta"

tids = set()
for p in glob.glob(f"{T}/*.md"):
    if p.endswith("README.md"):
        continue
    m = re.search(r'^video_id:\s*"([A-Za-z0-9_-]{11})"', open(p).read(400), re.M)
    if m:
        tids.add(m.group(1))

missing = {}  # vid -> (channel, title, source_meta)
for mf in sorted(glob.glob(f"{M}/*.json")):
    try:
        recs = json.load(open(mf))
    except Exception:
        continue
    for r in recs:
        vid = r.get("id")
        if vid and vid not in tids and vid not in missing:
            missing[vid] = (r.get("channel") or "?", (r.get("title") or "")[:50], os.path.basename(mf))

lines = [f"MISSING (enriched, not transcribed): {len(missing)}", ""]
from collections import Counter
bychan = Counter(v[0] for v in missing.values())
for ch, n in bychan.most_common():
    lines.append(f"  {n:3}  {ch}")
lines.append("")
for vid, (ch, ti, mf) in missing.items():
    lines.append(f"{vid}\t{ch}\t{ti}")
open("/Users/jevanleith/.claude/jobs/54514052/tmp/missing_report.txt", "w").write("\n".join(lines))
open("/Users/jevanleith/.claude/jobs/54514052/tmp/missing_ids.txt", "w").write("\n".join(missing.keys()))
print(f"missing: {len(missing)}")
