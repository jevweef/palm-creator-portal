#!/usr/bin/env python3
"""
clipto_import.py — Normalize a Clipto / Limitless transcript export into the same
markdown format used by the YouTube pipeline, and save it under research/transcripts/.

Policy (per project decision): KEEP speaker labels AND timestamps. Timestamps let
you jump back into the source video to see what's on screen at that moment.

Accepts:
    .txt   plain text export  (preferred — usually carries speaker labels)
    .srt   subtitle file      (timestamps only, no speakers — we still clean it)
    .vtt   web subtitle file

Usage:
    python3 scripts/clipto_import.py <export-file> \
        [--title "..."] [--source "..."] [--date YYYYMMDD] [--url "..."]

If --title is omitted, the export's filename (sans extension) is used.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = REPO_ROOT / "research" / "transcripts"

# --- timestamp shapes -----------------------------------------------------------
# 00:01:23 / 00:01:23,456 / 00:01:23.456 / 1:23 — bare, bracketed, or parenthesized.
TS_CORE = r"\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?"
CUE_LINE = re.compile(rf"^\s*\[?\(?({TS_CORE})\)?\]?\s*-->\s*\[?\(?{TS_CORE}\)?\]?\s*$")
LEADING_TS = re.compile(rf"^\s*[\[\(]?({TS_CORE})[\]\)]?\s*")  # ts at start of a line
SRT_INDEX = re.compile(r"^\s*\d+\s*$")           # standalone cue number
SPEAKER = re.compile(r"^\s*([A-Z][\w .'-]{0,40}|Speaker\s*\d+|\[[^\]]+\])\s*:\s*(.*)$")


def slugify(s: str, maxlen: int = 60) -> str:
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:maxlen] or "unknown"


def norm_ts(ts: str) -> str:
    """Normalize a raw timestamp to [M:SS] or [H:MM:SS], dropping milliseconds."""
    ts = ts.replace(",", ":").replace(".", ":")
    parts = [int(p) for p in ts.split(":")[:3]]
    if len(parts) == 3:
        h, m, s = parts
    elif len(parts) == 2:
        h, m, s = 0, parts[0], parts[1]
    else:
        h, m, s = 0, 0, parts[0]
    return f"[{h}:{m:02d}:{s:02d}]" if h else f"[{m}:{s:02d}]"


def normalize(raw: str) -> str:
    """Keep speaker labels AND timestamps; drop cue index numbers + headers.

    Each turn/cue becomes a line prefixed with a normalized [M:SS] marker (so you
    can scrub back to that moment), followed by an optional **Speaker:** label and
    the spoken text. Consecutive untimed fragments fold into the prior line.
    """
    out_lines: list[str] = []
    pending_ts: str | None = None  # timestamp captured from a lone SRT/VTT cue line

    for rawline in raw.splitlines():
        line = rawline.rstrip()
        if not line.strip():
            continue
        if line.strip().upper() == "WEBVTT" or line.startswith(("Kind:", "Language:")):
            continue
        if SRT_INDEX.match(line):
            continue

        cue = CUE_LINE.match(line)
        if cue:
            # SRT/VTT timestamp line — hold the start time for the text that follows.
            pending_ts = norm_ts(cue.group(1))
            continue

        # Inline leading timestamp on a text line (Clipto .txt style).
        ts = pending_ts
        pending_ts = None
        lead = LEADING_TS.match(line)
        if lead:
            ts = norm_ts(lead.group(1))
            line = line[lead.end():]

        line = line.strip()
        if not line:
            continue

        line = re.sub(r"\s+", " ", line)
        m = SPEAKER.match(line)
        if m:
            speaker = m.group(1).strip().strip("[]")
            rest = m.group(2).strip()
            prefix = f"{ts} " if ts else ""
            out_lines.append(f"{prefix}**{speaker}:** {rest}".rstrip())
        elif ts:
            out_lines.append(f"{ts} {line}".rstrip())
        elif out_lines:
            # Untimed continuation — fold into the previous line.
            out_lines[-1] = (out_lines[-1] + " " + line).rstrip()
        else:
            out_lines.append(line)

    text = "\n\n".join(out_lines)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


def write_file(title: str, channel: str, url: str, date: str,
               source: str, text: str) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    date = date or "00000000"
    fname = f"{date}__{slugify(channel)}__{slugify(title)}.md"
    out = OUT_DIR / fname
    body = f"""---
title: "{title}"
channel: "{channel}"
url: "{url}"
upload_date: "{date}"
duration: "?"
transcript_source: "{source}"
fetched_with: "scripts/clipto_import.py"
---

# {title}

**Source / speaker(s):** {channel}
**URL:** {url}
**Date:** {date}
**Transcribed by:** {source}

---

{text}
"""
    out.write_text(body, encoding="utf-8")
    return out


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Import a Clipto/Limitless transcript export.")
    ap.add_argument("file", help="Path to the Clipto export (.txt/.srt/.vtt)")
    ap.add_argument("--title", default="", help="Transcript title (default: filename)")
    ap.add_argument("--source", default="Clipto (AI transcription)",
                    help="transcript_source label")
    ap.add_argument("--channel", default="Clipto import",
                    help="Channel / speaker grouping for the filename + header")
    ap.add_argument("--date", default="", help="YYYYMMDD; default 00000000")
    ap.add_argument("--url", default="", help="Original video/audio URL, if any")
    args = ap.parse_args(argv[1:])

    src = Path(args.file)
    if not src.exists():
        print(f"!! file not found: {src}")
        return 1

    raw = src.read_text(encoding="utf-8", errors="replace")
    text = normalize(raw)
    if not text:
        print("!! normalization produced empty text — is this a recognized format?")
        return 1

    title = args.title or src.stem
    out = write_file(title, args.channel, args.url, args.date, args.source, text)
    print(f"saved -> research/transcripts/{out.name}  ({len(text.split())} words)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
