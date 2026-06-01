#!/usr/bin/env python3
"""
sam_quota.py — "Sam", the content-supply quota monitor, as a deterministic daily machine.

Faithful implementation of .claude/agents/content-supply-monitor.md (the Sam agent spec) as a
read-only script so it can run unattended on a schedule (launchd), the same way the OFM research
pipeline does. Sam has ONE job: each run, report which ACTIVE creators are behind pace on their
Weekly Reel Quota this calendar week, plus data-hygiene flags — and be PARANOID: verify its own
data contract every run and fail LOUD (not silently wrong) if the Airtable schema changed.

Strictly READ-ONLY. Never writes/patches/deletes anything. Never messages a creator.

Data contract (resolved BY NAME via the Airtable metadata API, never hard-coded IDs):
  Base OPS applLIT2t83plMqNx
  - Palm Creators: Status (singleSelect, needs an "Active" option), Weekly Reel Quota (number), Creator (text)
  - Posts:         Creator (link), Type (singleSelect, needs a "Reel" option), Scheduled Date (dateTime), Status

Output: Sam's plain-English report to stdout (+ optional Telegram if a bot token is configured).

Usage:
  python3 scripts/agents/sam_quota.py
  python3 scripts/agents/sam_quota.py --week-start monday|sunday   # default monday
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
OPS_BASE = "applLIT2t83plMqNx"
API = "https://api.airtable.com/v0"


def read_env(key: str) -> str | None:
    import os
    if os.getenv(key):
        return os.getenv(key)
    envf = REPO / ".env.local"
    if not envf.exists():
        return None
    for line in envf.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            if k.strip() == key:
                return v.strip().strip('"').strip("'")
    return None


def _get(url: str, token: str) -> dict:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def get_meta(token: str) -> dict:
    return _get(f"{API}/meta/bases/{OPS_BASE}/tables", token)


def fetch_all(token: str, table_id: str, fields: list[str], formula: str | None = None) -> list[dict]:
    rows, offset = [], None
    while True:
        params = [("pageSize", "100")]
        for f in fields:
            params.append(("fields[]", f))
        if formula:
            params.append(("filterByFormula", formula))
        if offset:
            params.append(("offset", offset))
        url = f"{API}/{OPS_BASE}/{table_id}?" + urllib.parse.urlencode(params)
        data = _get(url, token)
        rows.extend(data.get("records", []))
        offset = data.get("offset")
        if not offset:
            break
    return rows


def choice_names(table: dict, field_name: str) -> list[str]:
    for f in table.get("fields", []):
        if f.get("name") == field_name and f.get("type") in ("singleSelect", "multipleSelects"):
            return [c["name"] for c in f.get("options", {}).get("choices", [])]
    return []


def pick_active(status_choices: list[str]) -> str | None:
    for c in status_choices:
        if c.strip().lower() == "active":
            return c
    return None


def preflight(meta: dict) -> tuple[dict, list[str]]:
    """Verify Sam's data contract. Returns (resolved, problems). resolved has table ids + option names."""
    problems: list[str] = []
    tables = {t["name"]: t for t in meta.get("tables", [])}
    resolved: dict = {}

    pc = tables.get("Palm Creators")
    posts = tables.get("Posts")
    if not pc:
        problems.append("table `Palm Creators` is gone/renamed")
    if not posts:
        problems.append("table `Posts` is gone/renamed")
    if problems:
        return resolved, problems

    resolved["pc_id"] = pc["id"]
    resolved["posts_id"] = posts["id"]
    pc_fields = {f["name"]: f for f in pc.get("fields", [])}
    posts_fields = {f["name"]: f for f in posts.get("fields", [])}

    for fld in ("Status", "Weekly Reel Quota", "Creator"):
        if fld not in pc_fields:
            problems.append(f"Palm Creators.`{fld}` is gone/renamed")
    for fld in ("Creator", "Type", "Scheduled Date", "Status"):
        if fld not in posts_fields:
            problems.append(f"Posts.`{fld}` is gone/renamed")

    active = pick_active(choice_names(pc, "Status"))
    if not active:
        problems.append("Palm Creators.Status has no `Active` option")
    resolved["active_value"] = active

    type_choices = choice_names(posts, "Type")
    if "Reel" not in type_choices:
        problems.append("Posts.Type has no `Reel` option")
    resolved["posts_status_choices"] = choice_names(posts, "Status")
    return resolved, problems


def week_bounds(start: str) -> tuple[date, date, int]:
    today = date.today()
    if start == "sunday":
        ws = today - timedelta(days=(today.weekday() + 1) % 7)
    else:  # monday
        ws = today - timedelta(days=today.weekday())
    we = ws + timedelta(days=7)
    days_elapsed = (today - ws).days + 1  # inclusive of today
    return ws, we, days_elapsed


def build_report(token: str, week_start: str) -> str:
    meta = get_meta(token)
    resolved, problems = preflight(meta)
    today = date.today()

    if problems:
        lines = [f"SAM — content supply · {today.isoformat()}",
                 "⚠️ DATA CHANGED — I can't trust my numbers until my contract is updated.",
                 "Someone edited the Airtable schema. What's missing/renamed:"]
        lines += [f"  - {p}" for p in problems]
        lines.append("Bottom line: fix the data contract (see scripts/agents/sam_quota.py) — no quota count this run.")
        return "\n".join(lines)

    ws, we, days_elapsed = week_bounds(week_start)
    active_val = resolved["active_value"]

    # Active creators with a quota.
    creators = fetch_all(token, resolved["pc_id"], ["Creator", "Status", "Weekly Reel Quota"])
    id_to_name: dict[str, str] = {}
    active_with_quota: list[tuple[str, float]] = []   # (name, quota)
    active_no_quota: list[str] = []
    name_counts: dict[str, int] = {}
    for r in creators:
        f = r.get("fields", {})
        name = (f.get("Creator") or "").strip() or f"(unnamed {r['id'][:6]})"
        id_to_name[r["id"]] = name
        if f.get("Status") == active_val:
            name_counts[name] = name_counts.get(name, 0) + 1
            quota = f.get("Weekly Reel Quota")
            if quota and quota > 0:
                active_with_quota.append((name, float(quota)))
            else:
                active_no_quota.append(name)

    # Posts scheduled this calendar week.
    formula = (f"AND(IS_AFTER({{Scheduled Date}}, '{(ws - timedelta(days=1)).isoformat()}'),"
               f"IS_BEFORE({{Scheduled Date}}, '{we.isoformat()}'))")
    posts = fetch_all(token, resolved["posts_id"], ["Creator", "Type", "Scheduled Date", "Status"], formula)

    reels_by_name: dict[str, int] = {}
    posts_no_type = 0
    failed_sends = 0
    fail_statuses = [s for s in resolved.get("posts_status_choices", []) if "fail" in s.lower() or "error" in s.lower()]
    for r in posts:
        f = r.get("fields", {})
        sd = f.get("Scheduled Date")
        if sd:
            try:
                d = datetime.fromisoformat(sd.replace("Z", "+00:00")).date()
                if not (ws <= d < we):
                    continue
            except ValueError:
                pass
        typ = f.get("Type")
        if not typ:
            posts_no_type += 1
        if f.get("Status") in fail_statuses:
            failed_sends += 1
        if typ == "Reel":
            for cid in (f.get("Creator") or []):
                nm = id_to_name.get(cid, cid)
                reels_by_name[nm] = reels_by_name.get(nm, 0) + 1

    # Behind-pace vs pro-rated target.
    behind, on_track = [], []
    for name, quota in sorted(active_with_quota, key=lambda x: x[0].lower()):
        got = reels_by_name.get(name, 0)
        target = round(quota * (days_elapsed / 7.0))
        if got < target:
            behind.append(f"  - {name}: {got} of {target} reels so far (quota {int(quota)}/wk)")
        else:
            on_track.append(name)

    dupes = [n for n, c in name_counts.items() if c > 1]

    out = [f"SAM — content supply · {today.isoformat()} (week so far: day {days_elapsed}/7)",
           "data check: ✅ all fields + Active/Reel values present", ""]
    if behind:
        out.append(f"Behind pace ({len(behind)}):")
        out += behind
    else:
        out.append("Behind pace (0): none — everyone's at or above pace.")
    out.append(f"On track ({len(on_track)}): " + (", ".join(on_track) if on_track else "—"))
    out.append("")
    out.append("Heads up (data hygiene):")
    any_flag = False
    if active_no_quota:
        any_flag = True
        out.append(f"  - {len(active_no_quota)} active creators have no quota set (invisible to tracking): "
                   + ", ".join(sorted(active_no_quota)))
    if posts_no_type:
        any_flag = True
        out.append(f"  - {posts_no_type} posts this week have no Type — reel counts may run low")
    if failed_sends:
        any_flag = True
        out.append(f"  - {failed_sends} posts this week have a failed/error status")
    if dupes:
        any_flag = True
        out.append(f"  - duplicate active creator name(s): {', '.join(dupes)}")
    if not any_flag:
        out.append("  - none")
    out.append("")
    if behind:
        out.append(f"Bottom line: nudge {len(behind)} creator(s) behind pace — "
                   + ", ".join(b.split(':')[0].strip('  - ') for b in behind) + ".")
    else:
        out.append("Bottom line: all active creators on pace this week. ✅")
    return "\n".join(out)


def maybe_telegram(report: str) -> None:
    token = read_env("TELEGRAM_BOT_TOKEN") or read_env("TELEGRAM_TOKEN")
    chat = read_env("SAM_TELEGRAM_CHAT_ID") or read_env("RESEARCH_TELEGRAM_CHAT_ID")
    if not token or not chat:
        return
    try:
        body = json.dumps({"chat_id": chat, "text": report}).encode()
        req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage",
                                     data=body, headers={"content-type": "application/json"})
        urllib.request.urlopen(req, timeout=30)
    except Exception:
        pass


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Sam — content-supply quota monitor (read-only).")
    ap.add_argument("--week-start", choices=["monday", "sunday"], default="monday")
    ap.add_argument("--no-telegram", action="store_true")
    args = ap.parse_args(argv[1:])

    token = read_env("AIRTABLE_PAT") or read_env("AIRTABLE_API_KEY")
    if not token:
        print("ERROR: no AIRTABLE_PAT in env or .env.local", file=sys.stderr)
        return 2
    try:
        report = build_report(token, args.week_start)
    except urllib.error.HTTPError as e:
        print(f"SAM — Airtable API error HTTP {e.code}: {e.read()[:200]!r}", file=sys.stderr)
        return 1
    print(report)
    if not args.no_telegram:
        maybe_telegram(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
