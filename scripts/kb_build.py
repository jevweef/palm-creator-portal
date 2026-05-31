#!/usr/bin/env python3
"""
kb_build.py — Merge per-run synthesis digests into the corpus knowledge base, clustering
findings that express the same tactic across creators and computing consensus-based confidence.

Inputs:
  research/digests/runs/*.json   — per-run synthesis output. Each finding:
      { department, topic, title, claim, what_they_do, vs_us, recommendation,
        applicability, sources:[{video_id, timestamp_seconds, quote}] }
  research/meta/*.json           — per-video stats (id -> channel, channel_id, subs, ...)

Output:
  research/knowledge/findings.json — merged corpus. Each finding:
      { id, department, topic, title, variants[], sources[], creators[],
        consensus:{creators, label, contested}, applicability[], palm_comparison }

Consensus (consensus-only): score by # of DISTINCT creators (channels) asserting the same
claim. >=3 -> high, 2 -> medium, 1 -> low. Conflicting variants -> contested (capped at medium).
"Distinct creator" = distinct channel.

Usage:
  python3 scripts/kb_build.py            # rebuild findings.json from all runs
  python3 scripts/kb_build.py --stats    # print corpus stats
"""
from __future__ import annotations
import glob, json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
RUNS = REPO / "research" / "digests" / "runs"
META = REPO / "research" / "meta"
KB = REPO / "research" / "knowledge"
FINDINGS = KB / "findings.json"

# Match threshold: two claims cluster if their content-word overlap coefficient is >= this.
MATCH = 0.34

# Stopwords + generic OFM filler dropped before similarity (so two agents describing the
# same tactic match on content words — ppv, escalate, whale, reddit — not filler).
_STOP = set("""a an the to of for and or but in on at by with from as is are be that this
your you we our they their it its how why what when into not no only just more most can will
should would could than then so if do does did get got make made use using used way ways
new best top via per each every both also dont""".split())
_FILLER = set("""ofm onlyfans creator creators model models agency agencies fan fans content
account accounts month months day days money making scale scaling grow growing business
video videos""".split())


def norm(s: str) -> set[str]:
    toks = re.sub(r"[^a-z0-9 ]", " ", (s or "").lower()).split()
    return {t for t in toks if t not in _STOP and t not in _FILLER and len(t) > 2}


def overlap(a: set[str], b: set[str]) -> float:
    return len(a & b) / min(len(a), len(b)) if a and b else 0.0


def load_meta() -> dict:
    stats = {}
    for f in META.glob("*.json"):
        try:
            arr = json.loads(f.read_text())
        except Exception:
            continue
        if isinstance(arr, list):
            for v in arr:
                if v and v.get("id"):
                    stats[v["id"]] = v
    return stats


def creator_of(src: dict, stats: dict) -> str:
    v = stats.get(src.get("video_id"), {})
    return v.get("channel") or src.get("channel_id") or "unknown"


def load_runs() -> list[dict]:
    out = []
    for f in sorted(RUNS.glob("*.json")):
        try:
            data = json.loads(f.read_text())
        except Exception:
            continue
        for it in data.get("findings", []):
            it["_run"] = f.stem
            out.append(it)
    return out


def consensus(n: int, contested: bool) -> dict:
    label = "high" if n >= 3 else "medium" if n == 2 else "low"
    if contested and label == "high":
        label = "medium"
    return {"creators": n, "label": label, "contested": contested}


def build(stats: dict) -> dict:
    clusters: list[dict] = []
    for fnd in load_runs():
        dept = fnd.get("department", "uncategorized")
        claim = fnd.get("claim") or fnd.get("title") or ""
        toks = norm(claim)
        match = None
        best = MATCH
        for c in clusters:
            if c["department"] != dept:
                continue
            ov = overlap(c["_toks"], toks)
            if ov >= best:
                best, match = ov, c
        if match is None:
            match = {
                "department": dept, "_toks": set(toks),
                "title": fnd.get("title") or claim[:80], "topic": fnd.get("topic", ""),
                "variants": [], "sources": [], "creators": set(),
                "applicability": set(), "vs_us": [], "recommendation": [],
            }
            clusters.append(match)
        else:
            match["_toks"] |= toks  # grow the cluster's vocabulary
        match["variants"].append({"claim": claim, "what_they_do": fnd.get("what_they_do", ""),
                                  "run": fnd.get("_run")})
        for s in fnd.get("sources", []):
            match["sources"].append(s)
            match["creators"].add(creator_of(s, stats))
        if fnd.get("applicability"):
            match["applicability"].add(fnd["applicability"])
        if fnd.get("vs_us"):
            match["vs_us"].append(fnd["vs_us"])
        if fnd.get("recommendation"):
            match["recommendation"].append(fnd["recommendation"])

    out = []
    for i, c in enumerate(clusters):
        creators = sorted(x for x in c["creators"] if x and x != "unknown")
        contested = len({v["claim"].lower().strip() for v in c["variants"]}) > 1 and len(c["variants"]) > 2
        seen, srcs = set(), []
        for s in c["sources"]:
            k = (s.get("video_id"), s.get("timestamp_seconds"))
            if k not in seen:
                seen.add(k); srcs.append(s)
        out.append({
            "id": f"f{i+1:04d}", "department": c["department"], "topic": c["topic"],
            "title": c["title"], "variants": c["variants"], "sources": srcs,
            "creators": creators, "consensus": consensus(len(creators), contested),
            "applicability": sorted(c["applicability"]) or ["unknown"],
            "palm_comparison": {"vs_us": c["vs_us"][0] if c["vs_us"] else "",
                                "recommendation": c["recommendation"][0] if c["recommendation"] else ""},
        })
    rank = {"high": 0, "medium": 1, "low": 2}
    out.sort(key=lambda f: (rank[f["consensus"]["label"]], -len(f["sources"])))
    return {"findings": out, "departments_present": sorted({f["department"] for f in out})}


def main(argv):
    KB.mkdir(parents=True, exist_ok=True)
    RUNS.mkdir(parents=True, exist_ok=True)
    kb = build(load_meta())
    if "--stats" in argv:
        from collections import Counter
        dept = Counter(f["department"] for f in kb["findings"])
        cons = Counter(f["consensus"]["label"] for f in kb["findings"])
        print("findings:", len(kb["findings"]))
        print("by department:", dict(dept))
        print("by consensus:", dict(cons))
        return 0
    FINDINGS.write_text(json.dumps(kb, indent=2), encoding="utf-8")
    print(f"wrote {len(kb['findings'])} merged findings -> research/knowledge/findings.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
