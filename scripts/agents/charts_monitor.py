#!/usr/bin/env python3
"""
charts_monitor.py — "Charts", music-chart cache freshness monitor (read-only).

Confirm the TikTok Top 100 + Billboard Hot 100 (Spotify-enriched) caches the
editor's music picker reads are fresh. Reports up to Nova → Maya. Flags only when
a cache is stale/empty/under-enriched.

NOTE: this is the read-only WATCH half. The actual auto-refresh job (a Vercel cron
that re-scrapes + writes the cache, incl. adding the currently-missing TikTok
write) is a separate code+deploy task — flagged in notes, not done here.

Verified: OPS Roadmap & Automations tbl0k3UErL1JRObHD, rows Step='TikTok Chart
Cache' / 'Billboard Chart Cache', Notes = JSON {scrapedAt, tracks:[{...spotifyId}]}.
Stale at >48h (the reader's window).
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone

from palm_agent import (airtable_token, get_meta, fetch_all, finding,
                        write_report, emit_error)

OPS = "applLIT2t83plMqNx"
T_ROADMAP = "tbl0k3UErL1JRObHD"
STALE_H = 48
ROWS = {"TikTok Chart Cache": "TikTok", "Billboard Chart Cache": "Billboard"}


def preflight(token):
    t = next((x for x in get_meta(token, OPS).get("tables", []) if x["id"] == T_ROADMAP), None)
    if not t:
        return ["OPS Roadmap & Automations (tbl0k3UErL1JRObHD) gone"]
    have = {f["name"] for f in t["fields"]}
    return [f"Roadmap.`{x}`" for x in ("Step", "Notes") if x not in have]


def main():
    token = airtable_token()
    problems = preflight(token)
    if problems:
        emit_error(id="charts", teammate="Charts", dept="Intelligence", problems=problems)
        print("Charts: DATA CHANGED — " + "; ".join(problems), file=sys.stderr); return 1

    now = datetime.now(timezone.utc)
    rows = {r.get("fields", {}).get("Step"): r.get("fields", {}) for r in fetch_all(token, OPS, T_ROADMAP, ["Step", "Notes"])}

    findings = []
    for step, label in ROWS.items():
        f = rows.get(step)
        if not f:
            findings.append(finding(f"{label} cache row missing from Roadmap & Automations.", "red"))
            continue
        try:
            blob = json.loads(f.get("Notes") or "{}")
        except (ValueError, TypeError):
            findings.append(finding(f"{label} cache unreadable (Notes not JSON).", "red")); continue
        tracks = blob.get("tracks") or []
        scraped = blob.get("scrapedAt")
        age_h = None
        if scraped:
            try:
                age_h = (now - datetime.fromisoformat(str(scraped).replace("Z", "+00:00"))).total_seconds() / 3600.0
            except ValueError:
                pass
        enriched = sum(1 for t in tracks if t.get("spotifyId"))
        ratio = (enriched / len(tracks)) if tracks else 0
        if age_h is None or age_h > STALE_H:
            findings.append(finding(f"{label} cache stale ({age_h:.0f}h old)" if age_h else f"{label} cache has no scrapedAt — editor on slow live fallback.", "red"))
        elif not tracks:
            findings.append(finding(f"{label} cache empty — picker may run dry.", "amber"))
        elif ratio < 0.5:
            findings.append(finding(f"{label} cache only {ratio*100:.0f}% Spotify-enriched ({enriched}/{len(tracks)}).", "amber"))

    if not findings:
        findings.append(finding("Both music-chart caches fresh (<48h), populated, and enriched.", "green"))

    bad = any(x["urgency"] != "green" for x in findings)
    headline = ("music-chart cache stale/degraded" if bad else "Chart caches fresh")
    rep = write_report(id="charts", teammate="Charts", dept="Intelligence", tier="worker", reports_to="nova",
                       headline=headline, findings=findings,
                       notes="Read-only freshness check. The auto-refresh cron (re-scrape + write, incl. the missing TikTok cache write) is a separate deploy task, NOT yet built.")
    print(f"Charts: {rep['urgency'].upper()} — {headline}")
    for x in findings:
        print(f"  [{x['urgency']}] {x['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
