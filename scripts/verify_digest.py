#!/usr/bin/env python3
"""
verify_digest.py — Guard against fabricated source citations in a research digest.

The synthesis step (an LLM) can hallucinate video_ids — citing a "source" video it
never actually read. For a tool whose entire value is traceability, that's fatal. This
script enforces the invariant: **every cited video_id must correspond to a transcript
that actually exists** in research/transcripts/.

What it does:
  - Builds the set of legitimate video_ids from research/transcripts/*.md frontmatter.
  - Scans a digest JSON's findings[].sources[].video_id.
  - Reports any citation whose video_id has no transcript (= fabricated / unverifiable).
  - With --fix: removes fabricated sources, and flags any finding left with ZERO valid
    sources by setting finding["unverified"] = true (so the UI can mark it, rather than
    silently dropping it).

Usage:
    python3 scripts/verify_digest.py research/digests/2026-05-30-dylanofm.json
    python3 scripts/verify_digest.py research/digests/2026-05-30-dylanofm.json --fix

Exit code 0 if clean (or fixed), 1 if fabricated citations remain (without --fix).
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TRANSCRIPTS = REPO / "research" / "transcripts"


def legit_ids() -> set[str]:
    ids = set()
    for p in TRANSCRIPTS.glob("*.md"):
        if p.name == "README.md":
            continue
        m = re.search(r'video_id:\s*"([A-Za-z0-9_-]{11})"', p.read_text(encoding="utf-8")[:600])
        if m:
            ids.add(m.group(1))
    return ids


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    digest_path = Path(argv[1])
    fix = "--fix" in argv[2:]
    legit = legit_ids()
    d = json.loads(digest_path.read_text(encoding="utf-8"))

    fabricated = []   # (finding_rank, video_id)
    total_sources = 0
    for f in d.get("findings", []):
        kept = []
        for s in f.get("sources", []):
            total_sources += 1
            vid = s.get("video_id")
            if vid in legit:
                kept.append(s)
            else:
                fabricated.append((f.get("rank"), vid))
        if fix:
            f["sources"] = kept
            if not kept:
                f["unverified"] = True

    print(f"transcripts available : {len(legit)}")
    print(f"source citations      : {total_sources}")
    print(f"fabricated/unverifiable: {len(fabricated)}")
    for rank, vid in fabricated:
        print(f"   - finding #{rank}: {vid}  (no transcript — NOT a real read source)")

    if fix:
        unverified = [f.get("rank") for f in d.get("findings", []) if f.get("unverified")]
        digest_path.write_text(json.dumps(d, indent=2), encoding="utf-8")
        print(f"\nFIXED: removed {len(fabricated)} fabricated citation(s).")
        if unverified:
            print(f"WARNING: findings now with NO valid source (flagged unverified): {unverified}")
        return 0

    return 1 if fabricated else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
