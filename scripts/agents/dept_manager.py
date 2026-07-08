#!/usr/bin/env python3
"""
dept_manager.py — generic department-head roll-up (read-only).

A manager doesn't re-compute; it reads its workers' reports off the bus, escalates
the red/amber items upward (attributed to the worker), notes any worker that
didn't report, and emits ONE department report (tier=manager) for Maya. This is
how the middle-management layer keeps Maya's brief organized by department without
each worker reporting to her directly.

Usage:
  python3 dept_manager.py --id theo --teammate Theo --dept "Content Production" \
      --workers jordan,mara,devin

Runs AFTER the workers (08:30-08:41) and BEFORE Maya (08:45).
"""
from __future__ import annotations

import argparse
import sys

import json
import os
import re
import urllib.request

from palm_agent import read_reports, rollup_findings, finding, write_report, read_env

# Each department's Telegram topic in the Palm Team group (created 2026-07-07).
# The manager posts its FULL daily roll-up there — Evan wanted per-department
# depth, not just Maya's synthesis.
PALM_TEAM_CHAT = "-1004293138854"
DEPT_TOPICS = {"theo": 65, "vivian": 66, "marcus": 67, "nova": 68, "iris": 69, "dana": 70}
URGENCY_MARK = {"red": "🔴", "amber": "🟡", "green": "🟢"}


def conversational_digest(teammate, dept, findings):
    """Rewrite the findings into a short human note (Evan: 'more conversational,
    not a stats dump'). Uses the API when a key exists; otherwise skipped."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return None
    facts = "\n".join(re.sub(r"https?://\S+", "", f"[{f.get('urgency')}] {f.get('text', '')}").strip() for f in findings)
    prompt = (f"You are {teammate}, the {dept} department manager at an OnlyFans agency, "
              f"writing your short daily note to the owner (Evan). Below are today's raw findings.\n\n"
              f"Write 2-5 conversational sentences: what matters most, what he (or the team) should do, "
              f"and what's fine. Plain English, warm and direct, like a sharp colleague — no bullet lists, "
              f"no emoji, no headings. LAYMAN'S TERMS: say the creator's name, what the item actually is, "
              f"how long it's been sitting, and which page of the portal it lives on — never internal jargon "
              f"like 'cards', 'staged', or 'in a failed state'. Only flag urgency the findings justify: a "
              f"week sitting = worth a look, two weeks = urgent. NEVER mention anything not in the findings; "
              f"never invent drafts or work products. If everything is green, one relaxed sentence.\n\nFINDINGS:\n{facts}")
    try:
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=json.dumps({"model": "claude-sonnet-4-6", "max_tokens": 400,
                             "messages": [{"role": "user", "content": prompt}]}).encode(),
            headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=90) as resp:
            data = json.loads(resp.read())
        return "".join(b.get("text", "") for b in data.get("content", [])).strip() or None
    except Exception:
        return None


def post_dept_summary(dept_id, teammate, dept, findings, missing):
    thread = DEPT_TOPICS.get(dept_id)
    token = read_env("TELEGRAM_HEARTBEAT_BOT_TOKEN")
    if not thread or not token:
        return
    reds = [f for f in findings if f.get("urgency") == "red"]
    ambers = [f for f in findings if f.get("urgency") == "amber"]
    head = f"{teammate} — {dept} daily ({'RED' if reds else 'AMBER' if ambers else 'GREEN'}): {len(reds)} red, {len(ambers)} amber"
    lines = [head]
    digest = conversational_digest(teammate, dept, findings)
    if digest:
        lines += ["", digest, "", "— details —"]
    else:
        lines.append("")
    for f in findings:
        mark = URGENCY_MARK.get(f.get("urgency"), "•")
        lines.append(f"{mark} {f.get('text', '')}")
    if missing:
        lines.append(f"⚠ no report from: {', '.join(missing)}")
    def esc(t):
        return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    html_lines = []
    for ln in lines:
        ln = esc(ln)
        ln = re.sub(r"https?://\S+", lambda m: f'<a href="{m.group(0)}">open it</a>', ln)
        html_lines.append(ln)
    text = "\n".join(html_lines)[:4000]
    try:
        body = json.dumps({"chat_id": PALM_TEAM_CHAT, "message_thread_id": thread,
                           "text": text, "parse_mode": "HTML",
                           "disable_web_page_preview": True}).encode()
        req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage",
                                     data=body, headers={"content-type": "application/json"})
        urllib.request.urlopen(req, timeout=30)
    except Exception as e:  # noqa: BLE001
        print(f"{teammate}: topic post failed: {e}", file=sys.stderr)

WORKER_NAMES = {  # id -> display, for the "didn't report" note
    "sam-quota": "Sam", "jerry": "Jerry", "devin": "Devin",
    "riley": "Riley", "olive": "Olive", "quinn": "Quinn", "wendy": "Wendy",
    "ed": "Ed", "ivy": "Ivy", "nico": "Nico", "bea": "Bea", "ana": "Ana",
    "ofm-research": "OFM Intel", "charts": "Charts", "cleo": "Cleo", "wes": "Wes",
    "pax": "Pax", "cody": "Cody", "penny": "Penny",
}


def main(argv) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", required=True)
    ap.add_argument("--teammate", required=True)
    ap.add_argument("--dept", required=True)
    ap.add_argument("--workers", required=True, help="comma-separated worker ids")
    args = ap.parse_args(argv[1:])

    worker_ids = [w.strip() for w in args.workers.split(",") if w.strip()]
    reports = read_reports(worker_ids)

    findings = []
    # escalate red/amber worker findings, attributed
    findings += rollup_findings(reports)

    # health counts + missing-worker accountability
    reds = sum(1 for r in reports.values() if r.get("urgency") == "red")
    ambers = sum(1 for r in reports.values() if r.get("urgency") == "amber")
    greens = sum(1 for r in reports.values() if r.get("urgency") == "green")
    errored = [WORKER_NAMES.get(i, i) for i, r in reports.items() if r.get("status") == "error"]
    missing = [WORKER_NAMES.get(w, w) for w in worker_ids if w not in reports]

    if errored:
        findings.append(finding(f"{', '.join(errored)} hit a data-contract error this run (numbers untrusted).", "red"))
    if missing:
        findings.append(finding(f"No report today from: {', '.join(missing)} (didn't run or crashed).", "amber"))

    if not findings:
        findings.append(finding(f"{args.dept}: all {greens} teammates green — nothing to escalate.", "green"))

    bad = any(x["urgency"] != "green" for x in findings)
    headline = (f"{args.dept}: {reds} red, {ambers} amber across {len(reports)}/{len(worker_ids)} teammates"
                if bad else f"{args.dept}: all clear ({greens} teammates green)")
    rep = write_report(id=args.id, teammate=args.teammate, dept=args.dept, tier="manager",
                       reports_to="maya", headline=headline, findings=findings,
                       notes=f"Department roll-up of {', '.join(WORKER_NAMES.get(w, w) for w in worker_ids)}. Read-only.")
    print(f"{args.teammate}: {rep['urgency'].upper()} — {headline}")
    for x in findings:
        print(f"  [{x['urgency']}] {x['text']}")
    post_dept_summary(args.id, args.teammate, args.dept, findings, missing)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
