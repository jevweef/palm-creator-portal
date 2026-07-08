#!/usr/bin/env python3
"""
cody_coverage.py — "Cody", per-account posting-coverage monitor (read-only).

Surface social ACCOUNTS gone quiet / never-posted across the Publer fleet (per
Creator+Channel cadence). Reports up to Dana → Maya.

Non-overlap: Pax owns delivery FAILURES (failed/stuck posts, reauth health);
Cody owns QUIET/cadence (account silent past SLA). Sam owns per-creator reel
quota. Cody never reports failures or reel pace.

Verified: OPS Publer Accounts tblGDhVY73UT2gLSW (EMPTY today — fleet dormant; Cody
self-activates when synced), Posts tblTEaiscTQQkEvj2, AI Account Profile
tbloVP7ocqHpeK9mo (Warmup Status='Live' = AI go-live gate).
Proposed cadence SLAs: IG 48h, FB 72h (NEEDS EVAN).
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone

from palm_agent import (airtable_token, get_meta, fetch_all, name_map, finding,
                        write_report, emit_error)

OPS = "applLIT2t83plMqNx"
T_PUBLER = "tblGDhVY73UT2gLSW"
T_POSTS = "tblTEaiscTQQkEvj2"
T_PALM = "tbls2so6pHGbU4Uhh"
SLA_H = {"IG": 48, "FB": 72}


def preflight(token):
    tables = {t["name"]: t for t in get_meta(token, OPS).get("tables", [])}
    problems = []
    if not tables.get("Publer Accounts"):
        problems.append("OPS `Publer Accounts` gone/renamed")
    if not tables.get("Posts"):
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
        emit_error(id="cody", teammate="Cody", dept="Distribution", problems=problems)
        print("Cody: DATA CHANGED — " + "; ".join(problems), file=sys.stderr); return 1

    now = datetime.now(timezone.utc)
    names = name_map(token, OPS, T_PALM)
    accts = fetch_all(token, OPS, T_PUBLER, ["Account Name", "Channel", "Account Type", "Creator", "Status", "Live Mode"])
    active = [a.get("fields", {}) for a in accts if a.get("fields", {}).get("Status") == "Active"]

    if not active:
        write_report(id="cody", teammate="Cody", dept="Distribution", tier="worker", reports_to="dana",
                     headline="Publer fleet dormant — no accounts to cover yet",
                     findings=[finding(f"Publer Accounts table has {len(accts)} rows, 0 Active — nothing to monitor until the fleet is synced from Publer.", "green")],
                     notes="Self-activates when accounts are synced. Cadence SLAs IG 48h / FB 72h (proposed).")
        print("Cody: GREEN — Publer fleet dormant (0 active accounts)")
        return 0

    # latest outbound per Creator+Channel (inferred from Telegram Sent / scheduled; Posted At never set)
    latest = {}
    for p in fetch_all(token, OPS, T_POSTS, ["Creator", "Channel", "Scheduled Date", "Telegram Sent At"]):
        f = p.get("fields", {})
        d = parse_dt(f.get("Telegram Sent At")) or parse_dt(f.get("Scheduled Date"))
        ch = f.get("Channel")
        if not d or not ch:
            continue
        for cid in (f.get("Creator") or []):
            key = (cid, ch)
            if key not in latest or d > latest[key]:
                latest[key] = d

    quiet, never = [], []
    for f in active:
        ch = f.get("Channel")
        creator_ids = f.get("Creator") or []
        nm = f.get("Account Name") or (", ".join(names.get(c, "") for c in creator_ids)) or "?"
        sla = SLA_H.get(ch, 48)
        freshest = None
        for cid in creator_ids:
            d = latest.get((cid, ch))
            if d and (freshest is None or d > freshest):
                freshest = d
        if freshest is None:
            never.append(f"{nm} ({ch})")
        elif (now - freshest).total_seconds() / 3600.0 > sla:
            quiet.append(f"{nm} ({ch}, {(now-freshest).total_seconds()/3600.0:.0f}h)")

    findings = []
    if never:
        findings.append(finding(f"{len(never)} active account(s) have never posted: {', '.join(never[:8])}.", "amber"))
    for q in quiet:
        sev = "red" if "FB" in q else "amber"
        findings.append(finding(f"Account quiet past cadence: {q}.", sev))
    if not findings:
        findings.append(finding(f"All {len(active)} active accounts posting within cadence.", "green"))

    bad = any(x["urgency"] != "green" for x in findings)
    headline = (f"{len(quiet)} quiet, {len(never)} never-posted accounts" if bad else f"All {len(active)} accounts on cadence")
    rep = write_report(id="cody", teammate="Cody", dept="Distribution", tier="worker", reports_to="dana",
                       headline=headline, findings=findings,
                       notes="Read-only. Cadence inferred from sent/scheduled (Posted At never set). SLAs IG 48h/FB 72h (proposed). Owns quiet/coverage; Pax owns failures.")
    print(f"Cody: {rep['urgency'].upper()} — {headline}")
    for x in findings:
        print(f"  [{x['urgency']}] {x['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
