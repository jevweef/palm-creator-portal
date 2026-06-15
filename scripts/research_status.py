#!/usr/bin/env python3
"""research_status.py — authoritative inventory of the OFM research library.

Prints: transcripts (files + unique ids), per-channel counts, enriched-but-not-
transcribed gap per meta file, and synthesis/KB state. One source of truth.
"""
import glob, re, json, os
from collections import Counter

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = os.path.join(REPO, "research", "transcripts")
M = os.path.join(REPO, "research", "meta")
RUNS = os.path.join(REPO, "research", "digests", "runs")
KB = os.path.join(REPO, "research", "knowledge", "findings.json")


def fm(path, key):
    head = open(path, encoding="utf-8").read(800)
    m = re.search(rf'^{key}:\s*"(.*?)"\s*$', head, re.M)
    return m.group(1) if m else ""


def main():
    files = [f for f in glob.glob(os.path.join(T, "*.md")) if not f.endswith("README.md")]
    chans = Counter()
    tids = set()
    for f in files:
        chans[fm(f, "channel") or "?"] += 1
        v = fm(f, "video_id")
        if v:
            tids.add(v)

    print("=" * 50)
    print(f"TRANSCRIPTS: {len(files)} files | {len(tids)} unique video_ids")
    print("=" * 50)
    print("\nBY CHANNEL:")
    tot = 0
    for ch, n in chans.most_common():
        print(f"  {n:3}  {ch}")
        tot += n
    print(f"  ---  (sum {tot})")

    print("\nENRICHED (discovered) vs TRANSCRIBED — the remaining scrape work:")
    grand = 0
    for mf in sorted(glob.glob(os.path.join(M, "*.json"))):
        try:
            recs = json.load(open(mf))
        except Exception:
            continue
        ids = [r["id"] for r in recs if r.get("id")]
        miss = [i for i in ids if i not in tids]
        grand += len(miss)
        flag = "  <-- " + str(len(miss)) + " TODO" if miss else ""
        print(f"  {os.path.basename(mf):34} enriched={len(ids):>3} have={len(ids)-len(miss):>3} missing={len(miss):>3}{flag}")
    print(f"\n  TOTAL still-to-transcribe (enriched but no transcript): {grand}")

    print("\nSYNTHESIS / KNOWLEDGE BASE:")
    runs = glob.glob(os.path.join(RUNS, "*.json"))
    print(f"  synthesis run files: {len(runs)}")
    for r in sorted(runs):
        try:
            n = len(json.load(open(r)).get("findings", []))
        except Exception:
            n = "?"
        print(f"    {os.path.basename(r)}: {n} findings")
    if os.path.exists(KB):
        kb = json.load(open(KB))
        print(f"  knowledge base: {len(kb.get('findings', []))} merged findings")
    else:
        print("  knowledge base: (not built)")


if __name__ == "__main__":
    main()
