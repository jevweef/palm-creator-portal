#!/usr/bin/env python3
"""
daily_brief.py — Produce the "what's new" research brief by diffing the current knowledge
base against the last snapshot, then snapshot the current state for next time.

A finding is keyed by (department + normalized title). On each run we detect:
  - NEW findings (key not in previous snapshot)
  - CONSENSUS RISERS (same key, consensus label went low→medium→high because another
    creator echoed the tactic) — the highest-signal event in the corpus
  - new SOURCE VIDEOS added to an existing finding (fresh evidence)

Output:
  research/digests/daily/<date>.json   — the brief (rendered as the "Today" view)
  research/knowledge/snapshots/<date>.json — snapshot of current findings for next diff

First run (no prior snapshot): the brief is the "inaugural corpus" — top consensus findings.

Usage:
  python3 scripts/daily_brief.py 2026-05-30        # date stamp required (no Date.now in env)
"""
import json, re, sys, glob, os
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
KBF = REPO / "research" / "knowledge" / "findings.json"
DAILY = REPO / "research" / "digests" / "daily"
SNAPS = REPO / "research" / "knowledge" / "snapshots"
RANK = {"high": 3, "medium": 2, "low": 1}


def key(f):
    t = re.sub(r"[^a-z0-9 ]", " ", (f.get("title") or "").lower())
    t = " ".join(t.split())
    return f"{f.get('department')}|{t}"


def latest_snapshot():
    snaps = sorted(SNAPS.glob("*.json"))
    return json.loads(snaps[-1].read_text()) if snaps else None


def main(argv):
    if len(argv) < 2:
        print("usage: daily_brief.py <YYYY-MM-DD>"); return 1
    date = argv[1]
    DAILY.mkdir(parents=True, exist_ok=True)
    SNAPS.mkdir(parents=True, exist_ok=True)

    kb = json.loads(KBF.read_text())
    findings = kb["findings"]
    cur = {key(f): f for f in findings}

    prev = latest_snapshot()
    new_findings, risers, evidence = [], [], []

    if prev is None:
        # Inaugural brief: surface the strongest consensus findings as "what we now know".
        inaugural = [f for f in findings if f["consensus"]["label"] in ("high", "medium")]
        inaugural.sort(key=lambda f: (-RANK[f["consensus"]["label"]], -len(f.get("sources", []))))
        brief = {
            "date": date, "kind": "inaugural",
            "headline": f"Research library launched: {len(findings)} findings from "
                        f"{len({c for f in findings for c in f.get('creators', [])})} OFM creators.",
            "new_findings": inaugural,  # day one: the whole consensus corpus is "new"
            "consensus_risers": [], "new_evidence": [],
            "totals": {"findings": len(findings),
                       "high": sum(1 for f in findings if f["consensus"]["label"] == "high"),
                       "medium": sum(1 for f in findings if f["consensus"]["label"] == "medium")},
        }
    else:
        prevmap = {key(f): f for f in prev.get("findings", [])}
        for k, f in cur.items():
            if k not in prevmap:
                new_findings.append(f)
                continue
            pf = prevmap[k]
            if RANK[f["consensus"]["label"]] > RANK[pf["consensus"]["label"]]:
                risers.append({**f, "_from": pf["consensus"]["label"], "_to": f["consensus"]["label"]})
            else:
                pv = {(s.get("video_id"), s.get("timestamp_seconds")) for s in pf.get("sources", [])}
                added = [s for s in f.get("sources", []) if (s.get("video_id"), s.get("timestamp_seconds")) not in pv]
                if added:
                    evidence.append({**f, "_new_sources": added})
        new_findings.sort(key=lambda f: (-RANK[f["consensus"]["label"]], -len(f.get("sources", []))))
        n_new, n_ris = len(new_findings), len(risers)
        headline = (f"{n_new} new finding(s), {n_ris} rose in consensus."
                    if (n_new or n_ris or evidence) else "No new findings since last run.")
        brief = {
            "date": date, "kind": "daily", "headline": headline,
            "new_findings": new_findings, "consensus_risers": risers, "new_evidence": evidence,
            "totals": {"findings": len(findings)},
        }

    (DAILY / f"{date}.json").write_text(json.dumps(brief, indent=2))
    (SNAPS / f"{date}.json").write_text(json.dumps({"date": date, "findings": findings}, indent=2))
    print(f"brief -> research/digests/daily/{date}.json  ({brief['kind']}: {brief['headline']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
