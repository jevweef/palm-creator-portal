#!/usr/bin/env python3
"""
mara_review_triage.py — "Mara", admin review-queue triage.

Read-only. Surface edits that have waited too long in the admin review gate, and
detect when the same rejection note is being sent over and over (propose one
batched note). Faithful to docs/agent-org/specs/mara.md.

Checks (OPS Tasks tblXMh2UznOJMgxl6):
  - Aging in review: Status='Done' AND Admin Review Status='Pending Review',
    aged from Completed At. UI calls a task stale at >24h. RED at >72h.
  - Repeat rejection: recent 'Needs Revision' tasks whose Admin Feedback
    normalizes to the same string >=3x → propose one batched note (AMBER).
Silence (green) = queue is current and no rejection loop.

Usage:  python3 scripts/agents/mara_review_triage.py
"""
from __future__ import annotations

import re
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone

from palm_agent import (airtable_token, get_meta, fetch_all,
                        finding, write_report, emit_error, cfg)

OPS = "applLIT2t83plMqNx"
T_TASKS = "tblXMh2UznOJMgxl6"
T_ASSETS = "tblAPl8Pi5v1qmMNM"
STALE_H = cfg("mara", "STALE_H", 24)
RED_H = cfg("mara", "RED_H", 72)
REPEAT_MIN = cfg("mara", "REPEAT_MIN", 3)


def preflight(token: str) -> list[str]:
    tables = {t["name"]: t for t in get_meta(token, OPS).get("tables", [])}
    t = tables.get("Tasks")
    if not t:
        return ["table `Tasks` is gone/renamed"]
    have = {f["name"] for f in t.get("fields", [])}
    return [f"Tasks.`{fld}` is gone/renamed" for fld in
            ("Status", "Admin Review Status", "Completed At", "Admin Feedback") if fld not in have]


def parse_dt(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def main() -> int:
    token = airtable_token()
    problems = preflight(token)
    if problems:
        emit_error(id="mara", teammate="Mara", dept="Content Production", problems=problems)
        print("Mara: DATA CHANGED — " + "; ".join(problems), file=sys.stderr)
        return 1

    now = datetime.now(timezone.utc)
    ai_ids = {a["id"] for a in fetch_all(token, OPS, T_ASSETS, ["Source Type"])
              if a.get("fields", {}).get("Source Type") == "AI Generated"}
    rows = fetch_all(token, OPS, T_TASKS,
                     ["Status", "Admin Review Status", "Completed At", "Admin Feedback", "Submitted By Name", "Asset"])

    findings: list[dict] = []

    # --- aging in review, split REAL vs AI by the edited asset's type ---
    real = {"pending": 0, "stale": 0, "oldest": 0.0}
    ai = {"pending": 0, "stale": 0, "oldest": 0.0}
    for r in rows:
        f = r.get("fields", {})
        if f.get("Status") != "Done" or f.get("Admin Review Status") != "Pending Review":
            continue
        a = f.get("Asset") or []
        b = ai if (a and a[0] in ai_ids) else real
        b["pending"] += 1
        ct = parse_dt(f.get("Completed At"))
        if ct:
            age_h = (now - ct).total_seconds() / 3600.0
            if age_h >= STALE_H:
                b["stale"] += 1
                b["oldest"] = max(b["oldest"], age_h)

    def line(label, b):
        if not b["pending"]:
            return None
        sev = "red" if b["oldest"] >= RED_H else ("amber" if b["stale"] else "green")
        agetxt = f", oldest {b['oldest']/24:.1f}d" if b["stale"] else ""
        return finding(f"{label}: {b['stale']} of {b['pending']} waiting >{STALE_H}h{agetxt}.", sev)
    for ln in (line("Real edits awaiting review", real), line("AI edits awaiting review", ai)):
        if ln:
            findings.append(ln)

    # --- repeat-rejection clusters ---
    since = now - timedelta(days=14)
    fb = Counter()
    for r in rows:
        f = r.get("fields", {})
        if f.get("Admin Review Status") == "Needs Revision":
            ct = parse_dt(f.get("Completed At"))
            if (ct is None or ct >= since) and f.get("Admin Feedback"):
                fb[norm(f["Admin Feedback"])] += 1
    for note, n in fb.most_common(3):
        if n >= REPEAT_MIN:
            snippet = note[:90] + ("…" if len(note) > 90 else "")
            findings.append(finding(
                f"Same rejection note sent {n}x in 14d: \"{snippet}\" — propose a single batched note to the editors.", "amber"))

    if not findings:
        findings.append(finding(f"Review queue current — nothing waiting >{STALE_H}h, no repeated rejections.", "green"))

    headline = (f"{real['stale']} real + {ai['stale']} AI edits aging in review"
                + (", repeat-rejection loop" if any('rejection note' in x['text'] for x in findings) else "")
                if any(x["urgency"] != "green" for x in findings) else "Review queue current")
    report = write_report(id="mara", teammate="Mara", dept="Content Production", tier="worker", reports_to="theo",
                          headline=headline, findings=findings,
                          notes="Read-only. Aged from Completed At (no submit-for-review timestamp exists). Stale>24h per the review UI.")
    print(f"Mara: {report['urgency'].upper()} — {headline}")
    for x in findings:
        print(f"  [{x['urgency']}] {x['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
