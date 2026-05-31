#!/usr/bin/env python3
"""
apply_clusters.py — Apply a semantic clustering (from an LLM pass) to the knowledge base.

Reads research/knowledge/findings.json (the per-claim findings) + a clusters file
({clusters:[{canonical_title, department, member_ids[]}]}) and merges each cluster's member
findings into ONE finding: pooled sources, union of creators, recomputed consensus by the
number of DISTINCT creators. This is the semantic upgrade over kb_build's keyword clustering.

Usage:
  python3 scripts/apply_clusters.py <clusters.json>
"""
import json, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
KB = REPO / "research" / "knowledge" / "findings.json"


def consensus(n, contested):
    label = "high" if n >= 3 else "medium" if n == 2 else "low"
    if contested and label == "high":
        label = "medium"
    return {"creators": n, "label": label, "contested": contested}


def main(argv):
    clusters = json.loads(Path(argv[1]).read_text())["clusters"]
    kb = json.loads(KB.read_text())
    by_id = {f["id"]: f for f in kb["findings"]}

    merged = []
    used = set()
    for ci, cl in enumerate(clusters, 1):
        members = [by_id[i] for i in cl["member_ids"] if i in by_id]
        if not members:
            continue
        used.update(cl["member_ids"])
        creators, sources, applic, variants, vs, rec = set(), [], set(), [], [], []
        seen_src = set()
        for m in members:
            creators.update(m.get("creators", []))
            for s in m.get("sources", []):
                k = (s.get("video_id"), s.get("timestamp_seconds"))
                if k not in seen_src:
                    seen_src.add(k); sources.append(s)
            applic.update(m.get("applicability", []))
            variants.extend(m.get("variants", []))
            pc = m.get("palm_comparison", {})
            if pc.get("vs_us"): vs.append(pc["vs_us"])
            if pc.get("recommendation"): rec.append(pc["recommendation"])
        creators = sorted(c for c in creators if c and c != "unknown")
        merged.append({
            "id": f"f{ci:04d}",
            "department": cl.get("department") or members[0]["department"],
            "topic": members[0].get("topic", ""),
            "title": cl.get("canonical_title") or members[0]["title"],
            "variants": variants,
            "sources": sources,
            "creators": creators,
            "consensus": consensus(len(creators), False),
            "applicability": sorted(applic) or ["unknown"],
            "palm_comparison": {"vs_us": vs[0] if vs else "", "recommendation": rec[0] if rec else ""},
            "member_count": len(members),
        })

    # any findings the clusterer missed -> keep as singletons
    for fid, f in by_id.items():
        if fid not in used:
            f["member_count"] = 1
            merged.append(f)

    rank = {"high": 0, "medium": 1, "low": 2}
    merged.sort(key=lambda f: (rank[f["consensus"]["label"]], -len(f["creators"]), -len(f["sources"])))
    for i, f in enumerate(merged, 1):
        f["id"] = f"f{i:04d}"

    kb["findings"] = merged
    kb["departments_present"] = sorted({f["department"] for f in merged})
    KB.write_text(json.dumps(kb, indent=2))

    from collections import Counter
    cons = Counter(f["consensus"]["label"] for f in merged)
    print(f"merged into {len(merged)} findings | consensus: {dict(cons)}")


if __name__ == "__main__":
    main(sys.argv)
