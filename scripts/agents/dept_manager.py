#!/usr/bin/env python3
"""
dept_manager.py — generic department-head roll-up (read-only).

A manager doesn't re-compute; it reads its workers' reports off the bus, escalates
the red/amber items upward (attributed to the worker), notes any worker that
didn't report, and emits ONE department report (tier=manager) for Maya. This is
how the middle-management layer keeps Maya's brief organized by department without
each worker reporting to her directly.

Usage:
  python3 dept_manager.py --id theo --teammate Theo --dept "Content Production" \
      --workers jordan,mara,devin

Runs AFTER the workers (08:30-08:41) and BEFORE Maya (08:45).
"""
from __future__ import annotations

import argparse
import sys

from palm_agent import read_reports, rollup_findings, finding, write_report

WORKER_NAMES = {  # id -> display, for the "didn't report" note
    "sam-quota": "Sam", "jerry": "Jerry", "devin": "Devin",
    "riley": "Riley", "olive": "Olive", "quinn": "Quinn", "wendy": "Wendy",
    "ed": "Ed", "ivy": "Ivy", "nico": "Nico", "bea": "Bea", "ana": "Ana",
    "ofm-research": "OFM Intel", "charts": "Charts", "cleo": "Cleo", "wes": "Wes",
    "pax": "Pax", "cody": "Cody", "penny": "Penny",
}


def main(argv) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", required=True)
    ap.add_argument("--teammate", required=True)
    ap.add_argument("--dept", required=True)
    ap.add_argument("--workers", required=True, help="comma-separated worker ids")
    args = ap.parse_args(argv[1:])

    worker_ids = [w.strip() for w in args.workers.split(",") if w.strip()]
    reports = read_reports(worker_ids)

    findings = []
    # escalate red/amber worker findings, attributed
    findings += rollup_findings(reports)

    # health counts + missing-worker accountability
    reds = sum(1 for r in reports.values() if r.get("urgency") == "red")
    ambers = sum(1 for r in reports.values() if r.get("urgency") == "amber")
    greens = sum(1 for r in reports.values() if r.get("urgency") == "green")
    errored = [WORKER_NAMES.get(i, i) for i, r in reports.items() if r.get("status") == "error"]
    missing = [WORKER_NAMES.get(w, w) for w in worker_ids if w not in reports]

    if errored:
        findings.append(finding(f"{', '.join(errored)} hit a data-contract error this run (numbers untrusted).", "red"))
    if missing:
        findings.append(finding(f"No report today from: {', '.join(missing)} (didn't run or crashed).", "amber"))

    if not findings:
        findings.append(finding(f"{args.dept}: all {greens} teammates green — nothing to escalate.", "green"))

    bad = any(x["urgency"] != "green" for x in findings)
    headline = (f"{args.dept}: {reds} red, {ambers} amber across {len(reports)}/{len(worker_ids)} teammates"
                if bad else f"{args.dept}: all clear ({greens} teammates green)")
    rep = write_report(id=args.id, teammate=args.teammate, dept=args.dept, tier="manager",
                       reports_to="maya", headline=headline, findings=findings,
                       notes=f"Department roll-up of {', '.join(WORKER_NAMES.get(w, w) for w in worker_ids)}. Read-only.")
    print(f"{args.teammate}: {rep['urgency'].upper()} — {headline}")
    for x in findings:
        print(f"  [{x['urgency']}] {x['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
