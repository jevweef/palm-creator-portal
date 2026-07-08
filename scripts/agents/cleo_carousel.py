#!/usr/bin/env python3
"""
cleo_carousel.py — "Cleo", AI-carousel QA monitor (read-only).

Surface pending AI carousel batches awaiting human review. Reports up to Iris →
Maya. The slide-by-slide vision grading + source comparison is deferred (needs a
claude -p vision pass; and source pairing is currently broken — all Carousel
Projects have a null Submission Batch ID). Cleo notifies that batches are waiting.

Verified: OPS Photos tblUXDbaZGYGf2E5O (Source Type='AI Generated', Review
Status='Pending', Submission Batch ID).
Proposed: a pending batch turns RED at >3 days (NEEDS EVAN).
"""
from __future__ import annotations

import sys
from collections import defaultdict

from palm_agent import (airtable_token, get_meta, fetch_all, finding,
                        write_report, emit_error)

OPS = "applLIT2t83plMqNx"
T_PHOTOS = "tblUXDbaZGYGf2E5O"


def preflight(token):
    t = {x["name"]: x for x in get_meta(token, OPS).get("tables", [])}.get("Photos")
    if not t:
        return ["OPS `Photos` gone/renamed"]
    have = {f["name"] for f in t["fields"]}
    return [f"Photos.`{x}`" for x in ("Source Type", "Review Status", "Submission Batch ID") if x not in have]


def main():
    token = airtable_token()
    problems = preflight(token)
    if problems:
        emit_error(id="cleo", teammate="Cleo", dept="AI Studio", problems=problems)
        print("Cleo: DATA CHANGED — " + "; ".join(problems), file=sys.stderr); return 1

    photos = fetch_all(token, OPS, T_PHOTOS, ["Source Type", "Review Status", "Submission Batch ID", "Submission Title", "Creator"])
    batches = defaultdict(int)
    for p in photos:
        f = p.get("fields", {})
        if f.get("Source Type") == "AI Generated" and f.get("Review Status") == "Pending":
            bid = f.get("Submission Batch ID") or "(no batch id)"
            batches[bid] += 1

    findings = []
    if batches:
        total = sum(batches.values())
        findings.append(finding(f"{len(batches)} AI carousel batch(es) ({total} slides) pending review. Slide-by-slide QA is manual until vision grading is wired.", "amber"))
    else:
        findings.append(finding("No AI carousel batches pending review.", "green"))

    bad = any(x["urgency"] != "green" for x in findings)
    headline = (f"{len(batches)} carousel batch(es) pending review" if bad else "No carousels pending")
    rep = write_report(id="cleo", teammate="Cleo", dept="AI Studio", tier="worker", reports_to="iris",
                       headline=headline, findings=findings,
                       notes="Read-only count. Vision slide-QA + source comparison deferred (source pairing broken: Carousel Projects have null batch IDs). RED at >3d pending (proposed).")
    print(f"Cleo: {rep['urgency'].upper()} — {headline}")
    for x in findings:
        print(f"  [{x['urgency']}] {x['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
