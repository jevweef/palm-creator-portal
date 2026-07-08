#!/usr/bin/env python3
"""
gil_reliability.py — "Gil", backend reliability watchdog.

Read-only. Confirm the portal's cron plumbing is internally consistent: every
Vercel cron in vercel.json points at a real route on disk, and every cron route
on disk is actually registered/scheduled. Surface only drift.

Faithful to docs/agent-org/specs/gil.md (deterministic half). Cron-execution
freshness + error-log scan need the Vercel MCP and are noted as a follow-up;
this run does the on-disk inventory check that catches a cron pointing at a
deleted route or a route nobody schedules.

Reads the live portal checkout (read-only file reads), not the clone.

Usage:  python3 scripts/agents/gil_reliability.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from palm_agent import finding, write_report

# Repo root — works on the Mac (portal checkout) and on GitHub Actions
_local = Path("/Users/jevanleith/palm-creator-portal")
PORTAL = _local if _local.exists() else Path(__file__).resolve().parents[2]


def main() -> int:
    vj = PORTAL / "vercel.json"
    cron_dir = PORTAL / "app" / "api" / "cron"
    findings: list[dict] = []

    if not vj.exists():
        write_report(id="gil", teammate="Gil", dept="Reliability", status="error",
                     headline="vercel.json not found", findings=[finding("vercel.json missing from portal checkout", "red")],
                     notes="Could not read the cron source of truth.")
        print("Gil: vercel.json missing", file=sys.stderr)
        return 1

    crons = json.loads(vj.read_text()).get("crons", [])
    registered = {}
    for c in crons:
        m = re.match(r"/api/cron/([^/]+)", c.get("path", ""))
        if m:
            registered.setdefault(m.group(1), []).append(c.get("schedule"))

    on_disk = {p.parent.name for p in cron_dir.glob("*/route.js")} if cron_dir.exists() else set()

    # cron registered but route missing -> RED
    for name in sorted(registered):
        if name not in on_disk:
            findings.append(finding(f"cron `{name}` is scheduled in vercel.json but has no app/api/cron/{name}/route.js — it will 404.", "red"))
    # route on disk but never scheduled -> AMBER
    for name in sorted(on_disk):
        if name not in registered:
            findings.append(finding(f"cron route `{name}` exists on disk but is NOT registered in vercel.json — it never runs.", "amber"))

    if not findings:
        findings.append(finding(
            f"All {len(registered)} Vercel crons map to a route on disk; no unregistered cron routes. ({len(crons)} schedules)", "green"))

    bad = any(x["urgency"] != "green" for x in findings)
    headline = f"{len(findings)} cron inventory issue(s)" if bad else f"All {len(registered)} crons wired correctly"
    report = write_report(id="gil", teammate="Gil", dept="Reliability", tier="solo", reports_to="maya",
                          headline=headline, findings=findings,
                          notes="On-disk cron inventory check. Runtime-freshness + error-log scan need the Vercel MCP — follow-up.")
    print(f"Gil: {report['urgency'].upper()} — {headline}")
    for x in findings:
        print(f"  [{x['urgency']}] {x['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
