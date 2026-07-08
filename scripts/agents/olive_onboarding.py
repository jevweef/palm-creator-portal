#!/usr/bin/env python3
"""
olive_onboarding.py — "Olive", onboarding + post-onboarding-setup monitor (read-only).

Watches the WHOLE pipeline, not just the wizard:
  1. Cold links — onboarding link sent but never completed.
  2. Stuck profile docs — uploaded but analysis never run.
  3. POST-ONBOARDING SETUP (the big one): creators who finished the wizard but
     aren't fully set up / live yet. Reads the HQ Onboarding record
     (tbl4nFzgH6nJHr3q6) — the same fields board.js / the go-live gate use — and
     flags what's still undone per creator:
       - Run Setup (Phase 2): the 5 "…Created" booleans. ALL false after the wizard
         = the known orphaned-run-setup bug (setup silently never ran) → RED.
       - Inputs (now skippable since the wizard went "open"): unsigned contract,
         survey not completed, no voice memo, no profile photos.
       - Go-Live checklist (Phase 3): niches, pillars, bios, profile pics, kickoff,
         strategy doc, first week, accounts QA.
Reports up to Vivian → Maya. Read-only — never runs setup, never sends.
Proposed: cold-link SLA 4d, "stalled in setup" 7d (config.json).
"""
from __future__ import annotations

import sys
from datetime import date, datetime, timezone

from palm_agent import (airtable_token, get_meta, fetch_all, finding,
                        write_report, emit_error, cfg)

HQ = "appL7c4Wtotpz07KS"
OPS = "applLIT2t83plMqNx"
T_HQ_CREATORS = "tblYhkNvrNuOAHfgw"
T_ONBOARDING = "tbl4nFzgH6nJHr3q6"
T_DOCS = "tblzRPH4149dUg0SL"
COLD_LINK_DAYS = cfg("olive", "COLD_LINK_DAYS", 1)   # nudge if link unclicked after a day
STALLED_DAYS = cfg("olive", "STALLED_DAYS", 7)

PHASE2 = [("Default Social Accounts Created", "social accounts"),
          ("Credentials Records Created", "credentials"),
          ("Dropbox Folder Structure Created", "Dropbox folders"),
          ("Social File Request Created", "social file req"),
          ("Longform File Request Created", "longform file req")]
# Phase-3 go-live checklist — MUST mirror PHASE3_ITEMS in lib/onboarding/checklist.js
# (the single source of truth the board + go-live gate use). Order matches the board.
# Sync with the onboarding session (df6746vy) whenever a checklist field changes.
# (field, label, required) — `required` mirrors PHASE3_ITEMS[].required in checklist.js.
# Only required items gate go-live; "Content Pillars Confirmed" is optional (never RED).
PHASE3 = [("Telegram Bot Added", "telegram bot", True), ("Niches Confirmed", "niches", True),
          ("Content Pillars Confirmed", "pillars", False), ("Kickoff Call Completed", "kickoff", True),
          ("Strategy Doc Created", "strategy doc", True), ("Bios Filled", "bios", True),
          ("Profile Pics Set", "profile pics", True), ("First Week Scheduled", "first week", True),
          ("Accounts QA Complete", "accounts QA", True)]
# Board-only toggles — shown on the checklist board but intentionally NOT part of the
# go-live gate (they don't hard-block). Tracked for completeness; reported as optional,
# never RED. (EDITABLE_ONBOARDING_FIELDS in checklist.js.)
BOARD_ITEMS = [("Multi-link Created", "multi-link"), ("Initial Cadence Set", "initial cadence"),
               ("AI Content Consent", "AI consent"), ("OF Login Confirmed", "OF login confirmed")]


def preflight(token):
    problems = []
    hq = {t["name"]: t for t in get_meta(token, HQ).get("tables", [])}
    if not hq.get("Creators"):
        problems.append("HQ `Creators` gone/renamed")
    if not next((t for t in hq.values() if t["id"] == T_ONBOARDING), None):
        problems.append("HQ `Onboarding` table (tbl4nFzgH6nJHr3q6) gone")
    return problems


def first(v):
    return v[0] if isinstance(v, list) and v else (v if not isinstance(v, list) else None)


def to_date(s):
    if not s:
        return None
    try:
        return date.fromisoformat(str(s)[:10])
    except ValueError:
        return None


def main():
    token = airtable_token()
    problems = preflight(token)
    if problems:
        emit_error(id="olive", teammate="Olive", dept="Talent & Relations", problems=problems)
        print("Olive: DATA CHANGED — " + "; ".join(problems), file=sys.stderr); return 1

    today = date.today()
    now = datetime.now(timezone.utc)
    findings = []

    # 1. cold links (sent, never completed) + 1b. fresh starts (clicked + started)
    cold, started = [], []
    for r in fetch_all(token, HQ, T_HQ_CREATORS, ["Creator", "AKA", "Status", "Onboarding Status", "Onboarding Token Created At", "Onboarding Started At"]):
        f = r.get("fields", {})
        if f.get("Status") in ("Paused", "Offboarded"):
            continue   # parked on hold / gone — don't chase as active onboarding
        st = f.get("Onboarding Status")
        if st == "Link Sent":
            try:
                created = datetime.fromisoformat(f.get("Onboarding Token Created At", "").replace("Z", "+00:00"))
                age = (now - created).days
            except (ValueError, AttributeError):
                age = None
            if age is None or age >= COLD_LINK_DAYS:
                nm = f.get("Creator") or f.get("AKA") or "?"
                cold.append(f"{nm} (link sent {age}d ago, not clicked)" if age is not None else f"{nm} (link sent, never clicked)")
        elif st == "In Progress":
            sa = f.get("Onboarding Started At")
            try:
                d = (now - datetime.fromisoformat(sa.replace("Z", "+00:00"))).days if sa else None
            except (ValueError, AttributeError):
                d = None
            when = f"started {d}d ago" if d is not None else "in progress"
            started.append(f"{f.get('Creator') or f.get('AKA') or '?'} ({when})")
    if started:
        findings.append(finding(f"{len(started)} creator(s) actively in onboarding right now: {', '.join(started)}.", "amber"))
    if cold:
        findings.append(finding(f"{len(cold)} onboarding link(s) sent but never completed: {', '.join(cold)}.", "amber"))

    # 2. post-onboarding setup — creators who finished the wizard but aren't live
    onb_fields = (["Creator Name", "Go-Live Approved", "Onboarding Date (from Creator) 2",
                   "Status (from Creator) 2", "Contract Sign Date (from Creator) 2", "Survey Completed",
                   "Audio Ramble Received", "Profile Photos Received"]
                  + [f for f, _ in PHASE2] + [f for f, _, _ in PHASE3] + [f for f, _ in BOARD_ITEMS])
    stalled = 0
    for r in fetch_all(token, HQ, T_ONBOARDING, onb_fields):
        f = r.get("fields", {})
        if f.get("Go-Live Approved"):
            continue                                  # already live (formal flag)
        cstatus = first(f.get("Status (from Creator) 2"))
        if cstatus in ("Active", "Offboarded", "Paused"):
            continue   # already live / gone / parked on hold — don't chase these in setup
        wiz = to_date(first(f.get("Onboarding Date (from Creator) 2")))
        if not wiz:
            continue                                  # wizard not finished yet
        name = f.get("Creator Name") or "?"
        days = (today - wiz).days
        p2_missing = [lbl for fld, lbl in PHASE2 if not f.get(fld)]
        p3_req_missing = [lbl for fld, lbl, req in PHASE3 if req and not f.get(fld)]      # gate go-live
        p3_opt_missing = [lbl for fld, lbl, req in PHASE3 if not req and not f.get(fld)]  # optional
        board_missing = [lbl for fld, lbl in BOARD_ITEMS if not f.get(fld)]               # non-gating toggles
        optional_missing = p3_opt_missing + board_missing
        inputs = []
        if not first(f.get("Contract Sign Date (from Creator) 2")):
            inputs.append("contract unsigned")
        if not f.get("Survey Completed"):
            inputs.append("survey")
        if not f.get("Audio Ramble Received"):
            inputs.append("voice memo")
        if not f.get("Profile Photos Received"):
            inputs.append("photos")
        parts = []
        run_setup_dead = len(p2_missing) == len(PHASE2)
        if run_setup_dead:
            parts.append("Run Setup never ran (0/5 — setup silently skipped)")
        elif p2_missing:
            parts.append(f"setup {len(PHASE2)-len(p2_missing)}/{len(PHASE2)} ({', '.join(p2_missing)})")
        if inputs:
            parts.append("missing inputs: " + ", ".join(inputs))
        if p3_req_missing:
            parts.append(f"{len(p3_req_missing)} go-live item(s) left: {', '.join(p3_req_missing)}")
        if optional_missing:
            parts.append("optional: " + ", ".join(optional_missing))
        # gating = anything that actually blocks go-live (setup, required inputs, required P3).
        # Optional items alone shouldn't make a creator read as "stuck" → only note them.
        gating = bool(p2_missing or inputs or p3_req_missing)
        if not parts:
            continue                                  # finished wizard, fully set up, just not flipped live
        if gating and days >= STALLED_DAYS:
            stalled += 1
        # Optional-only leftovers never go RED or count as stalled — only real gate work does.
        sev = "red" if (run_setup_dead or (gating and days >= STALLED_DAYS)) else "amber"
        findings.append(finding(f"{name} (wizard done {days}d ago): " + "; ".join(parts) + ".", sev))

    # 3. stuck profile docs
    pending = sum(1 for d in fetch_all(token, OPS, T_DOCS, ["Analysis Status"])
                  if d.get("fields", {}).get("Analysis Status") == "Pending")
    if pending:
        findings.append(finding(f"{pending} profile document(s) still Pending analysis.", "amber"))

    if not findings:
        findings.append(finding("Onboarding + setup clear — no cold links, no creators stuck in setup, no un-analyzed docs.", "green"))

    bad = any(x["urgency"] != "green" for x in findings)
    n_setup = sum(1 for x in findings if "wizard done" in x["text"])
    headline = (f"{len(cold)} cold links, {n_setup} stuck in setup ({stalled} stalled)" if bad else "Onboarding + setup clear")
    rep = write_report(id="olive", teammate="Olive", dept="Talent & Relations", tier="worker", reports_to="vivian",
                       headline=headline, findings=findings,
                       notes=(f"Watches wizard + the full post-onboarding setup (HQ Onboarding tbl4nFzgH6nJHr3q6, same fields as "
                              f"board.js/go-live gate). RED = Run Setup never ran (known bug) or stalled ≥{STALLED_DAYS}d. "
                              "Wizard is 'open' so inputs can be skipped — those show as 'missing inputs'. Read-only."))
    print(f"Olive: {rep['urgency'].upper()} — {headline}")
    for x in findings:
        print(f"  [{x['urgency']}] {x['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
