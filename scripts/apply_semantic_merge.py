#!/usr/bin/env python3
"""
apply_semantic_merge.py — Apply an LLM-produced semantic grouping to the knowledge base.

The naive token-overlap clustering in kb_build.py under-merges (paraphrases of the same
tactic don't cluster), so consensus stays artificially low. This script takes a grouping
file produced by a reasoning pass — groups of finding IDs that mean the same thing within
a department — and rewrites research/knowledge/findings.json so each group becomes ONE
finding whose consensus = number of DISTINCT creators across the grouped findings.

Grouping file format (research/knowledge/semantic_groups.json):
  { "groups": [
      { "department": "pricing",
        "title": "Start the first PPV cheap to build a buying habit",
        "member_ids": ["f0007","f0041","f0099"] },
      ... ] }
Any finding not listed in a group stays as its own single-source finding.

Usage:
  python3 scripts/apply_semantic_merge.py            # apply groups -> findings.json
"""
import json, os
from collections import OrderedDict

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KBF = os.path.join(REPO, "research", "knowledge", "findings.json")
GROUPS = os.path.join(REPO, "research", "knowledge", "semantic_groups.json")


def consensus(n, contested=False):
    label = "high" if n >= 3 else "medium" if n == 2 else "low"
    if contested and label == "high":
        label = "medium"
    return {"creators": n, "label": label, "contested": contested}


def main():
    kb = json.load(open(KBF))
    findings = {f["id"]: f for f in kb["findings"]}
    groups = json.load(open(GROUPS)).get("groups", [])

    used = set()
    merged = []

    for g in groups:
        members = [findings[i] for i in g.get("member_ids", []) if i in findings]
        if not members:
            continue
        for m in members:
            used.add(m["id"])
        # union creators, sources, applicability, variants
        creators, srcs, applic, variants, vs, rec = set(), [], set(), [], [], []
        seen_src = set()
        for m in members:
            for c in m.get("creators", []):
                creators.add(c)
            for s in m.get("sources", []):
                k = (s.get("video_id"), s.get("timestamp_seconds"))
                if k not in seen_src:
                    seen_src.add(k); srcs.append(s)
            for a in m.get("applicability", []):
                applic.add(a)
            variants.extend(m.get("variants", []))
            if m.get("palm_comparison", {}).get("vs_us"):
                vs.append(m["palm_comparison"]["vs_us"])
            if m.get("palm_comparison", {}).get("recommendation"):
                rec.append(m["palm_comparison"]["recommendation"])
        creators = sorted(c for c in creators if c and c != "unknown")
        merged.append({
            "id": f"m{len(merged)+1:04d}",
            "department": g.get("department") or members[0]["department"],
            "topic": members[0].get("topic", ""),
            "title": g.get("title") or members[0]["title"],
            "variants": variants,
            "sources": srcs,
            "creators": creators,
            "consensus": consensus(len(creators)),
            "applicability": sorted(applic) or ["unknown"],
            "palm_comparison": {"vs_us": vs[0] if vs else "", "recommendation": rec[0] if rec else ""},
        })

    # carry through any ungrouped finding as-is
    for fid, f in findings.items():
        if fid not in used:
            merged.append(f)

    rank = {"high": 0, "medium": 1, "low": 2}
    merged.sort(key=lambda f: (rank[f["consensus"]["label"]], -len(f.get("sources", []))))

    out = {"findings": merged, "departments_present": sorted({f["department"] for f in merged})}
    json.dump(out, open(KBF, "w"), indent=2)

    from collections import Counter
    cons = Counter(f["consensus"]["label"] for f in merged)
    print(f"applied {len(groups)} groups -> {len(merged)} findings")
    print("consensus:", dict(cons))


if __name__ == "__main__":
    main()
