#!/usr/bin/env python3
"""
wendy_whales.py — "Wendy", whale-watch monitor (read-only, Fan-Tracker-based).

Surface high-value fans flagged Going Cold who haven't been actioned, so a human
can send the recovery. Reports up to Marcus → Maya. Never sends.

Read-only from OPS Fan Tracker tblZLOSnP5z5uypWm — does NOT call the Clerk-gated
creator-earnings/analyze-chat routes (the deeper auto-detection + drafting are
deferred until an auth path is decided). This surfaces fans the existing
whale-hunting system already marked cold.
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone

from palm_agent import (airtable_token, get_meta, fetch_all, name_map, finding,
                        write_report, emit_error, cfg, excluded)

OPS = "applLIT2t83plMqNx"
T_FANS = "tblZLOSnP5z5uypWm"
T_PALM = "tbls2so6pHGbU4Uhh"

# A cold whale is RED when lifetime spend clears this (tunable in config.json).
RED_LIFETIME = cfg("wendy", "RED_LIFETIME", 1000)


def _clean(name: str) -> str:
    """Fan / OF Username are user-set and often spammy promo blurbs — trim to
    something readable for the brief."""
    n = " ".join((name or "").split())
    return (n[:30] + "…") if len(n) > 31 else n


def preflight(token):
    t = {x["name"]: x for x in get_meta(token, OPS).get("tables", [])}.get("Fan Tracker")
    if not t:
        return ["OPS `Fan Tracker` gone/renamed"]
    have = {f["name"] for f in t["fields"]}
    return [f"Fan Tracker.`{x}`" for x in ("Status", "OF Username", "Lifetime Spend") if x not in have]


def main():
    token = airtable_token()
    problems = preflight(token)
    if problems:
        emit_error(id="wendy", teammate="Wendy", dept="Revenue", problems=problems)
        print("Wendy: DATA CHANGED — " + "; ".join(problems), file=sys.stderr); return 1

    creators = name_map(token, OPS, T_PALM)
    mute = excluded("wendy")
    fans = fetch_all(token, OPS, T_FANS, ["OF Username", "Fan Name", "Creator", "Status", "Lifetime Spend", "Last Alert Sent"])

    cold = []
    for r in fans:
        f = r.get("fields", {})
        if f.get("Status") != "Going Cold":
            continue
        who = ", ".join(creators.get(c, "") for c in (f.get("Creator") or [])) or "?"
        if who in mute:                       # creator on a known break — don't cry wolf
            continue
        fan = _clean(f.get("Fan Name") or f.get("OF Username") or "?")
        cold.append((float(f.get("Lifetime Spend") or 0), fan, who))
    cold.sort(reverse=True)

    findings = []
    for spend, fan, creator in cold[:12]:
        urg = "red" if spend >= RED_LIFETIME else "amber"
        findings.append(finding(f"{creator}: \"{fan}\" going cold (lifetime ${spend:,.0f}) — recovery not yet sent.", urg))
    if len(cold) > 12:
        findings.append(finding(f"…and {len(cold) - 12} more cold whales (lower lifetime spend).", "amber"))
    if not cold:
        findings.append(finding("No fans currently flagged Going Cold and unactioned.", "green"))

    at_risk = sum(s for s, _, _ in cold)
    reds = sum(1 for s, _, _ in cold if s >= RED_LIFETIME)
    headline = (f"{len(cold)} whale(s) going cold — ${at_risk:,.0f} lifetime at risk"
                + (f", {reds} ≥ ${RED_LIFETIME:,.0f}" if reds else "")) if cold else "No cold whales pending"
    rep = write_report(id="wendy", teammate="Wendy", dept="Revenue", tier="worker", reports_to="marcus",
                       headline=headline, findings=findings,
                       notes=f"Read-only from Fan Tracker (Status='Going Cold'). Deeper earnings-based detection + chat-analysis drafting deferred (Clerk-gated routes). RED ≥ ${RED_LIFETIME:,.0f} lifetime.")
    print(f"Wendy: {rep['urgency'].upper()} — {headline}")
    for x in findings:
        print(f"  [{x['urgency']}] {x['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
