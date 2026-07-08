#!/usr/bin/env python3
"""
nico_inspo.py — "Nico", inspo-pipeline health monitor.

Read-only. Watch the pipeline that grades source reels into per-creator
inspiration and surface only what's broken or under-fed: errored sources, a
stuck grading flow, an unscored backlog, or the whole pipeline going dry.
Faithful to docs/agent-org/specs/nico.md.

OPS base. Inspiration tblnQhATaMtpoYErb, Source Reels tbl8oOEYRagarULgD,
Inspo Sources tblH0K1xMsBonqmMx.

Proposed thresholds (confirm with Evan): dry = 0 new inspo saved in 7d;
unscored backlog flagged at >50 Source Reels Pending Review.

Usage:  python3 scripts/agents/nico_inspo.py
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone

from palm_agent import (airtable_token, get_meta, fetch_all,
                        finding, write_report, emit_error)

OPS = "applLIT2t83plMqNx"
T_INSPO = "tblnQhATaMtpoYErb"
T_SOURCE_REELS = "tbl8oOEYRagarULgD"
T_SOURCES = "tblH0K1xMsBonqmMx"
DRY_DAYS = 7
BACKLOG = 50


def preflight(token: str) -> list[str]:
    tables = {t["name"]: t for t in get_meta(token, OPS).get("tables", [])}
    need = {"Inspiration": ["Status", "Date Saved"], "Source Reels": ["Review Status", "Date Saved"],
            "Inspo Sources": ["Pipeline Status", "Account Status"]}
    problems = []
    for tname, flds in need.items():
        t = tables.get(tname)
        if not t:
            problems.append(f"table `{tname}` is gone/renamed"); continue
        have = {f["name"] for f in t.get("fields", [])}
        problems += [f"{tname}.`{f}` is gone/renamed" for f in flds if f not in have]
    return problems


def parse_dt(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def main() -> int:
    token = airtable_token()
    problems = preflight(token)
    if problems:
        emit_error(id="nico", teammate="Nico", dept="Intelligence", problems=problems)
        print("Nico: DATA CHANGED — " + "; ".join(problems), file=sys.stderr)
        return 1

    now = datetime.now(timezone.utc)
    since = now - timedelta(days=DRY_DAYS)
    findings: list[dict] = []

    inspo = fetch_all(token, OPS, T_INSPO, ["Status", "Date Saved"])
    by_status: dict[str, int] = {}
    new_inspo = 0
    for r in inspo:
        f = r.get("fields", {})
        by_status[f.get("Status")] = by_status.get(f.get("Status"), 0) + 1
        d = parse_dt(f.get("Date Saved"))
        if d and d >= since:
            new_inspo += 1
    errored = by_status.get("Error", 0)
    if errored:
        findings.append(finding(f"{errored} inspiration rows stuck in Error status — analysis failed on them.", "amber"))
    if new_inspo == 0:
        findings.append(finding(f"No new inspiration saved in {DRY_DAYS}d — scouting/grading pipeline looks dry.", "amber"))

    reels = fetch_all(token, OPS, T_SOURCE_REELS, ["Review Status", "Date Saved"])
    pending = sum(1 for r in reels if r.get("fields", {}).get("Review Status") == "Pending Review")
    if pending > BACKLOG:
        findings.append(finding(f"{pending} Source Reels awaiting scoring (Pending Review) — grading backlog building.", "amber"))

    sources = fetch_all(token, OPS, T_SOURCES, ["Pipeline Status", "Account Status"])
    src_err = sum(1 for s in sources if s.get("fields", {}).get("Pipeline Status") == "Error")
    active_src = sum(1 for s in sources if s.get("fields", {}).get("Account Status") == "Active")
    if src_err:
        findings.append(finding(f"{src_err} inspo source(s) in Error — scraper failing on them (of {active_src} active).", "amber"))

    if not findings:
        findings.append(finding(
            f"Inspo pipeline healthy — {new_inspo} new in {DRY_DAYS}d, {pending} awaiting score, {active_src} active sources, no errors.", "green"))

    bad = any(x["urgency"] != "green" for x in findings)
    headline = f"{len(findings)} inspo-pipeline issue(s)" if bad else "Inspo pipeline healthy"
    report = write_report(id="nico", teammate="Nico", dept="Intelligence", tier="worker", reports_to="nova",
                          headline=headline, findings=findings,
                          notes=f"Read-only. Counts: inspo by status {by_status}. Thresholds proposed (dry={DRY_DAYS}d, backlog>{BACKLOG}).")
    print(f"Nico: {report['urgency'].upper()} — {headline}")
    for x in findings:
        print(f"  [{x['urgency']}] {x['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
