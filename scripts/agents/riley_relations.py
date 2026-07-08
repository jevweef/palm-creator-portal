#!/usr/bin/env python3
"""
riley_relations.py — "Riley", creator-relations monitor (read-only).

Surface creators we've left on read, or who've gone quiet, so nobody slips.
Reports up to Vivian → Maya. Never sends.

WHO IS A CREATOR vs US (no maintained handle list needed):
A creator appears in exactly ONE chat — their own "PALM x <creator>" group. Our
team (internal AND the external chat company, whoever's cycling through) replies
across MANY chats. So: a sender seen in 2+ watched chats = team; a sender in only
their own chat = the creator. Plus the known internal handles from config.json.
"Left on read" = the latest message in a chat is from the creator and we haven't
answered. This is robust to the external chat team swapping people constantly.

WHICH CREATORS: only Active + Onboarding (skips Offboarded/Lead) — via the chat's
Creator HQ ID → HQ Creators Status.

Verified: OPS Telegram Chats tblSUmwkCg1opPFEL, Telegram Messages tblz8x1gxPrHE6FUD,
HQ Creators tblYhkNvrNuOAHfgw. Proposed: quiet 5d, left-on-read 4h (config.json).
"""
from __future__ import annotations

import sys
from collections import defaultdict
from datetime import datetime, timezone

from palm_agent import (airtable_token, get_meta, fetch_all, finding,
                        write_report, emit_error, cfg, cfg_list, excluded)

OPS = "applLIT2t83plMqNx"
HQ = "appL7c4Wtotpz07KS"
T_CHATS = "tblSUmwkCg1opPFEL"
T_MSGS = "tblz8x1gxPrHE6FUD"
T_HQ_CREATORS = "tblYhkNvrNuOAHfgw"
QUIET_DAYS = cfg("riley", "QUIET_DAYS", 5)
LEFT_ON_READ_H = cfg("riley", "LEFT_ON_READ_H", 4)
WATCH_STATUSES = {"Active", "Onboarding"}   # skip Offboarded / Lead


def preflight(token):
    tables = {t["name"]: t for t in get_meta(token, OPS).get("tables", [])}
    problems = []
    if not tables.get("Telegram Chats"):
        problems.append("OPS `Telegram Chats` gone/renamed")
    if not tables.get("Telegram Messages"):
        problems.append("OPS `Telegram Messages` gone/renamed")
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
        emit_error(id="riley", teammate="Riley", dept="Talent & Relations", problems=problems)
        print("Riley: DATA CHANGED — " + "; ".join(problems), file=sys.stderr); return 1

    now = datetime.now(timezone.utc)
    mute = excluded("riley")

    # creator lifecycle status (Active/Onboarding only)
    status_by_hq = {r["id"]: r.get("fields", {}).get("Status")
                    for r in fetch_all(token, HQ, T_HQ_CREATORS, ["Status"])}

    chats = fetch_all(token, OPS, T_CHATS, ["Status", "Creator AKA", "Creator HQ ID", "Last Message At"])
    watching = {}
    for c in chats:
        f = c.get("fields", {})
        if f.get("Status") != "Watching" or not f.get("Creator AKA"):
            continue
        if f.get("Creator AKA") in mute:
            continue
        if status_by_hq.get(f.get("Creator HQ ID")) not in WATCH_STATUSES:
            continue   # only active + onboarding creators
        watching[c["id"]] = f

    # one pass over messages: who sends in how many chats + latest sender per chat
    sender_chats = defaultdict(set)
    latest = {}
    for m in fetch_all(token, OPS, T_MSGS, ["Chat", "Sender Username", "Sent At"]):
        f = m.get("fields", {})
        sent = parse_dt(f.get("Sent At"))
        if not sent:
            continue
        s = (f.get("Sender Username") or "").lstrip("@")
        for cid in (f.get("Chat") or []):
            if cid not in watching:
                continue
            sender_chats[s].add(cid)
            if cid not in latest or sent > latest[cid][0]:
                latest[cid] = (sent, s)

    agency = set(cfg_list("agency_handles", ["jevweef", "whoisjoshvoto"]))

    def is_team(s):
        # us = known internal handle, OR anyone who replies across 2+ creator chats
        # (covers the cycling external chat team with no list), OR a blank/system sender
        return (s in agency) or (len(sender_chats.get(s, ())) >= 2) or (s == "")

    awaiting = {}   # creator AKA -> max hours we've left them waiting
    for cid, (sent, s) in latest.items():
        if is_team(s):
            continue
        hrs = (now - sent).total_seconds() / 3600.0
        if hrs >= LEFT_ON_READ_H:
            aka = watching[cid].get("Creator AKA")
            awaiting[aka] = max(awaiting.get(aka, 0), hrs)

    quiet = {}
    for f in watching.values():
        aka = f.get("Creator AKA")
        lm = parse_dt(f.get("Last Message At"))
        d = (now - lm).days if lm else 9999
        if d >= QUIET_DAYS:
            quiet[aka] = max(quiet.get(aka, 0), d)

    awaiting_list = [f"{a} ({h:.0f}h)" for a, h in sorted(awaiting.items(), key=lambda x: -x[1])]
    quiet_list = [f"{a} ({d}d)" for a, d in sorted(quiet.items(), key=lambda x: -x[1])]

    findings = []
    if awaiting_list:
        findings.append(finding(f"{len(awaiting_list)} creator(s) messaged us and are still waiting on a reply: {', '.join(awaiting_list[:8])}.", "amber"))
    if quiet_list:
        findings.append(finding(f"{len(quiet_list)} creator(s) haven't exchanged a message with us in {QUIET_DAYS}+ days: {', '.join(quiet_list[:8])}.", "amber"))
    if not findings:
        findings.append(finding(f"All {len(watching)} active/onboarding creator chats two-way and current.", "green"))

    bad = any(x["urgency"] != "green" for x in findings)
    headline = (f"{len(awaiting_list)} left-on-read, {len(quiet_list)} quiet" if bad else "Creator chats current")
    rep = write_report(id="riley", teammate="Riley", dept="Talent & Relations", tier="worker", reports_to="vivian",
                       headline=headline, findings=findings,
                       notes=(f"Active+onboarding creators only. 'Us' = anyone replying across 2+ chats (auto-handles the "
                              f"cycling chat team, no list needed) + internal handles. Quiet {QUIET_DAYS}d, left-on-read {LEFT_ON_READ_H}h."))
    print(f"Riley: {rep['urgency'].upper()} — {headline}")
    for x in findings:
        print(f"  [{x['urgency']}] {x['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
