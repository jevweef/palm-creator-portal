#!/usr/bin/env python3
"""
ed_earnings.py — "Ed", earnings-steward monitor (read-only).

The OF Transactions Google Sheet is hand-pasted (OF has no API), so tabs go
stale/missing and invoices silently undercount. Ed watches that seam: missing
Sales tabs, stale tabs, and per-account coverage holes — louder on the day
before invoices generate (14th / last-of-month). Reports up to Marcus → Maya.

Verified: Google OAuth creds present in .env.local; HQ Revenue Accounts
tblQqPWlsjiyJA0ba (filter Active + Platform=OnlyFans; coverage fields
Earnings Data End / Earnings Last Upload).
Proposed: staleness SLA 3 days (NEEDS EVAN).
"""
from __future__ import annotations

import json
import sys
import urllib.request
from datetime import date, datetime, timedelta

from palm_agent import (airtable_token, get_meta, fetch_all, finding,
                        write_report, emit_error, read_env, google_access_token,
                        sheets_values, cfg, excluded)

HQ = "appL7c4Wtotpz07KS"
T_REV = "tblQqPWlsjiyJA0ba"
STALE_DAYS = cfg("ed", "STALE_DAYS", 3)


def sheet_titles(sid, token):
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{sid}?fields=sheets(properties(title))"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=45) as r:
        data = json.loads(r.read().decode())
    return {s["properties"]["title"] for s in data.get("sheets", [])}


def newest_date(values):
    best = None
    for row in values:
        if not row:
            continue
        s = str(row[0])[:10]
        try:
            d = date.fromisoformat(s)
        except ValueError:
            try:
                d = datetime.strptime(s, "%m/%d/%Y").date()
            except ValueError:
                continue
        if best is None or d > best:
            best = d
    return best


def main():
    token = airtable_token()
    tables = {t["name"]: t for t in get_meta(token, HQ).get("tables", [])}
    if not tables.get("Revenue Accounts"):
        emit_error(id="ed", teammate="Ed", dept="Revenue", problems=["HQ `Revenue Accounts` gone/renamed"]); return 1

    sid = read_env("OF_TRANSACTIONS_SPREADSHEET_ID")
    if not sid:
        emit_error(id="ed", teammate="Ed", dept="Revenue", problems=["OF_TRANSACTIONS_SPREADSHEET_ID not set — cannot check sheet freshness"]); return 1

    try:
        gtok = google_access_token()
        titles = sheet_titles(sid, gtok)
    except Exception as e:  # noqa: BLE001
        emit_error(id="ed", teammate="Ed", dept="Revenue", problems=[f"Google Sheets unreachable: {e}"])
        print(f"Ed: SOURCE UNREACHABLE — {e}", file=sys.stderr); return 1

    accts = fetch_all(token, HQ, T_REV, ["Account Name", "Platform", "Status", "Earnings Data End"])
    active = [r.get("fields", {}) for r in accts
              if r.get("fields", {}).get("Status") == "Active" and r.get("fields", {}).get("Platform") == "OnlyFans"]

    mute = excluded("ed")
    today = date.today()
    yesterday = today - timedelta(days=1)
    pre_invoice = today.day == 14 or (today + timedelta(days=1)).day == 1  # day before the 15th / 1st
    missing, stale, holes = [], [], []
    stale_names = set()
    for f in active:
        name = f.get("Account Name") or "?"
        if name in mute:                       # account on a known break / ignore
            continue
        tab = f"{name} - Sales"
        if tab not in titles:
            missing.append(name); continue
        try:
            vals = sheets_values(sid, f"'{tab}'!A4:A", gtok)
            newest = newest_date(vals)
            if newest is None or (today - newest).days > STALE_DAYS:
                stale.append(f"{name} ({(today-newest).days}d)" if newest else f"{name} (empty)")
                stale_names.add(name)
        except Exception:  # noqa: BLE001
            missing.append(name)
        cov_end = f.get("Earnings Data End")
        if cov_end and name not in stale_names:   # a stale tab already explains the gap — don't double-count
            try:
                if date.fromisoformat(str(cov_end)[:10]) < yesterday:
                    holes.append(name)
            except ValueError:
                pass

    findings = []
    sev = "red" if pre_invoice else "amber"
    if missing:
        findings.append(finding(f"{len(missing)} OnlyFans account(s) have no sales records at all in our money sheet — their earnings aren't being tracked: {', '.join(missing)}.", sev))
    if stale:
        findings.append(finding(f"{len(stale)} account(s)' sales records have stopped updating — earnings numbers on the site are behind until they catch up: {', '.join(stale)}.", sev))
    if holes:
        findings.append(finding(f"{len(holes)} account(s) have a hole in their earnings history that needs a refresh: {', '.join(holes)}.", "amber"))
    if pre_invoice and (missing or stale):
        findings.append(finding("Invoices generate TOMORROW — if the above isn't fixed today, creators get billed on wrong numbers.", "red"))
    if not findings:
        findings.append(finding(f"All {len(active)} active OF accounts have fresh Sales tabs within {STALE_DAYS}d; coverage current.", "green"))

    bad = any(x["urgency"] != "green" for x in findings)
    headline = ((f"{len(stale)} OF tab(s) un-pasted (>{STALE_DAYS}d)"
                 + (f", {len(missing)} missing" if missing else "")
                 + (f", {len(holes)} extra coverage gap(s)" if holes else "")) if bad else "Earnings data fresh")
    rep = write_report(id="ed", teammate="Ed", dept="Revenue", tier="worker", reports_to="marcus",
                       headline=headline, findings=findings,
                       notes=f"Read-only. Probes the OF Transactions sheet + Airtable coverage. SLA {STALE_DAYS}d (proposed). Loud on source failure, never a false all-clear.")
    print(f"Ed: {rep['urgency'].upper()} — {headline}")
    for x in findings:
        print(f"  [{x['urgency']}] {x['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
