#!/usr/bin/env python3
"""
research_ask.py — Retrieval for "ask the mentor" Q&A over the OFM research corpus.

Given a question, find the most relevant material so an LLM (Claude in-session, or a
scheduled agent) can answer with citations — WITHOUT needing a runtime API key.

It searches two layers and returns ranked, citation-ready context:
  1. findings.json   — the synthesized, consensus-scored findings (the mentor's conclusions)
  2. transcripts/*.md — the raw source, so answers can quote exact lines + [m:ss] timestamps

Ranking = term-overlap of the question against finding text and transcript paragraphs,
with a consensus boost (high-consensus findings rank higher).

Usage:
  python3 scripts/research_ask.py "how should we price PPVs?"
  python3 scripts/research_ask.py --json "what do top agencies do for retention?"
  python3 scripts/research_ask.py --findings 8 --chunks 6 "cold outreach to sign models"
"""
from __future__ import annotations
import glob, json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
KBF = REPO / "research" / "knowledge" / "findings.json"
TRANS = REPO / "research" / "transcripts"

_STOP = set("""a an the and or but of to in on for with your you their our we they it is are be this
that how what why when do does can will should we us how's i'd like about more most than then so if
not no get make have has the's at by from into over per ofm onlyfans only fans""".split())


def toks(s: str) -> list[str]:
    return [t for t in re.sub(r"[^a-z0-9 ]", " ", (s or "").lower()).split()
            if t not in _STOP and len(t) > 2]


def score(qterms: set[str], text: str) -> int:
    tt = toks(text)
    if not tt:
        return 0
    counts = {}
    for t in tt:
        counts[t] = counts.get(t, 0) + 1
    return sum(counts.get(q, 0) for q in qterms)


def rank_findings(qterms, kb, n):
    cons_boost = {"high": 6, "medium": 3, "low": 0}
    scored = []
    for f in kb["findings"]:
        blob = " ".join([f.get("title", ""), f.get("topic", ""), f.get("department", ""),
                         f.get("palm_comparison", {}).get("vs_us", ""),
                         f.get("palm_comparison", {}).get("recommendation", ""),
                         " ".join(v.get("claim", "") + " " + v.get("what_they_do", "")
                                  for v in f.get("variants", []))])
        s = score(qterms, blob)
        if s:
            scored.append((s + cons_boost.get(f["consensus"]["label"], 0), f))
    scored.sort(key=lambda x: -x[0])
    return [f for _, f in scored[:n]]


def rank_chunks(qterms, n):
    """Best-matching transcript paragraphs across all videos, with their [m:ss] + url."""
    hits = []
    for p in TRANS.glob("*.md"):
        if p.name == "README.md":
            continue
        txt = p.read_text(encoding="utf-8")
        m = re.search(r'channel:\s*"([^"]*)"', txt[:500])
        chan = m.group(1) if m else "?"
        tm = re.search(r'title:\s*"([^"]*)"', txt[:500])
        title = tm.group(1) if tm else p.stem
        for para in txt.split("\n\n"):
            mk = re.match(r"\[(\d+:\d{2}(?::\d{2})?)\]\((https://[^)]+)\)\s*(.*)", para.strip(), re.S)
            if not mk:
                continue
            ts, url, body = mk.group(1), mk.group(2), mk.group(3)
            s = score(qterms, body)
            if s >= 2:
                hits.append((s, {"channel": chan, "title": title, "ts": ts, "url": url,
                                 "text": re.sub(r"\s+", " ", body).strip()[:400]}))
    hits.sort(key=lambda x: -x[0])
    return [h for _, h in hits[:n]]


def main(argv):
    args = [a for a in argv[1:]]
    as_json = "--json" in args
    if as_json:
        args.remove("--json")
    nf, nc = 6, 5
    if "--findings" in args:
        i = args.index("--findings"); nf = int(args[i+1]); del args[i:i+2]
    if "--chunks" in args:
        i = args.index("--chunks"); nc = int(args[i+1]); del args[i:i+2]
    question = " ".join(args).strip()
    if not question:
        print("usage: research_ask.py [--json] [--findings N] [--chunks N] \"<question>\"")
        return 1

    kb = json.loads(KBF.read_text())
    qterms = set(toks(question))
    findings = rank_findings(qterms, kb, nf)
    chunks = rank_chunks(qterms, nc)

    if as_json:
        print(json.dumps({"question": question,
                          "findings": [{"title": f["title"], "department": f["department"],
                                        "consensus": f["consensus"], "creators": f["creators"],
                                        "vs_us": f["palm_comparison"]["vs_us"],
                                        "recommendation": f["palm_comparison"]["recommendation"],
                                        "sources": f["sources"][:3]} for f in findings],
                          "transcript_excerpts": chunks}, indent=2))
        return 0

    print(f"\nQ: {question}\n" + "=" * 70)
    print(f"\n# RELEVANT FINDINGS ({len(findings)})\n")
    for f in findings:
        c = f["consensus"]
        print(f"[{c['label']} consensus · {c['creators']} creator(s)] {f['department']}: {f['title']}")
        if f["palm_comparison"]["vs_us"]:
            print(f"   vs us: {f['palm_comparison']['vs_us']}")
        if f["palm_comparison"]["recommendation"]:
            print(f"   change: {f['palm_comparison']['recommendation']}")
        if f.get("creators"):
            print(f"   said by: {', '.join(f['creators'])}")
        print()
    print(f"\n# SUPPORTING TRANSCRIPT EXCERPTS ({len(chunks)})\n")
    for h in chunks:
        print(f"[{h['ts']}] {h['channel']} — {h['title'][:50]}")
        print(f"   \"{h['text']}\"")
        print(f"   {h['url']}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
