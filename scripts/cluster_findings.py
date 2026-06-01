#!/usr/bin/env python3
"""
cluster_findings.py — Regenerate the semantic grouping that turns kb_build's keyword clusters
into a properly consensus-weighted corpus. This is the second unattended-synthesis piece P7
needs (the first is synthesize_run.py).

Why it exists:
  kb_build.py clusters findings by token overlap, which UNDER-merges — paraphrases of the same
  tactic ("start the first PPV cheap" vs "low first unlock to build a buying habit") stay
  separate, so consensus is artificially low. The fix is an LLM reasoning pass that groups
  same-meaning findings WITHIN a department. That pass used to be done by hand in-session; for a
  scheduled run it must be scripted, and it must be re-run every time the corpus changes because
  kb_build renumbers finding IDs (f0001..) on every rebuild — a stale grouping points at the
  wrong findings.

Flow it sits in (see daily_research.py step 6):
  kb_build.py            -> findings.json   (keyword clusters, ids f0001..fNNNN)
  cluster_findings.py    -> semantic_groups.json   (THIS script — groups current ids by meaning)
  apply_semantic_merge.py-> findings.json   (one finding per group, consensus = # distinct creators)

Output (research/knowledge/semantic_groups.json), the format apply_semantic_merge.py reads:
  { "groups": [ { "department": "pricing",
                  "title": "<canonical one-line tactic name>",
                  "member_ids": ["f0019","f0109", ...] }, ... ] }
Only groups of 2+ findings need listing; ungrouped findings stay as singletons automatically.

Usage:
  python3 scripts/cluster_findings.py                 # findings.json -> semantic_groups.json
  python3 scripts/cluster_findings.py --model claude-sonnet-4-6
  python3 scripts/cluster_findings.py --dry-run       # print groups, don't write

Exit 0 on success, 2 on no API key / no findings.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
import urllib.error
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
FINDINGS = REPO / "research" / "knowledge" / "findings.json"
GROUPS = REPO / "research" / "knowledge" / "semantic_groups.json"

API_URL = "https://api.anthropic.com/v1/messages"
DEFAULT_MODEL = "claude-sonnet-4-6"
ANTHROPIC_VERSION = "2023-06-01"


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


SYSTEM = """You are organizing a knowledge base of OFM-agency tactics. You are given a flat list
of findings, each with an id, a department, a title, and a claim. Some findings are paraphrases of
the SAME underlying tactic stated by different sources; they should be grouped so their confidence
(how many distinct creators independently say it) is counted correctly.

Group findings that assert the SAME actionable tactic. Rules:
- Only group findings in the SAME department.
- Group ONLY genuine paraphrases of one tactic. Do NOT merge tactics that are merely related,
  adjacent, or in the same topic but distinct (e.g. "PPV price ladder" and "free trial subs" are
  DIFFERENT — keep separate). When in doubt, keep them separate. Over-merging is worse than under.
- A group needs 2+ members. Findings that stand alone do not need to be listed.
- Give each group a concise canonical title (<=80 chars) that names the tactic. If one member's
  existing title already states the tactic well, REUSE it verbatim as the canonical title (this
  keeps the daily brief stable run-to-run).
- Every member_id must be one of the ids provided. Never invent ids.

Respond with ONLY this JSON (no prose, no fences):
{ "groups": [ { "department": "<dept>", "title": "<canonical>", "member_ids": ["fXXXX", ...] } ] }"""


def call_claude(api_key: str, model: str, user: str, max_tokens: int) -> str:
    body = json.dumps({
        "model": model, "max_tokens": max_tokens,
        "system": SYSTEM, "messages": [{"role": "user", "content": user}],
    }).encode()
    req = urllib.request.Request(
        API_URL, data=body,
        headers={"x-api-key": api_key, "anthropic-version": ANTHROPIC_VERSION,
                 "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        payload = json.loads(r.read().decode())
    return "".join(b.get("text", "") for b in payload.get("content", []) if b.get("type") == "text")


def extract_obj(text: str) -> dict:
    text = re.sub(r"^```(?:json)?\s*", "", text.strip())
    text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        s, e = text.find("{"), text.rfind("}")
        if s != -1 and e > s:
            try:
                return json.loads(text[s:e + 1])
            except json.JSONDecodeError:
                return {}
    return {}


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="LLM semantic grouping of findings -> semantic_groups.json")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv[1:])

    api_key = read_env("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: no ANTHROPIC_API_KEY in env or .env.local", file=sys.stderr)
        return 2
    if not FINDINGS.exists():
        print("ERROR: findings.json not found (run kb_build.py first)", file=sys.stderr)
        return 2

    kb = json.loads(FINDINGS.read_text(encoding="utf-8"))
    findings = kb["findings"]
    valid_ids = {f["id"] for f in findings}
    # compact list for the model
    lines = [json.dumps({"id": f["id"], "department": f["department"],
                         "title": f.get("title", ""),
                         "claim": (f.get("variants", [{}])[0].get("claim", "") if f.get("variants") else "")[:240]},
                        ensure_ascii=False)
             for f in findings]
    user = ("Here are the findings, one JSON object per line. Group same-tactic findings within a "
            f"department.\n\n" + "\n".join(lines))

    print(f">> grouping {len(findings)} findings with {args.model}...", file=sys.stderr)
    try:
        out = call_claude(api_key, args.model, user, max_tokens=8192)
    except urllib.error.HTTPError as e:
        print(f"API error: HTTP {e.code} {e.read()[:300]!r}", file=sys.stderr)
        return 2
    obj = extract_obj(out)
    groups = obj.get("groups", [])

    # sanitize: drop unknown ids, require 2+ members, dedup ids within a group
    clean, seen_members = [], set()
    for g in groups:
        mids, seen = [], set()
        for i in g.get("member_ids", []):
            if i in valid_ids and i not in seen:
                seen.add(i)
                mids.append(i)
        if len(mids) >= 2:
            clean.append({"department": g.get("department", ""),
                          "title": g.get("title", ""), "member_ids": mids})
            seen_members.update(mids)

    grouped = sum(len(g["member_ids"]) for g in clean)
    print(f"   {len(clean)} group(s) covering {grouped} findings "
          f"(+{len(findings) - grouped} singletons)", file=sys.stderr)

    if args.dry_run:
        print(json.dumps({"groups": clean}, indent=2))
        return 0

    GROUPS.write_text(json.dumps({"groups": clean}, indent=2), encoding="utf-8")
    print(f"wrote {len(clean)} group(s) -> research/knowledge/semantic_groups.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
