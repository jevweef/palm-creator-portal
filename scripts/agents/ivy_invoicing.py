#!/usr/bin/env python3
"""
ivy_invoicing.py — "Ivy", invoicing-clerk monitor (read-only).

Surface invoices that can't go out or aren't getting paid: missing PDF, missing
creator email, empty earnings, and unpaid/overdue. Reports up to Marcus → Maya.
Never sends, never touches Resend.

Verified: HQ Creator Invoices (Weekly) tblKbU8VkdlOHXoJj (Invoice Status has a
stored 'Overdue'; Due Date is a formula), HQ Creators tblYhkNvrNuOAHfgw
(Communication Email). Reads via PAT — no Clerk dependency.
Proposed: overdue RED at 7+ days unpaid (NEEDS EVAN).
"""
from __future__ import annotations

import sys
from datetime import date, datetime

from palm_agent import (airtable_token, get_meta, fetch_all, finding,
                        write_report, emit_error, cfg, excluded)

HQ = "appL7c4Wtotpz07KS"
T_INV = "tblKbU8VkdlOHXoJj"
T_CREATORS = "tblYhkNvrNuOAHfgw"
OVERDUE_RED_DAYS = cfg("ivy", "OVERDUE_RED_DAYS", 7)   # tunable in config.json


def preflight(token):
    tables = {t["name"]: t for t in get_meta(token, HQ).get("tables", [])}
    inv = tables.get("Creator Invoices (Weekly)")
    if not inv:
        return ["HQ `Creator Invoices (Weekly)` gone/renamed"]
    have = {f["name"] for f in inv["fields"]}
    return [f"Invoices.`{x}`" for x in ("Invoice Status", "Amount Paid", "Due Date", "Creator") if x not in have]


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
        emit_error(id="ivy", teammate="Ivy", dept="Revenue", problems=problems)
        print("Ivy: DATA CHANGED — " + "; ".join(problems), file=sys.stderr); return 1

    today = date.today()
    # creator id -> communication email
    email = {}
    for r in fetch_all(token, HQ, T_CREATORS, ["Creator", "Communication Email"]):
        email[r["id"]] = (r.get("fields", {}).get("Communication Email") or "").strip()

    inv = fetch_all(token, HQ, T_INV,
                    ["Creator", "AKA (from Creator)", "Earnings (TR)", "Invoice Status",
                     "Invoice Dropbox Link", "Creator Invoice", "Amount Paid", "Total Commission", "Due Date"])

    def who(f):
        aka = f.get("AKA (from Creator)")
        if isinstance(aka, list) and aka:
            return aka[0]
        for cid in (f.get("Creator") or []):
            return cid
        return "?"

    mute = excluded("ivy")
    overdue, no_pdf, no_email, empty_earn = [], [], [], []
    for r in inv:
        f = r.get("fields", {})
        status = f.get("Invoice Status")
        if status == "Paid":
            continue
        nm = who(f)
        if nm in mute:                         # creator on a payment plan / known exception
            continue
        paid = f.get("Amount Paid") or 0
        total = f.get("Total Commission") or 0
        due = to_date(f.get("Due Date"))
        # overdue / unpaid
        if status in ("Sent", "Overdue") and paid < (total or 0.01):
            if due and due < today:
                overdue.append((nm, (today - due).days, total - paid))
        # missing PDF on a sent/overdue invoice (likely never delivered)
        if status in ("Sent", "Overdue") and not f.get("Invoice Dropbox Link") and not f.get("Creator Invoice"):
            no_pdf.append(nm)
        # missing creator email (can't send)
        if status in ("Draft", "Sent", "Overdue"):
            if not any(email.get(cid) for cid in (f.get("Creator") or [])):
                no_email.append(nm)
        # empty earnings on a non-draft invoice
        if status != "Draft" and not f.get("Earnings (TR)"):
            empty_earn.append(nm)

    findings = []
    for nm, days, owed in sorted(overdue, key=lambda x: -x[1]):
        findings.append(finding(f"{nm}'s invoice is {days} day(s) overdue — ${owed:,.0f} still unpaid.", "red" if days >= OVERDUE_RED_DAYS else "amber"))
    if no_pdf:
        findings.append(finding(f"{len(no_pdf)} sent invoice(s) have NO PDF on file — likely never delivered: {', '.join(sorted(set(no_pdf))[:6])}.", "red"))
    if no_email:
        findings.append(finding(f"{len(set(no_email))} invoice(s) for creators with no email on file — can't send: {', '.join(sorted(set(no_email))[:6])}.", "amber"))
    if empty_earn:
        findings.append(finding(f"{len(set(empty_earn))} non-draft invoice(s) have empty earnings — can't bill correctly: {', '.join(sorted(set(empty_earn))[:6])}.", "amber"))
    if not findings:
        findings.append(finding("Invoicing clean — nothing overdue, all sendable invoices have PDF + email + earnings.", "green"))

    bad = any(x["urgency"] != "green" for x in findings)
    owed_total = sum(o for _, _, o in overdue)
    reds = sum(1 for _, d, _ in overdue if d >= OVERDUE_RED_DAYS)
    headline = ((f"{len(overdue)} overdue invoice(s) — ${owed_total:,.0f} unpaid"
                 + (f", {reds} ≥{OVERDUE_RED_DAYS}d" if reds else "")
                 + (f"; {len(set(no_pdf))} no-PDF" if no_pdf else "")
                 + (f"; {len(set(no_email))} no-email" if no_email else "")) if bad else "Invoicing clean")
    rep = write_report(id="ivy", teammate="Ivy", dept="Revenue", tier="worker", reports_to="marcus",
                       headline=headline, findings=findings,
                       notes=f"Read-only via PAT. Overdue RED at {OVERDUE_RED_DAYS}d (proposed). Never sends — flags only.")
    print(f"Ivy: {rep['urgency'].upper()} — {headline}")
    for x in findings:
        print(f"  [{x['urgency']}] {x['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
