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
                        write_report, emit_error, offboarded_creators)

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
    gone = offboarded_creators(token)  # offboarded creators' stale cards = noise
    posts = fetch_all(token, OPS, T_POSTS, ["Status", "Caption", "Hashtags", "Thumbnail", "Scheduled Date", "Creator", "Post Name"])

    # Evan's urgency ladder: under a week sitting = don't mention; ~1 week =
    # mention; 2+ weeks = urgent. Layman's terms: creator + what it is + how
    # long + which page — never "cards".
    imminent, week_old, two_weeks = [], [], []
    fresh = 0
    for p in posts:
        f = p.get("fields", {})
        if f.get("Status") not in PENDING:
            continue
        missing = []
        if not (f.get("Caption") or "").strip():
            missing.append("a caption")
        if not (f.get("Hashtags") or "").strip():
            missing.append("hashtags")
        if not f.get("Thumbnail"):
            missing.append("a cover photo")
        nm = ", ".join(names.get(c, "") for c in (f.get("Creator") or []))
        title = (f.get("Post Name") or f.get("Caption") or "?").strip()
        if not nm and " – " in title:        # old rows have no Creator link; name leads the Post Name
            nm = title.split(" – ")[0].strip()
        if nm and all(part.strip().lower() in gone for part in nm.split(",") if part.strip()):
            continue  # offboarded creator — skip entirely
        age_days = int((now - parse_dt(p["createdTime"])).total_seconds() // 86400)
        sched = parse_dt(f.get("Scheduled Date"))
        if missing and sched and 0 <= (sched - now).total_seconds() <= 86400:
            imminent.append(f"{nm or title}'s post \"{title[:45]}\" is supposed to go out within 24 hours but still needs {' and '.join(missing)}")
            continue
        if age_days < 7:
            fresh += 1                       # sitting a few days is normal — don't nag
            continue
        line = f"{nm or '?'}'s post \"{title[:45]}\" has been sitting on the Post Prep page for {age_days} days without going out"
        if missing:
            line += f" (still needs {' and '.join(missing)})"
        (two_weeks if age_days >= 14 else week_old).append(line)

    findings = []
    for line in imminent:
        findings.append(finding(line + " — someone needs to fill that in today.", "red"))
    for line in two_weeks:
        findings.append(finding(line + " — that's long enough that it's probably forgotten; send it or delete it.", "red"))
    for line in week_old:
        findings.append(finding(line + " — worth a look this week.", "amber"))
    if not findings:
        note = f" ({fresh} newer post(s) in the pipeline are moving normally)" if fresh else ""
        findings.append(finding(f"Nothing stuck on the Post Prep page{note}.", "green"))

    bad = any(x["urgency"] != "green" for x in findings)
    headline = (f"{len(imminent) + len(two_weeks)} post(s) stuck/urgent on Post Prep, {len(week_old)} sitting a week+" if bad else "Post Prep moving normally")
    rep = write_report(id="penny", teammate="Penny", dept="Distribution", tier="worker", reports_to="dana",
                       headline=headline, findings=findings,
                       notes="Read-only scanner. Auto-drafting captions/hashtags deferred (suggest-text auth + hashtag policy). Scope = unshipped cards only.")
    print(f"Penny: {rep['urgency'].upper()} — {headline}")
    for x in findings:
        print(f"  [{x['urgency']}] {x['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
