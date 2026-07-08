#!/usr/bin/env python3
"""
editing_desk.py — "Editing", the whole editing cycle in ONE employee.

Merges the old Jordan (production vs quota) + Mara (review backlog) into one, so
you get the full belt in one place:
    produced vs quota  →  waiting for review  →  repeat-rejection loops
split REAL vs AI, per creator. Uses the same definitions as the SM-hub Content
Movement chart (real = non-AI asset; per managed creator) so the numbers line up,
and adds the quota comparison + staleness + AI split the chart doesn't show.

Reports up to Theo → Maya. Read-only.
Daily target per creator = that creator's Weekly Reel Quota / 7 (read live).
"""
from __future__ import annotations

import re
import sys
from collections import defaultdict, Counter
from datetime import datetime, timezone, timedelta

from palm_agent import (airtable_token, get_meta, fetch_all,
                        finding, write_report, emit_error, cfg)

OPS = "applLIT2t83plMqNx"
T_TASKS = "tblXMh2UznOJMgxl6"
T_ASSETS = "tblAPl8Pi5v1qmMNM"
T_PALM = "tbls2so6pHGbU4Uhh"
STALE_H = cfg("jerry", "STALE_H", 24)
RED_H = cfg("jerry", "RED_H", 72)
REPEAT_MIN = cfg("jerry", "REPEAT_MIN", 3)


def preflight(token):
    t = {x["name"]: x for x in get_meta(token, OPS).get("tables", [])}.get("Tasks")
    if not t:
        return ["Tasks gone/renamed"]
    have = {f["name"] for f in t["fields"]}
    return [f"Tasks.`{x}`" for x in ("Status", "Admin Review Status", "Completed At", "Asset", "Creator") if x not in have]


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
        emit_error(id="jerry", teammate="Jerry", dept="Content Production", problems=problems)
        print("Jerry: DATA CHANGED — " + "; ".join(problems), file=sys.stderr); return 1

    ai_ids = {a["id"] for a in fetch_all(token, OPS, T_ASSETS, ["Source Type"])
              if a.get("fields", {}).get("Source Type") == "AI Generated"}
    managed, quota_day = {}, {}
    for r in fetch_all(token, OPS, T_PALM, ["Creator", "Status", "Social Media Editing", "Weekly Reel Quota"]):
        f = r.get("fields", {})
        if f.get("Status") == "Active" and f.get("Social Media Editing"):
            managed[r["id"]] = f.get("Creator") or "?"
            wk = f.get("Weekly Reel Quota") or 0
            quota_day[r["id"]] = round(wk / 7) if wk else 0
    expected_day = sum(quota_day.values())

    now = datetime.now(timezone.utc)
    today = now.date()
    yesterday = today - timedelta(days=1)
    win14 = today - timedelta(days=14)

    recent = fetch_all(token, OPS, T_TASKS,
                       ["Completed At", "Asset", "Creator", "Admin Review Status", "Admin Feedback"],
                       f"IS_AFTER({{Completed At}}, '{win14.isoformat()}')")
    pending = fetch_all(token, OPS, T_TASKS,
                        ["Completed At", "Asset", "Creator"],
                        "{Admin Review Status} = 'Pending Review'")

    def is_ai(f):
        a = f.get("Asset") or []
        return bool(a) and a[0] in ai_ids

    # ---- 1. PRODUCED (yesterday + 7d) ----
    real_by_creator = defaultdict(int)
    ai_yest = real_7d = ai_7d = 0
    for r in recent:
        f = r.get("fields", {})
        d = parse_dt(f.get("Completed At"))
        d = d.date() if d else None
        if not d:
            continue
        ai = is_ai(f)
        if d > today - timedelta(days=7):
            ai_7d += 1 if ai else 0
            real_7d += 0 if ai else 1
        if d == yesterday:
            if ai:
                ai_yest += 1
            else:
                for cid in (f.get("Creator") or []):
                    if cid in managed:
                        real_by_creator[cid] += 1
    real_yest = sum(real_by_creator.values())

    # ---- 2. WAITING FOR REVIEW (real managed / AI) ----
    real_rev = {"n": 0, "stale": 0, "oldest": 0.0}
    ai_rev = {"n": 0, "stale": 0, "oldest": 0.0}
    for r in pending:
        f = r.get("fields", {})
        ai = is_ai(f)
        if not ai and not any(cid in managed for cid in (f.get("Creator") or [])):
            continue  # ignore real edits not tied to a managed creator (matches the chart)
        b = ai_rev if ai else real_rev
        b["n"] += 1
        ct = parse_dt(f.get("Completed At"))
        if ct:
            age = (now - ct).total_seconds() / 3600.0
            if age >= STALE_H:
                b["stale"] += 1
                b["oldest"] = max(b["oldest"], age)

    findings = []

    # production finding
    short = [f"{managed[c]} {real_by_creator.get(c,0)}/{quota_day[c]}" for c in quota_day if real_by_creator.get(c, 0) < quota_day[c]]
    if expected_day > 0:
        sev = "green" if real_yest >= expected_day else ("red" if real_yest < expected_day * 0.5 else "amber")
        tail = (" Behind: " + "; ".join(short) + ".") if short else " Every creator got their full count."
        findings.append(finding(f"The editors finished {real_yest} of the {expected_day} videos due yesterday.{tail} (AI videos finished: {ai_yest})", sev))

    # review findings
    def rev_line(label, b):
        if not b["n"]:
            return None
        sev = "red" if b["oldest"] >= RED_H else ("amber" if b["stale"] else "green")
        agetxt = f" — the oldest has waited {b['oldest']/24:.0f} days" if b["stale"] else ""
        return finding(f"{b['n']} finished {label.lower()} are waiting for YOUR approval on the review page; {b['stale']} have sat more than a day{agetxt}. https://app.palm-mgmt.com/admin/social?tab=content&sub=review", sev)
    for ln in (rev_line("Real edits", real_rev), rev_line("AI edits", ai_rev)):
        if ln:
            findings.append(ln)

    # repeat-rejection clusters
    fb = Counter()
    for r in recent:
        f = r.get("fields", {})
        if f.get("Admin Review Status") == "Needs Revision" and f.get("Admin Feedback"):
            fb[re.sub(r"\s+", " ", f["Admin Feedback"].strip().lower())] += 1
    for note, n in fb.most_common(2):
        if n >= REPEAT_MIN:
            snip = note[:90] + ("…" if len(note) > 90 else "")
            findings.append(finding(f"Same rejection note sent {n}x in 14d: \"{snip}\" — send one batched note.", "amber"))

    if not findings:
        findings.append(finding("Editing pipeline healthy — production on quota, review queue clear.", "green"))

    bad = any(x["urgency"] != "green" for x in findings)
    headline = (f"Produced {real_yest}/{expected_day}; review backlog {real_rev['stale']} real + {ai_rev['stale']} AI"
                if bad else f"Editing healthy — {real_yest}/{expected_day} produced, review queue clear")
    rep = write_report(id="jerry", teammate="Jerry", dept="Content Production", tier="worker", reports_to="theo",
                       headline=headline, findings=findings,
                       notes=(f"Whole editing cycle (was Jordan+Mara). Daily target = Weekly Reel Quota/7 per creator. "
                              f"Last 7d: {real_7d} real edits, {ai_7d} AI. Real scoped to managed creators (matches the "
                              f"Content Movement chart). Stale>{STALE_H}h, red>{RED_H}h."))
    print(f"Jerry: {rep['urgency'].upper()} — {headline}")
    for x in findings:
        print(f"  [{x['urgency']}] {x['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
