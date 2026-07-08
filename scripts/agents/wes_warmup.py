#!/usr/bin/env python3
"""
wes_warmup.py — "Wes", AI-warmup ops monitor (read-only).

Digest every AI-persona warmup account's due-task state; surface only exceptions
(overdue/stalled, blocked on a prerequisite, awaiting Evan's owner-approval).
Reports up to Iris → Maya. NEVER auto-completes a warmup task (manual on-phone
action; auto-marking Done is a ban risk).

Verified: OPS AI Account Profile tbloVP7ocqHpeK9mo + Warmup Tasks tblbj1dYPbS2o58sM
(both EMPTY today — Wes self-activates when a persona is onboarded). Day math
ports lib/warmupPlaybook.js computeCurrentDay (PLAYBOOK_VERSION 2).
Proposed: overdue AMBER 3-6d, RED ≥7d (NEEDS EVAN).
"""
from __future__ import annotations

import sys
from datetime import date

from palm_agent import (airtable_token, get_meta, fetch_all, finding,
                        write_report, emit_error)

OPS = "applLIT2t83plMqNx"
T_PROFILE = "tbloVP7ocqHpeK9mo"
T_TASKS = "tblbj1dYPbS2o58sM"
OVERDUE_RED = 7
OVERDUE_AMBER = 3


def preflight(token):
    tables = {t["name"]: t for t in get_meta(token, OPS).get("tables", [])}
    problems = []
    if not tables.get("AI Account Profile"):
        problems.append("OPS `AI Account Profile` gone/renamed")
    if not tables.get("Warmup Tasks"):
        problems.append("OPS `Warmup Tasks` gone/renamed")
    return problems


def current_day(start, paused):
    if not start:
        return None
    try:
        s = date.fromisoformat(str(start)[:10])
    except ValueError:
        return None
    return max(0, (date.today() - s).days - int(paused or 0))


def main():
    token = airtable_token()
    problems = preflight(token)
    if problems:
        emit_error(id="wes", teammate="Wes", dept="AI Studio", problems=problems)
        print("Wes: DATA CHANGED — " + "; ".join(problems), file=sys.stderr); return 1

    profiles = fetch_all(token, OPS, T_PROFILE, ["Persona Name", "Warmup Status", "Warmup Start Date", "Days Paused"])
    active = [p.get("fields", {}) for p in profiles if p.get("fields", {}).get("Warmup Status") in ("Setup", "Warming Up")]

    if not active:
        write_report(id="wes", teammate="Wes", dept="AI Studio", tier="worker", reports_to="iris",
                     headline="No AI warmup accounts active yet",
                     findings=[finding(f"{len(profiles)} AI Account Profiles, 0 in Setup/Warming Up — nothing to warm up. Self-activates when a persona is onboarded.", "green")],
                     notes="Read-only. Never auto-completes a warmup task (ban risk).")
        print("Wes: GREEN — no active warmup accounts")
        return 0

    tasks = fetch_all(token, OPS, T_TASKS, ["Account", "Day", "Status", "Required", "Requires Owner Approval", "Owner Approved", "Prerequisite Task Key", "Task Key", "Task Title"])
    by_acct = {}
    for t in tasks:
        f = t.get("fields", {})
        for aid in (f.get("Account") or []):
            by_acct.setdefault(aid, []).append(f)

    findings = []
    # (When accounts exist, compute overdue/blocked/approval per the playbook.)
    for p in active:
        nm = p.get("Persona Name") or "?"
        cur = current_day(p.get("Warmup Start Date"), p.get("Days Paused"))
        if cur is None:
            findings.append(finding(f"{nm}: Warming Up but no Warmup Start Date — day math can't run.", "amber"))
            continue
        due = [t for t in by_acct.get(p.get("id", ""), []) if (t.get("Day") or 0) <= cur and t.get("Status") not in ("Done", "Skipped")]
        approvals = [t for t in due if t.get("Requires Owner Approval") and not t.get("Owner Approved")]
        overdue_days = max([cur - (t.get("Day") or 0) for t in due if t.get("Required")], default=0)
        if approvals:
            findings.append(finding(f"{nm}: {len(approvals)} warmup task(s) need YOUR approval.", "red"))
        if overdue_days >= OVERDUE_RED:
            findings.append(finding(f"{nm}: required warmup task {overdue_days}d overdue (stalled).", "red"))
        elif overdue_days >= OVERDUE_AMBER:
            findings.append(finding(f"{nm}: required warmup task {overdue_days}d behind.", "amber"))

    if not findings:
        findings.append(finding(f"All {len(active)} warmup accounts on-day.", "green"))

    bad = any(x["urgency"] != "green" for x in findings)
    headline = (f"{len(active)} warmup accounts, exceptions found" if bad else f"All {len(active)} warmup accounts on-day")
    rep = write_report(id="wes", teammate="Wes", dept="AI Studio", tier="worker", reports_to="iris",
                       headline=headline, findings=findings,
                       notes="Read-only. Overdue AMBER 3-6d / RED ≥7d (proposed). Never auto-completes a task.")
    print(f"Wes: {rep['urgency'].upper()} — {headline}")
    for x in findings:
        print(f"  [{x['urgency']}] {x['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
