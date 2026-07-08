#!/usr/bin/env python3
"""
pax_delivery.py — "Pax", outbound delivery health (Telegram + Publer).

Read-only. Each morning, surface posts that failed or are stuck getting out the
door, and Publer accounts that can't publish (reauth/disabled). Distribution's
delivery watchdog. Faithful to docs/agent-org/specs/pax.md.

Owns delivery FAILURE detail (Sam keeps only a one-word hygiene count and defers
here). Telegram lane = real-creator content; Publer lane = AI accounts.

OPS base. Posts tblTEaiscTQQkEvj2, Publer Accounts tblGDhVY73UT2gLSW.

Usage:  python3 scripts/agents/pax_delivery.py [--days 14]
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone

from palm_agent import (airtable_token, get_meta, fetch_all,
                        finding, write_report, emit_error, offboarded_creators, name_map)

OPS = "applLIT2t83plMqNx"
T_POSTS = "tblTEaiscTQQkEvj2"
T_PUBLER = "tblGDhVY73UT2gLSW"


def preflight(token: str) -> list[str]:
    tables = {t["name"]: t for t in get_meta(token, OPS).get("tables", [])}
    problems = []
    if not tables.get("Posts"):
        problems.append("table `Posts` is gone/renamed")
    else:
        have = {f["name"] for f in tables["Posts"]["fields"]}
        problems += [f"Posts.`{f}` is gone/renamed" for f in ("Status", "Publer Status", "Scheduled Date") if f not in have]
    if not tables.get("Publer Accounts"):
        problems.append("table `Publer Accounts` is gone/renamed")
    return problems


def parse_dt(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def main(argv) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=14)
    args = ap.parse_args(argv[1:])

    token = airtable_token()
    problems = preflight(token)
    if problems:
        emit_error(id="pax", teammate="Pax", dept="Distribution", problems=problems)
        print("Pax: DATA CHANGED — " + "; ".join(problems), file=sys.stderr)
        return 1

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=args.days)
    posts = fetch_all(token, OPS, T_POSTS, ["Status", "Publer Status", "Pipeline Target", "Scheduled Date", "Telegram Sent At", "Creator", "Caption", "Post Name"])
    names = name_map(token, OPS, "Palm Creators")
    gone = offboarded_creators(token)

    # Evan's urgency ladder: a failure sitting under a week = amber note, a
    # week+ = urgent. Layman's terms: creator, what the post was, how long
    # it's been broken, where it lives (the Post Prep page).
    tg_failed, publer_failed, publer_stuck = [], 0, 0
    for r in posts:
        f = r.get("fields", {})
        who = ", ".join(names.get(c, "") for c in (f.get("Creator") or [])).strip(", ")
        if who and all(part.strip().lower() in gone for part in who.split(",") if part.strip()):
            continue  # offboarded creator — their old failures are noise
        sd = parse_dt(f.get("Scheduled Date"))
        recent = (sd is None) or (sd >= cutoff)
        if not recent:
            continue
        if "fail" in (f.get("Status") or "").lower():
            title = (f.get("Caption") or f.get("Post Name") or "?").strip()
            age = int((now - (sd or parse_dt(r["createdTime"]))).total_seconds() // 86400)
            when = (sd or parse_dt(r["createdTime"])).strftime("%b %-d")
            tg_failed.append({"who": who or "?", "title": title[:45], "when": when, "age": age})
        ps = f.get("Publer Status")
        if ps == "Failed":
            publer_failed += 1
        elif ps == "Submitting":
            publer_stuck += 1

    findings: list[dict] = []
    for x in sorted(tg_failed, key=lambda v: -v["age"]):
        line = (f"{x['who']}'s post from {x['when']} (\"{x['title']}\") never made it to her posting"
                f" channel on Telegram — it's been sitting failed on the Post Prep page for {x['age']} days."
                " Re-send it from there or delete it.")
        findings.append(finding(line, "red" if x["age"] >= 7 else "amber"))
    if publer_failed:
        findings.append(finding(f"{publer_failed} AI-account post(s) failed to publish through Publer in the last {args.days} days.", "red"))
    if publer_stuck:
        findings.append(finding(f"{publer_stuck} AI-account post(s) have been hung mid-publish in Publer — may need a re-submit.", "amber"))

    # Publer fleet health
    accts = fetch_all(token, OPS, T_PUBLER, ["Status", "Account Type", "Channel"])
    active = sum(1 for a in accts if a.get("fields", {}).get("Status") == "Active")
    reauth = sum(1 for a in accts if a.get("fields", {}).get("Status") == "Reauth Required")
    if reauth:
        findings.append(finding(f"{reauth} Publer account(s) need reauth — they can't publish until reconnected.", "amber"))

    dormant_note = ""
    if active == 0:
        dormant_note = f" Publer fleet dormant ({len(accts)} accounts, 0 Active) — Telegram lane is the live one."

    if not findings:
        findings.append(finding(f"Delivery healthy — no failed/stuck posts in {args.days}d.{dormant_note}", "green"))

    bad = any(x["urgency"] != "green" for x in findings)
    headline = (f"{len(tg_failed)+publer_failed} failed, {publer_stuck} stuck deliveries" if bad else "Delivery healthy")
    report = write_report(id="pax", teammate="Pax", dept="Distribution", tier="worker", reports_to="dana",
                          headline=headline, findings=findings,
                          notes=f"Telegram (real) + Publer (AI) delivery. Active Publer accounts: {active}.{dormant_note} Owns failure detail; Sam defers here.")
    print(f"Pax: {report['urgency'].upper()} — {headline}")
    for x in findings:
        print(f"  [{x['urgency']}] {x['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
