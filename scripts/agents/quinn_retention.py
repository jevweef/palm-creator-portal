#!/usr/bin/env python3
"""
quinn_retention.py — "Quinn", retention / offboarding monitor (read-only).

Catch creators slipping toward the door (sustained posting silence) and offboards
left half-done. Reports up to Vivian → Maya. Never sends.

Buildable now: posting-silence (Airtable) + offboard loose-ends. The revenue-trend
half is DEFERRED — earnings live in Google Sheets per-fan, not a creator-level
trend; needs an aggregation decision (see Ed's sheets helper).

Distinct from Sam (weekly reel pace): Quinn flags SUSTAINED zero output.
Proposed: silence SLA 14d (NEEDS EVAN).
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone

from palm_agent import (airtable_token, get_meta, fetch_all, name_map, finding,
                        write_report, emit_error, cfg, excluded)

OPS = "applLIT2t83plMqNx"
HQ = "appL7c4Wtotpz07KS"
T_PALM = "tbls2so6pHGbU4Uhh"
T_POSTS = "tblTEaiscTQQkEvj2"
T_HQ_CREATORS = "tblYhkNvrNuOAHfgw"
T_REV = "tblQqPWlsjiyJA0ba"
SILENCE_DAYS = cfg("quinn", "SILENCE_DAYS", 14)


def preflight(token):
    ops = {t["name"]: t for t in get_meta(token, OPS).get("tables", [])}
    problems = []
    if not ops.get("Palm Creators"):
        problems.append("OPS `Palm Creators` gone/renamed")
    if not ops.get("Posts"):
        problems.append("OPS `Posts` gone/renamed")
    return problems


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
        emit_error(id="quinn", teammate="Quinn", dept="Talent & Relations", problems=problems)
        print("Quinn: DATA CHANGED — " + "; ".join(problems), file=sys.stderr); return 1

    now = datetime.now(timezone.utc)
    names = name_map(token, OPS, T_PALM)
    mute = excluded("quinn")
    # Only creators we actually run socials for can "go silent" — gate on Social
    # Media Editing (mirrors Sam) so non-managed creators aren't false churn signals.
    active = {r["id"]: r["fields"].get("Creator") for r in fetch_all(token, OPS, T_PALM, ["Creator", "Status", "Social Media Editing"])
              if r.get("fields", {}).get("Status") == "Active"
              and r.get("fields", {}).get("Social Media Editing")
              and (r["fields"].get("Creator") not in mute)}

    # latest outbound per creator
    latest = {}
    for p in fetch_all(token, OPS, T_POSTS, ["Creator", "Scheduled Date", "Telegram Sent At"]):
        f = p.get("fields", {})
        d = parse_dt(f.get("Telegram Sent At")) or parse_dt(f.get("Scheduled Date"))
        if not d:
            continue
        for cid in (f.get("Creator") or []):
            if cid not in latest or d > latest[cid]:
                latest[cid] = d
    silent = []
    for cid, nm in active.items():
        d = latest.get(cid)
        if d is None or (now - d).days >= SILENCE_DAYS:
            days = (now - d).days if d else None
            silent.append(f"{nm} ({days}d)" if days is not None else f"{nm} (no posts on record)")

    # offboard loose ends: HQ Offboarded creators with a Revenue Account still Active
    rev_status = {r["id"]: r["fields"].get("Status") for r in fetch_all(token, HQ, T_REV, ["Status"])}
    loose = []
    for r in fetch_all(token, HQ, T_HQ_CREATORS, ["Creator", "Status", "Revenue Accounts"]):
        f = r.get("fields", {})
        if f.get("Status") == "Offboarded":
            still = [rid for rid in (f.get("Revenue Accounts") or []) if rev_status.get(rid) == "Active"]
            if still:
                loose.append(f.get("Creator") or "?")

    findings = []
    if silent:
        findings.append(finding(f"{len(silent)} active creator(s) with NO posts in ≥{SILENCE_DAYS}d (churn-risk / possible break): {', '.join(silent[:8])}.", "amber"))
    if loose:
        findings.append(finding(f"{len(loose)} offboarded creator(s) still have an Active revenue account (cascade incomplete): {', '.join(loose)}.", "red"))
    if not findings:
        findings.append(finding(f"Retention stable — all {len(active)} active creators posting within {SILENCE_DAYS}d, no half-done offboards.", "green"))

    bad = any(x["urgency"] != "green" for x in findings)
    headline = (f"{len(silent)} going silent, {len(loose)} offboard loose-ends" if bad else "Retention stable")
    rep = write_report(id="quinn", teammate="Quinn", dept="Talent & Relations", tier="worker", reports_to="vivian",
                       headline=headline, findings=findings,
                       notes=f"Read-only. Posting-silence + offboard halves only; revenue-trend deferred (Google Sheets aggregation). Silence SLA {SILENCE_DAYS}d (proposed). No planned-break list yet — may re-flag vacations.")
    print(f"Quinn: {rep['urgency'].upper()} — {headline}")
    for x in findings:
        print(f"  [{x['urgency']}] {x['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
