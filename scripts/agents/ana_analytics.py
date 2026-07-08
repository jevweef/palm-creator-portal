#!/usr/bin/env python3
"""
ana_analytics.py — "Ana", analytics reporter (read-only).

Owns the DASHBOARD-native signals so it doesn't duplicate peers: revenue
period-over-period trend, and OFTV final cuts waiting on admin review. (Reel
runway + For-Review backlog stay Sam/Mara's; invoice problems stay Ivy's.)
Reports up to Nova → Maya.

Verified: HQ Creator Invoices (Weekly) tblKbU8VkdlOHXoJj (Earnings (TR),
Net Profit, Period Start/End), OPS OFTV tbl7DTdRooCsAns7j (Status='Final
Submitted'). The admin dashboard route is Clerk-gated, so Ana reads the
underlying tables directly via PAT.
Proposed: revenue-drop flag at trDelta < -15% (NEEDS EVAN).
"""
from __future__ import annotations

import sys
from collections import defaultdict

from palm_agent import (airtable_token, get_meta, fetch_all, finding,
                        write_report, emit_error)

HQ = "appL7c4Wtotpz07KS"
OPS = "applLIT2t83plMqNx"
T_INV = "tblKbU8VkdlOHXoJj"
T_OFTV = "tbl7DTdRooCsAns7j"
DROP = -0.15


def preflight(token):
    problems = []
    hq = {t["name"]: t for t in get_meta(token, HQ).get("tables", [])}
    ops = {t["name"]: t for t in get_meta(token, OPS).get("tables", [])}
    if not hq.get("Creator Invoices (Weekly)"):
        problems.append("HQ `Creator Invoices (Weekly)` gone/renamed")
    oftv = next((t for t in ops.values() if t["id"] == T_OFTV), None)
    if not oftv:
        problems.append("OPS OFTV table (tbl7DTdRooCsAns7j) gone")
    return problems


def main():
    token = airtable_token()
    problems = preflight(token)
    if problems:
        emit_error(id="ana", teammate="Ana", dept="Intelligence", problems=problems)
        print("Ana: DATA CHANGED — " + "; ".join(problems), file=sys.stderr); return 1

    findings = []

    # --- revenue trend (period over period) ---
    inv = fetch_all(token, HQ, T_INV, ["Earnings (TR)", "Net Profit", "Period Start", "Period End", "AKA (from Creator)"])
    by_period = defaultdict(lambda: {"tr": 0.0, "creators": defaultdict(float)})
    for r in inv:
        f = r.get("fields", {})
        ps, pe = f.get("Period Start"), f.get("Period End")
        if not (ps and pe):
            continue
        key = (str(ps)[:10], str(pe)[:10])
        by_period[key]["tr"] += float(f.get("Earnings (TR)") or 0)
        aka = f.get("AKA (from Creator)")
        nm = aka[0] if isinstance(aka, list) and aka else "?"
        by_period[key]["creators"][nm] += float(f.get("Earnings (TR)") or 0)
    periods = sorted(by_period.keys(), key=lambda k: k[1])  # by Period End
    if len(periods) >= 2:
        cur, prev = periods[-1], periods[-2]
        tr_cur, tr_prev = by_period[cur]["tr"], by_period[prev]["tr"]
        if tr_prev > 0:
            delta = (tr_cur - tr_prev) / tr_prev
            if delta < DROP:
                # name the biggest per-creator drops
                drops = []
                for nm, v in by_period[cur]["creators"].items():
                    pv = by_period[prev]["creators"].get(nm, 0)
                    if pv > 0 and (v - pv) / pv < DROP:
                        drops.append(f"{nm} {((v-pv)/pv)*100:.0f}%")
                tail = f" — biggest: {', '.join(sorted(drops)[:4])}" if drops else ""
                findings.append(finding(
                    f"Revenue down {delta*100:.0f}% vs last period (${tr_prev:,.0f}→${tr_cur:,.0f}){tail}.", "amber"))

    # --- OFTV final cuts awaiting review ---
    oftv = fetch_all(token, OPS, T_OFTV, ["Status", "Project Name", "Creator"])
    waiting = [(o.get("fields", {}).get("Project Name") or "?") for o in oftv
               if o.get("fields", {}).get("Status") == "Final Submitted"]
    if waiting:
        findings.append(finding(
            f"{len(waiting)} OFTV final cut(s) delivered and waiting on your review: {', '.join(waiting[:6])}.", "red"))

    if not findings:
        findings.append(finding("Analytics clear — revenue stable vs last period, no OFTV cuts awaiting review.", "green"))

    bad = any(x["urgency"] != "green" for x in findings)
    headline = ("revenue/OFTV exceptions" if bad else "Analytics clear")
    rep = write_report(id="ana", teammate="Ana", dept="Intelligence", tier="worker", reports_to="nova",
                       headline=headline, findings=findings,
                       notes=f"Read-only (PAT, dashboard math ported). Owns revenue trend + OFTV; defers runway/backlog to Sam/Mara, invoices to Ivy. Drop flag {int(DROP*100)}% (proposed).")
    print(f"Ana: {rep['urgency'].upper()} — {headline}")
    for x in findings:
        print(f"  [{x['urgency']}] {x['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
