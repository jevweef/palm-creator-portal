#!/usr/bin/env python3
"""
penny_postprep.py — "Penny", Post-Prep readiness monitor (read-only).

Surface Post-Prep cards missing a caption, hashtags, or cover so a human can fill
them before they ship. Reports up to Dana → Maya. The auto-drafting half (caption/
hashtag generation) is deferred — needs suggest-text auth + a hashtag policy.

Verified: OPS Posts tblTEaiscTQQkEvj2 (Caption, Hashtags, Thumbnail, Status,
Scheduled Date). Scope = not-yet-shipped cards (Staged/Prepping/Ready), not the
647 already Sent to Telegram.
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone

from palm_agent import (airtable_token, get_meta, fetch_all, name_map, finding,
                        write_report, emit_error)

OPS = "applLIT2t83plMqNx"
T_POSTS = "tblTEaiscTQQkEvj2"
T_PALM = "tbls2so6pHGbU4Uhh"
PENDING = {"Prepping", "Staged", "Ready to Go", "Ready to Post"}


def preflight(token):
    t = {x["name"]: x for x in get_meta(token, OPS).get("tables", [])}.get("Posts")
    if not t:
        return ["OPS `Posts` gone/renamed"]
    have = {f["name"] for f in t["fields"]}
    return [f"Posts.`{x}`" for x in ("Status", "Caption", "Scheduled Date") if x not in have]


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
        emit_error(id="penny", teammate="Penny", dept="Distribution", problems=problems)
        print("Penny: DATA CHANGED — " + "; ".join(problems), file=sys.stderr); return 1

    now = datetime.now(timezone.utc)
    names = name_map(token, OPS, T_PALM)
    posts = fetch_all(token, OPS, T_POSTS, ["Status", "Caption", "Hashtags", "Thumbnail", "Scheduled Date", "Creator", "Post Name"])

    naked, imminent, overdue = [], [], []
    for p in posts:
        f = p.get("fields", {})
        if f.get("Status") not in PENDING:
            continue
        missing = []
        if not (f.get("Caption") or "").strip():
            missing.append("caption")
        if not (f.get("Hashtags") or "").strip():
            missing.append("hashtags")
        if not f.get("Thumbnail"):
            missing.append("cover")
        if not missing:
            continue
        nm = ", ".join(names.get(c, "") for c in (f.get("Creator") or [])) or (f.get("Post Name") or "?")
        naked.append(nm)
        sched = parse_dt(f.get("Scheduled Date"))
        if "caption" in missing and sched:
            secs = (sched - now).total_seconds()
            label = f"{nm} (sched {str(f.get('Scheduled Date'))[:10]})"
            if 0 <= secs <= 86400:           # genuinely imminent (future, <24h)
                imminent.append(label)
            elif secs < 0:                   # scheduled in the past, still unshipped + no caption
                overdue.append(label)

    findings = []
    if imminent:
        findings.append(finding(f"{len(imminent)} post(s) scheduled within 24h still have NO caption: {', '.join(imminent[:6])}.", "red"))
    if overdue:
        findings.append(finding(f"{len(overdue)} past-due card(s) still staged with no caption (never shipped): {', '.join(overdue[:6])}.", "amber"))
    if naked:
        n_other = len(naked) - len(imminent) - len(overdue)
        findings.append(finding(f"{len(naked)} Post-Prep card(s) need a human pass (caption/hashtags/cover); {len(imminent)} ship in <24h, {len(overdue)} already past-due.", "amber"))
    if not findings:
        findings.append(finding("All Post-Prep cards have caption + hashtags + cover.", "green"))

    bad = any(x["urgency"] != "green" for x in findings)
    headline = (f"{len(imminent)} ship-blank in 24h, {len(naked)} cards need copy" if bad else "Post-Prep cards complete")
    rep = write_report(id="penny", teammate="Penny", dept="Distribution", tier="worker", reports_to="dana",
                       headline=headline, findings=findings,
                       notes="Read-only scanner. Auto-drafting captions/hashtags deferred (suggest-text auth + hashtag policy). Scope = unshipped cards only.")
    print(f"Penny: {rep['urgency'].upper()} — {headline}")
    for x in findings:
        print(f"  [{x['urgency']}] {x['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
