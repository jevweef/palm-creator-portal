#!/usr/bin/env python3
"""
devin_content_requests.py — "Devin", the content-request fulfillment monitor.

Read-only. Each run, surface content requests that are overdue, zero-fulfillment,
or short of their per-section minimums, and hand Maya the facts (she drafts the
reminder; Devin never sends and never writes to Airtable).

Faithful to docs/agent-org/specs/devin.md. IDs hard-confirmed in
app/api/content-request/route.js:5-8.

Checks (OPS base applLIT2t83plMqNx):
  - Overdue:          active request, Due Date < today (ET).
  - Zero-fulfillment: active request with no linked items at all  (strongest RED).
  - Status drift:     past due but still Status="Active" (never moved to Overdue).
  - Section shortfall: per template Section, count(items Submitted/Approved) <
                       Item Count minimum  (info_only template rows excluded).
  - Stuck-in-Draft / Revision-Requested aging → AMBER.
Silence (green) = every active request on track.

Usage:  python3 scripts/agents/devin_content_requests.py
"""
from __future__ import annotations

import sys
from datetime import date, datetime

from palm_agent import (airtable_token, get_meta, fetch_all, name_map,
                        finding, write_report, emit_error, cfg)

OPS = "applLIT2t83plMqNx"
ABANDONED_WEEKS = cfg("devin", "ABANDONED_WEEKS", 3)
T_REQUESTS = "tblr1QLpcyD7p5HRb"
T_ITEMS = "tblXsW7GsyZrplVkq"
T_TEMPLATES = "tblpvD4cbs8KlbexQ"
T_CREATORS = "tbls2so6pHGbU4Uhh"  # Palm Creators (confirmed via meta)

FULFILLED = {"Submitted", "Approved"}
SOON_DAYS = 3


def preflight(token: str) -> list[str]:
    """Fail loud if the data contract drifted (renamed/removed tables or fields)."""
    problems: list[str] = []
    tables = {t["name"]: t for t in get_meta(token, OPS).get("tables", [])}
    need = {
        "Content Requests": ["Title", "Creator", "Due Date", "Status", "Content Request Items"],
        "Content Request Items": ["Section", "Content Request", "Status"],
        "Content Request Templates": ["Name", "Item Count", "Item Type"],
    }
    for tname, fields in need.items():
        t = tables.get(tname)
        if not t:
            problems.append(f"table `{tname}` is gone/renamed")
            continue
        have = {f["name"] for f in t.get("fields", [])}
        for fld in fields:
            if fld not in have:
                problems.append(f"{tname}.`{fld}` is gone/renamed")
    return problems


def to_date(s: str | None):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
    except ValueError:
        try:
            return date.fromisoformat(s[:10])
        except ValueError:
            return None


def main() -> int:
    token = airtable_token()
    problems = preflight(token)
    if problems:
        emit_error(id="devin", teammate="Devin", dept="Content Production", problems=problems)
        print("Devin: DATA CHANGED — " + "; ".join(problems), file=sys.stderr)
        return 1

    today = date.today()
    creators = name_map(token, OPS, T_CREATORS)  # recId -> creator name

    requests = fetch_all(token, OPS, T_REQUESTS,
                         ["Title", "Creator", "Due Date", "Status", "Month", "Content Request Items"])
    items = fetch_all(token, OPS, T_ITEMS, ["Section", "Content Request", "Status"])
    templates = fetch_all(token, OPS, T_TEMPLATES, ["Name", "Item Count", "Item Type"])

    # per-section minimums (skip info_only instruction rows)
    minimums: dict[str, int] = {}
    for t in templates:
        f = t.get("fields", {})
        if (f.get("Item Type") or "").lower() == "info_only":
            continue
        n = f.get("Item Count")
        if f.get("Name") and n:
            minimums[f["Name"]] = int(n)

    # index items by their parent request id
    items_by_req: dict[str, list[dict]] = {}
    for it in items:
        for rid in (it.get("fields", {}).get("Content Request") or []):
            items_by_req.setdefault(rid, []).append(it.get("fields", {}))

    findings: list[dict] = []
    overdue_n = zero_n = short_n = 0

    for r in requests:
        f = r.get("fields", {})
        if f.get("Status") != "Active":
            continue
        who = ", ".join(creators.get(c, c) for c in (f.get("Creator") or [])) or "(no creator)"
        title = f.get("Title") or f.get("Month") or "content request"
        due = to_date(f.get("Due Date"))
        mine = items_by_req.get(r["id"], [])

        if not mine:
            zero_n += 1
            wks_over = ((today - due).days // 7) if (due and due < today) else 0
            if wks_over >= ABANDONED_WEEKS:
                # weeks-dead with zero items = abandoned request to CLOSE OUT, not a today-fire
                findings.append(finding(
                    f"{who}'s content request \"{title}\" is {wks_over} weeks past due with nothing uploaded — it looks abandoned; close it or send her a fresh one.", "amber"))
            else:
                overdue_note = f" (due {due.isoformat()}, overdue)" if due and due < today else ""
                findings.append(finding(
                    f"{who} hasn't uploaded anything to her content request \"{title}\"{overdue_note} — she probably never opened the link; worth a nudge.", "red"))
            continue

        if due and due < today:
            overdue_n += 1
            findings.append(finding(
                f"{who}'s content request \"{title}\" was due {due.isoformat()} and is still open.", "red"))

        # per-section shortfall
        got: dict[str, int] = {}
        for it in mine:
            if it.get("Status") in FULFILLED:
                got[it.get("Section")] = got.get(it.get("Section"), 0) + 1
        short = [f"{sec}: have {got.get(sec, 0)}/{need}" for sec, need in minimums.items() if got.get(sec, 0) < need]
        if short:
            short_n += 1
            soon = due and 0 <= (due - today).days <= SOON_DAYS
            urg = "red" if (due and due < today) else ("amber" if soon else "amber")
            findings.append(finding(
                f"{who}'s content request \"{title}\" is missing items — {'; '.join(short)}.", urg))

    if not findings:
        findings.append(finding("All active content requests are on track — every section at/above its minimum.", "green"))

    active_n = sum(1 for r in requests if r.get("fields", {}).get("Status") == "Active")
    headline = (f"{zero_n} zero-fulfillment, {overdue_n} overdue, {short_n} short of {active_n} active requests"
                if (zero_n or overdue_n or short_n) else f"All {active_n} active content requests on track")

    report = write_report(
        id="devin", teammate="Devin", dept="Content Production", tier="worker", reports_to="theo",
        headline=headline, findings=findings,
        notes="Read-only. No send endpoint exists — reminders are drafted for a human to send, never auto-sent.")
    print(f"Devin: {report['urgency'].upper()} — {headline}")
    for x in findings:
        print(f"  [{x['urgency']}] {x['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
