#!/usr/bin/env python3
"""
bea_inbox.py — "Bea", inbox-commitment monitor (read-only).

Keep Evan's extracted-commitment inbox trustworthy: surface urgent/aging open
tasks and detect if the extraction pipeline went dark. Reports up to Nova → Maya.
The auto-sweep + draft-reply actions are deferred (route auth) — Bea notifies only.

Verified: OPS Inbox Tasks tblsBAhyj4GmyFeO1 (Status/Owner/Urgency/Source Sent
At/Detected At/Topic). extract-tasks cron runs hourly 11-23,0-2 UTC.
Proposed: stale ≥2d (matches the UI chip).
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone

from palm_agent import (airtable_token, get_meta, fetch_all, finding,
                        write_report, emit_error, cfg)

OPS = "applLIT2t83plMqNx"
T_INBOX = "tblsBAhyj4GmyFeO1"
STALE_DAYS = cfg("bea", "STALE_DAYS", 2)
DARK_HOURS = cfg("bea", "DARK_HOURS", 36)


def preflight(token):
    tables = {t["name"]: t for t in get_meta(token, OPS).get("tables", [])}
    t = tables.get("Inbox Tasks")
    if not t:
        return ["OPS `Inbox Tasks` gone/renamed"]
    have = {f["name"] for f in t["fields"]}
    return [f"Inbox Tasks.`{x}`" for x in ("Status", "Owner", "Urgency", "Source Sent At", "Detected At") if x not in have]


def parse_dt(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def main():
    token = airtable_token()
    problems = preflight(token)
    if problems:
        emit_error(id="bea", teammate="Bea", dept="Intelligence", problems=problems)
        print("Bea: DATA CHANGED — " + "; ".join(problems), file=sys.stderr); return 1

    now = datetime.now(timezone.utc)
    rows = fetch_all(token, OPS, T_INBOX, ["Status", "Owner", "Urgency", "Source Sent At", "Detected At", "Creator AKA", "Task"])

    now_evan, stale, last_detect = [], [], None
    for r in rows:
        f = r.get("fields", {})
        det = parse_dt(f.get("Detected At"))
        if det and (last_detect is None or det > last_detect):
            last_detect = det
        if f.get("Status") != "Open":
            continue
        if f.get("Urgency") == "Now" and f.get("Owner") == "Evan":
            now_evan.append((f.get("Task") or "?")[:60])
        src = parse_dt(f.get("Source Sent At"))
        if src and (now - src).days >= STALE_DAYS:
            stale.append((f.get("Task") or "?")[:50])

    findings = []
    if now_evan:
        findings.append(finding(f"{len(now_evan)} urgent task(s) from your messages are still open. Oldest three: " + "; ".join(now_evan[:3]) + (f" — plus {len(now_evan) - 3} more on the dashboard." if len(now_evan) > 3 else "."), "red"))
    if stale:
        findings.append(finding(f"{len(stale)} task(s) have sat open for {STALE_DAYS}+ days without being closed (oldest: \"{stale[0]}\").", "amber"))
    # pipeline liveness: in the active extraction window, expect a detection within ~3h
    hour_utc = now.hour
    in_window = (11 <= hour_utc <= 23) or (0 <= hour_utc <= 2)
    if in_window:
        if last_detect is None or (now - last_detect).total_seconds() / 3600.0 > DARK_HOURS:
            ago = f"{(now-last_detect).total_seconds()/3600.0:.0f}h ago" if last_detect else "never"
            findings.append(finding(f"The system that turns your messages into tasks may have stopped — it last caught a task {ago}.", "amber"))
    if not findings:
        findings.append(finding("Inbox under control — nothing urgent open, nothing stale, extraction live.", "green"))

    bad = any(x["urgency"] != "green" for x in findings)
    headline = (f"{len(now_evan)} urgent open, {len(stale)} stale" if bad else "Inbox under control")
    rep = write_report(id="bea", teammate="Bea", dept="Intelligence", tier="worker", reports_to="nova",
                       headline=headline, findings=findings,
                       notes="Read-only via PAT. Auto-sweep + draft-reply deferred (route auth). Stale ≥2d matches the inbox UI chip.")
    print(f"Bea: {rep['urgency'].upper()} — {headline}")
    for x in findings:
        print(f"  [{x['urgency']}] {x['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
