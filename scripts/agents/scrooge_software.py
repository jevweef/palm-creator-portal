#!/usr/bin/env python3
"""
scrooge_software.py — "Scrooge", software-cost monitor (read-only).

Audits the HQ Software Stack table each morning: total active monthly burn,
zombie subs (Active but no recent charge), cancellation-date-passed-but-still-
live (real money leaking), cancel candidates, and stuck "Evaluating" tools.
Reports up to Marcus (Revenue) → Maya. Never cancels anything — flags only.

HONEST LIMIT: the Software Stack table is MANUALLY curated (no bank feed), so
Scrooge only audits what's already IN the table — it canNOT catch NEW/unrecorded
charges or price hikes. v2 (separate build) = ingest Evan's Chase CSV and diff
against the table to catch untracked spend / price changes / silently-still-billing.
"""
from __future__ import annotations

import sys
from datetime import date

from palm_agent import (airtable_token, get_meta, fetch_all, finding,
                        write_report, emit_error, cfg, excluded)

HQ = "appL7c4Wtotpz07KS"
T_STACK = "tblaRUtlRQcVLV5aM"
STALE_DAYS = cfg("scrooge", "stale_days", 45)
EVAL_DAYS = cfg("scrooge", "eval_days", 30)
# Subs to nudge toward cutting. NOTE: OpenAI/WaveSpeed are intentionally KEPT
# (credits/pay-per-use, pennies — not cancel targets), so they're NOT listed.
CANCEL_CANDIDATES = [s.lower() for s in cfg("scrooge", "cancel_candidates",
                     ["contentsnare", "content snare"])]


def preflight(token):
    t = {x["name"]: x for x in get_meta(token, HQ).get("tables", [])}.get("Software Stack")
    if not t:
        return ["HQ `Software Stack` gone/renamed"]
    have = {f["name"] for f in t["fields"]}
    return [f"Software Stack.`{x}`" for x in ("Name", "Status", "Monthly Cost", "Last Payment") if x not in have]


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
        emit_error(id="scrooge", teammate="Scrooge", dept="Revenue", problems=problems)
        print("Scrooge: DATA CHANGED — " + "; ".join(problems), file=sys.stderr); return 1

    today = date.today()
    mute = {m.lower() for m in excluded("scrooge")}
    rows = fetch_all(token, HQ, T_STACK,
                     ["Name", "Status", "Category", "Monthly Cost", "Last Payment", "Notes", "Cancellation Date"])

    burn = 0.0
    active_n = 0
    review, leaks, evaluating = [], [], []   # review = one entry per Active sub w/ issues
    for r in rows:
        f = r.get("fields", {})
        name = f.get("Name") or "?"
        if name.lower() in mute:
            continue
        status = f.get("Status") or ""
        cost = float(f.get("Monthly Cost") or 0)
        lastpay = to_date(f.get("Last Payment"))
        canceldate = to_date(f.get("Cancellation Date"))
        notes = f.get("Notes") or ""
        nm = name.lower()

        if status == "Active":
            burn += cost
            active_n += 1
            # one line per sub — combine reasons so a stale cancel-candidate isn't listed twice
            reasons = []
            if cost > 0:   # only chase things that actually cost money ($0 rows are noise)
                if lastpay is None:
                    reasons.append("no charge on record")
                elif (today - lastpay).days > STALE_DAYS:
                    reasons.append(f"last charge {(today - lastpay).days}d ago")
            if any(c in nm or nm in c for c in CANCEL_CANDIDATES) or any(w in notes.lower() for w in ("cancel", "replace", "redundant")):
                reasons.append("flagged to cut" + (f" ({notes[:46].strip()})" if notes else ""))
            if reasons:
                review.append((cost, f"{name} (${cost:,.0f}/mo): {'; '.join(reasons)}."))

        # cancellation date passed but still not Cancelled = real money still leaking
        if canceldate and canceldate < today and status != "Cancelled":
            leaks.append(f"{name}: cancel date {canceldate} passed but Status={status} — confirm the charge actually stopped.")

        if status == "Evaluating" and lastpay and (today - lastpay).days > EVAL_DAYS:
            evaluating.append(f"{name} (${cost:,.0f}/mo): evaluating {(today - lastpay).days}d — keep or cut?")

    review.sort(reverse=True)   # priciest first
    findings = [finding(f"Active software burn: ${burn:,.0f}/mo across {active_n} tools.", "green")]
    for x in leaks:
        findings.append(finding(x, "red"))
    for _, x in review:
        findings.append(finding(x, "amber"))
    for x in evaluating:
        findings.append(finding(x, "amber"))

    reds = len(leaks)
    n_review = len(review) + len(evaluating)
    if reds:
        headline = f"${burn:,.0f}/mo burn · {reds} still billing after cancel, {n_review} to review"
    elif n_review:
        headline = f"${burn:,.0f}/mo burn · {n_review} sub(s) to review"
    else:
        headline = f"${burn:,.0f}/mo software burn — nothing to action"

    rep = write_report(id="scrooge", teammate="Scrooge", dept="Revenue", tier="worker", reports_to="marcus",
                       headline=headline, findings=findings,
                       notes=(f"Read-only audit of the HQ Software Stack table. MANUALLY curated — Scrooge can't see "
                              f"NEW/unrecorded charges or price hikes; v2 = Chase CSV diff. Stale >{STALE_DAYS}d, eval >{EVAL_DAYS}d."))
    print(f"Scrooge: {rep['urgency'].upper()} — {headline}")
    for x in findings:
        print(f"  [{x['urgency']}] {x['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
