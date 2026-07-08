#!/usr/bin/env python3
"""
jordan_editor_qa.py — "Jordan", editing-output monitor (read-only).

Tells you how much editing actually got done vs what's expected, split into:
  - REAL editing (the human "editor" role, e.g. Thomas) — edits on real creator
    content. Expected/day = 3 edits x (# creators with Social Media management ON).
    4 managed -> 12/day expected.
  - AI editing (the AI editor path) — edits on AI-generated content. Counted, no
    target yet (it's ramping up).

Classification is by WHAT was edited: a task whose linked Asset is Source Type
'AI Generated' = an AI edit; otherwise a real edit. (Verified: the human editor's
edits are 100% real assets; the AI path's are 100% AI assets.)

Reports up to Theo -> Maya. Read-only. Faithful to docs/agent-org/specs/jordan.md.
Proposed: 3 edits/creator/day (NEEDS EVAN, in config.json).
"""
from __future__ import annotations

import sys
from collections import defaultdict
from datetime import datetime, timezone, timedelta

from palm_agent import (airtable_token, get_meta, fetch_all,
                        finding, write_report, emit_error, cfg)

OPS = "applLIT2t83plMqNx"
T_TASKS = "tblXMh2UznOJMgxl6"
T_ASSETS = "tblAPl8Pi5v1qmMNM"
T_PALM = "tbls2so6pHGbU4Uhh"
PER_CREATOR_PER_DAY = cfg("jordan", "EDITS_PER_CREATOR_PER_DAY", 3)


def preflight(token):
    tables = {t["name"]: t for t in get_meta(token, OPS).get("tables", [])}
    t = tables.get("Tasks")
    if not t:
        return ["Tasks gone/renamed"]
    have = {f["name"] for f in t["fields"]}
    return [f"Tasks.`{x}`" for x in ("Submitted By Name", "Completed At", "Asset") if x not in have]


def day_of(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def main():
    token = airtable_token()
    problems = preflight(token)
    if problems:
        emit_error(id="jordan", teammate="Jordan", dept="Content Production", problems=problems)
        print("Jordan: DATA CHANGED — " + "; ".join(problems), file=sys.stderr); return 1

    # AI-generated asset ids → used to split AI edits from real edits
    ai_ids = {a["id"] for a in fetch_all(token, OPS, T_ASSETS, ["Source Type"])
              if a.get("fields", {}).get("Source Type") == "AI Generated"}

    # managed creators + their SET quota (read it, don't assume). Daily target per
    # creator = Weekly Reel Quota / 7.
    quota_day = {}   # creator recId -> rounded daily edit target
    cname = {}
    for r in fetch_all(token, OPS, T_PALM, ["Creator", "Status", "Social Media Editing", "Weekly Reel Quota"]):
        f = r.get("fields", {})
        if f.get("Status") == "Active" and f.get("Social Media Editing"):
            cname[r["id"]] = f.get("Creator") or "?"
            wk = f.get("Weekly Reel Quota") or 0
            quota_day[r["id"]] = round(wk / 7) if wk else 0
    expected_day = sum(quota_day.values())

    today = datetime.now(timezone.utc).date()
    yesterday = today - timedelta(days=1)
    win7 = today - timedelta(days=7)

    rows = fetch_all(token, OPS, T_TASKS, ["Submitted By Name", "Completed At", "Asset", "Creator"],
                     f"IS_AFTER({{Completed At}}, '{win7.isoformat()}')")

    real_by_creator = defaultdict(int)   # creator recId -> real edits yesterday
    real_by_editor = defaultdict(int)
    ai_yest = real_7d = ai_7d = 0
    for r in rows:
        f = r.get("fields", {})
        d = day_of(f.get("Completed At"))
        if not d:
            continue
        a = f.get("Asset") or []
        is_ai = bool(a) and a[0] in ai_ids
        if is_ai:
            ai_7d += 1
        else:
            real_7d += 1
        if d == yesterday:
            if is_ai:
                ai_yest += 1
            else:
                real_by_editor[(f.get("Submitted By Name") or "editor").strip()] += 1
                for cid in (f.get("Creator") or []):
                    real_by_creator[cid] += 1

    real_yest_total = sum(real_by_editor.values())
    findings = []

    # per-creator: who hit their quota/7 and who's short (every day, incl. weekends)
    short, ok = [], []
    for cid, tgt in quota_day.items():
        got = real_by_creator.get(cid, 0)
        (ok if got >= tgt else short).append(f"{cname[cid]} {got}/{tgt}")
    who_edited = ", ".join(f"{n} {c}" for n, c in sorted(real_by_editor.items(), key=lambda x: -x[1])) or "nobody"

    if expected_day > 0:
        sev = "green" if real_yest_total >= expected_day else ("red" if real_yest_total < expected_day * 0.5 else "amber")
        tail = (" Short: " + "; ".join(short) + ".") if short else " Every creator hit their daily quota."
        findings.append(finding(
            f"Real edits: {real_yest_total} of {expected_day} expected yesterday (by {who_edited}).{tail}", sev))
    else:
        findings.append(finding(f"Real edits yesterday: {real_yest_total} (by {who_edited}). No managed creators — no target.", "green"))

    findings.append(finding(f"AI edits yesterday: {ai_yest} (edits on AI-generated content).", "green"))

    bad = any(x["urgency"] != "green" for x in findings)
    headline = (f"Real edits {real_yest_total}/{expected_day} yesterday, AI {ai_yest}"
                if bad else f"Editing on track — {real_yest_total}/{expected_day} real, {ai_yest} AI (yesterday)")
    perc = "; ".join(short + ok) if (short or ok) else "no managed creators"
    rep = write_report(id="jordan", teammate="Jordan", dept="Content Production", tier="worker", reports_to="theo",
                       headline=headline, findings=findings,
                       notes=(f"Daily target per creator = their Weekly Reel Quota / 7 (read live, not assumed). "
                              f"Yesterday per creator: {perc}. Last 7d: {real_7d} real, {ai_7d} AI edits. "
                              "Real vs AI split by edited asset's Source Type. Target applies every day."))
    print(f"Jordan: {rep['urgency'].upper()} — {headline}")
    for x in findings:
        print(f"  [{x['urgency']}] {x['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
