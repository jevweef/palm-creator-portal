#!/usr/bin/env python3
"""
synthesize_run.py — Turn freshly-fetched transcripts into a per-run synthesis digest,
WITHOUT a human in the loop. This is the piece that lets the daily pipeline run unattended.

Until P7, synthesis was done interactively (Claude Code reading transcripts in-session). For
a *scheduled* daily run there is no session, so this script calls the Anthropic API directly
(same model/endpoint as app/api/admin/research/ask/route.js) and emits a digest in the EXACT
schema kb_build.py expects:

    research/digests/runs/<name>.json
    { "run": "<name>", "findings": [ {
        department, topic, title, claim, what_they_do, vs_us, recommendation,
        applicability, sources:[{video_id, timestamp_seconds, quote}] } ] }

Grounding (read fresh each run so "vs us" stays accurate as Palm evolves):
  - docs/palm-operating-system.md  — the Palm baseline (the "us" in "them vs us")
  - research/knowledge/taxonomy.json — the department keys findings must be tagged with

Anti-hallucination: we synthesize ONE transcript per API call, so the model only ever sees a
single real video_id and cannot invent cross-citations. Every cited video_id is still checked
afterward by verify_digest.py (the hard guard). timestamps are taken from the transcript's own
`&t=Ns` markers, which we surface to the model as `(<seconds>s)` line prefixes.

Usage:
    python3 scripts/synthesize_run.py --out research/digests/runs/daily-2026-06-01.json \
        research/transcripts/20260531__dylanofm__how-i-scaled.md [more.md ...]
    python3 scripts/synthesize_run.py --out <file> --ids dt4Lq6fuua8 lyyyMMoYDxs   # by video_id
    python3 scripts/synthesize_run.py --out <file> --model claude-sonnet-4-6 <files...>

Exit 0 on success (>=1 finding written), 1 if no findings produced, 2 on bad args / no API key.
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
TRANSCRIPTS = REPO / "research" / "transcripts"
BASELINE = REPO / "docs" / "palm-operating-system.md"
TAXONOMY = REPO / "research" / "knowledge" / "taxonomy.json"

API_URL = "https://api.anthropic.com/v1/messages"
DEFAULT_MODEL = "claude-sonnet-4-6"
ANTHROPIC_VERSION = "2023-06-01"


def read_env(key: str) -> str | None:
    """Read a key from process env or .env.local (CLI scripts don't get Vercel env)."""
    import os
    if os.getenv(key):
        return os.getenv(key)
    envf = REPO / ".env.local"
    if not envf.exists():
        return None
    for line in envf.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        if k.strip() == key:
            return v.strip().strip('"').strip("'")
    return None


def parse_transcript(path: Path) -> dict | None:
    """Parse a research/transcripts/*.md file → {video_id, title, channel, upload_date, body}.

    The body is rewritten so each paragraph is prefixed with its integer second offset
    `(<n>s)` (taken from the `&t=Ns` marker in the timestamp link) — exact, citable
    timestamps the model can copy straight into sources[].timestamp_seconds.
    """
    try:
        raw = path.read_text(encoding="utf-8")
    except Exception:
        return None

    def fm(field: str) -> str:
        m = re.search(rf'{field}:\s*"([^"]*)"', raw[:800])
        return m.group(1) if m else ""

    vid = fm("video_id")
    if not vid:
        return None

    # Body = everything after the second '---' divider.
    parts = raw.split("\n---\n", 2)
    body = parts[-1] if parts else raw

    lines_out: list[str] = []
    for para in body.split("\n\n"):
        para = para.strip()
        if not para:
            continue
        m = re.search(r"&t=(\d+)s\)", para)
        secs = int(m.group(1)) if m else 0
        # strip the markdown timestamp link, keep the spoken text
        text = re.sub(r"^\[[^\]]*\]\([^)]*\)\s*", "", para).strip()
        if text:
            lines_out.append(f"({secs}s) {text}")

    return {
        "video_id": vid,
        "title": fm("title"),
        "channel": fm("channel"),
        "upload_date": fm("upload_date"),
        "body": "\n".join(lines_out),
    }


def resolve_inputs(files: list[str], ids: list[str]) -> list[Path]:
    """Resolve --ids to transcript paths (by frontmatter video_id) and validate --files."""
    paths: list[Path] = []
    for f in files:
        p = Path(f)
        if not p.is_absolute():
            p = (REPO / f) if (REPO / f).exists() else p
        if p.exists():
            paths.append(p)
        else:
            print(f"  ! transcript not found: {f}", file=sys.stderr)
    if ids:
        idset = set(ids)
        for p in TRANSCRIPTS.glob("*.md"):
            m = re.search(r'video_id:\s*"([A-Za-z0-9_-]{11})"', p.read_text(encoding="utf-8")[:600])
            if m and m.group(1) in idset:
                paths.append(p)
    # dedup, preserve order
    seen, out = set(), []
    for p in paths:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def build_system_prompt() -> str:
    baseline = BASELINE.read_text(encoding="utf-8") if BASELINE.exists() else "(baseline doc missing)"
    depts = []
    if TAXONOMY.exists():
        tax = json.loads(TAXONOMY.read_text(encoding="utf-8"))
        for d in tax.get("departments", []):
            depts.append(f"  - {d['key']}: {d.get('label','')} — {d.get('blurb','')}")
    dept_block = "\n".join(depts) or "  (taxonomy missing)"

    return f"""You are Palm Management's OFM Research Specialist. Palm is an OnlyFans-creator
MANAGEMENT agency that runs REAL creators on OnlyFans (AI/Fanvue creators are a FUTURE line,
not the current business). You study how OTHER OFM agencies operate (from their YouTube
teaching content) and report findings THROUGH THE LENS OF HOW PALM OPERATES: "here's what they
do, here's how it differs from us, here's what we'd change."

== PALM'S OPERATING SYSTEM (the "us" — your baseline for every "vs_us") ==
{baseline}

== TASK ==
You will be given ONE competitor video transcript. Extract the concrete, IMPLEMENTABLE tactics
it teaches about running an OFM agency. Output a JSON array of FINDINGS. Each finding object:

{{
  "department": "<one key from the list below>",
  "topic": "<short free-form sub-topic, e.g. 'PPV pricing' or 'chatter onboarding'>",
  "title": "<concise tactic name, <=80 chars>",
  "claim": "<the core assertion the creator makes, one sentence>",
  "what_they_do": "<specifically what this agency does — concrete mechanics, numbers, steps>",
  "vs_us": "<how this differs from how Palm operates today; cite the relevant § if you can. If Palm already does this, say so.>",
  "recommendation": "<what Palm should consider changing/adopting, concrete and actionable>",
  "applicability": "real-creator" | "ai-only" | "both",
  "sources": [ {{ "video_id": "<the EXACT video_id given to you, nothing else>",
                 "timestamp_seconds": <integer copied from a (Ns) marker in the transcript>,
                 "quote": "<short verbatim phrase from the transcript at that spot>" }} ]
}}

DEPARTMENT KEYS (use exactly one of these for "department"):
{dept_block}

HARD RULES:
- Cite ONLY the video_id you are given. Never invent another. Every source needs a real
  (Ns) timestamp that appears in the transcript and a verbatim quote from near it.
- 3-8 findings per video. Only genuinely useful, specific tactics — skip vague motivation,
  flexing, and pure lifestyle content (return [] if the video teaches nothing actionable).
- "applicability": tag "ai-only" if the tactic only makes sense for AI/Fanvue creators,
  "real-creator" for tactics about real OF creators, "both" if it applies either way.
- Distinguish top-of-funnel SOCIAL content from OF VAULT/PPV content; don't conflate them.
- Chatting/monetization is currently OUTSOURCED at Palm (external team); frame competitor
  chat intel as "build-toward", not "we don't do this".
- Respond with ONLY the JSON array. No prose, no markdown fences."""


def call_claude(api_key: str, model: str, system: str, user: str) -> str:
    body = json.dumps({
        "model": model,
        "max_tokens": 8192,  # long videos yield 5-8 detailed findings; 4096 truncated them
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }).encode()
    req = urllib.request.Request(
        API_URL, data=body,
        headers={
            "x-api-key": api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        payload = json.loads(r.read().decode())
    blocks = payload.get("content") or []
    return "".join(b.get("text", "") for b in blocks if b.get("type") == "text")


def _salvage_objects(text: str) -> list:
    """Recover complete top-level {...} objects from a possibly-truncated JSON array.

    Long-video responses can hit max_tokens mid-array; rather than lose every finding, we
    scan for balanced brace spans (string-aware) and keep each one that parses.
    """
    out, depth, start, in_str, esc = [], 0, None, False, False
    for i, ch in enumerate(text):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start is not None:
                try:
                    out.append(json.loads(text[start:i + 1]))
                except json.JSONDecodeError:
                    pass
                start = None
    return out


def extract_json_array(text: str) -> list:
    """Pull a JSON array out of the model response, tolerating ```fences```, prose, truncation."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    try:
        v = json.loads(text)
        return v if isinstance(v, list) else v.get("findings", [])
    except json.JSONDecodeError:
        pass
    # whole-array span
    s, e = text.find("["), text.rfind("]")
    if s != -1 and e > s:
        try:
            return json.loads(text[s:e + 1])
        except json.JSONDecodeError:
            pass
    # truncated / messy: salvage whatever complete objects we can
    return _salvage_objects(text)


def synthesize_one(api_key: str, model: str, system: str, t: dict) -> list:
    user = (f"VIDEO_ID: {t['video_id']}\n"
            f"CHANNEL: {t['channel']}\nTITLE: {t['title']}\nUPLOADED: {t['upload_date']}\n\n"
            f"TRANSCRIPT (each paragraph prefixed with its second offset):\n\n{t['body']}")
    try:
        out = call_claude(api_key, model, system, user)
    except urllib.error.HTTPError as e:
        print(f"  ! API error for {t['video_id']}: HTTP {e.code} {e.read()[:200]!r}", file=sys.stderr)
        return []
    except Exception as e:
        print(f"  ! API call failed for {t['video_id']}: {type(e).__name__}: {e}", file=sys.stderr)
        return []
    findings = extract_json_array(out)
    # enforce the video_id (model is told, but belt-and-suspenders) + drop empty
    clean = []
    for f in findings:
        if not isinstance(f, dict) or not f.get("title"):
            continue
        for s in f.get("sources", []):
            s["video_id"] = t["video_id"]  # never trust the model's id field
        clean.append(f)
    return clean


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Synthesize transcripts into a run digest via Claude.")
    ap.add_argument("files", nargs="*", help="transcript .md paths")
    ap.add_argument("--ids", nargs="*", default=[], help="select transcripts by video_id instead")
    ap.add_argument("--out", required=True, help="output run digest path")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--run-name", default=None, help="override the 'run' label (default: out stem)")
    args = ap.parse_args(argv[1:])

    api_key = read_env("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: no ANTHROPIC_API_KEY in env or .env.local", file=sys.stderr)
        return 2

    paths = resolve_inputs(args.files, args.ids)
    if not paths:
        print("ERROR: no transcripts to synthesize", file=sys.stderr)
        return 2

    system = build_system_prompt()
    all_findings: list = []
    print(f">> synthesizing {len(paths)} transcript(s) with {args.model}...", file=sys.stderr)
    for p in paths:
        t = parse_transcript(p)
        if not t or not t["body"]:
            print(f"  skip (unparseable/empty): {p.name}", file=sys.stderr)
            continue
        fs = synthesize_one(api_key, args.model, system, t)
        print(f"  {t['video_id']}  {t['channel'][:22]:22}  -> {len(fs)} finding(s)", file=sys.stderr)
        all_findings.extend(fs)

    out = Path(args.out)
    if not out.is_absolute():
        out = REPO / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    run_name = args.run_name or out.stem
    out.write_text(json.dumps({"run": run_name, "findings": all_findings}, indent=2), encoding="utf-8")
    print(f"wrote {len(all_findings)} finding(s) -> {out.relative_to(REPO) if out.is_relative_to(REPO) else out}")
    return 0 if all_findings else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
