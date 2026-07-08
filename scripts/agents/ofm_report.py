#!/usr/bin/env python3
"""
ofm_report.py — liveness reporter for the OFM research machine.

The OFM competitive-intelligence pipeline (scripts/daily_research.py) runs at
08:00 ET and writes its own run.log. This thin reporter reads that log and emits
the bus report Maya consumes — it does NOT touch the pipeline. The spec's key
signal is liveness: did the corpus actually refresh and push to dev today?
(docs/agent-org/specs/ofm-research.md — cloud-routine variant produced zero
pushes, so "did dev get a commit today?" is the real RED check.)

  green  = ran today AND pushed to dev (corpus fresh) — carries the run headline
  amber  = ran today but no push confirmation (corpus may not have updated)
  red    = no completed run today (pipeline dark)

Usage:  python3 scripts/agents/ofm_report.py
"""
from __future__ import annotations

import re
import sys
from datetime import date, datetime
from pathlib import Path

from palm_agent import finding, write_report

RUN_LOG = Path.home() / ".claude" / "scheduled-tasks" / "ofm-research" / "run.log"


def main() -> int:
    if not RUN_LOG.exists():
        write_report(id="ofm-research", teammate="OFM Intel", dept="Intelligence", status="error",
                     headline="OFM research run.log not found",
                     findings=[finding("No run.log at ~/.claude/scheduled-tasks/ofm-research/ — can't confirm it ran.", "red")],
                     notes="Liveness unknown.")
        print("OFM: run.log missing", file=sys.stderr)
        return 1

    ran_today = date.fromtimestamp(RUN_LOG.stat().st_mtime) == date.today()
    tail = "\n".join(RUN_LOG.read_text(encoding="utf-8", errors="replace").splitlines()[-60:])
    pushed = "PUSH OK" in tail
    hm = re.findall(r'"headline":\s*"([^"]+)"', tail)
    headline_txt = hm[-1] if hm else None

    if not ran_today:
        last = datetime.fromtimestamp(RUN_LOG.stat().st_mtime).strftime("%b %d %H:%M")
        findings = [finding(f"OFM research has not completed a run today — last activity {last}. Pipeline may be dark.", "red")]
        headline = "OFM research did not run today"
    elif not pushed:
        findings = [finding("OFM ran today but no 'PUSH OK' in the log — the dev corpus may not have updated (known cloud-push gap).", "amber")]
        headline = "OFM ran, dev push unconfirmed"
    else:
        msg = f"Corpus refreshed and pushed to dev today" + (f": {headline_txt}" if headline_txt else ".")
        findings = [finding(msg, "green")]
        headline = headline_txt or "Corpus refreshed"

    report = write_report(id="ofm-research", teammate="OFM Intel", dept="Intelligence", tier="worker", reports_to="nova",
                          headline=headline, findings=findings,
                          notes="Machine (deterministic research routine). Liveness read from run.log; green requires a confirmed dev push.")
    print(f"OFM: {report['urgency'].upper()} — {headline}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
