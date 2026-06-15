#!/usr/bin/env python3
"""
yt_transcript_ytdlp.py — Fallback transcript fetcher used when the
youtube-transcript-api caption endpoint is IP-blocked.

Downloads subtitles via yt-dlp (different request path, not bot-gated on this
IP), parses the VTT, and writes the SAME timestamped-markdown format as
scripts/yt_transcript.py into research/transcripts/.

Usage:
    python3 scripts/yt_transcript_ytdlp.py <url-or-id> [more...]
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = REPO_ROOT / "research" / "transcripts"
CHUNK_SECONDS = 30


def slugify(s: str, maxlen: int = 60) -> str:
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:maxlen] or "unknown"


def extract_video_id(s: str) -> str | None:
    s = s.strip()
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", s):
        return s
    m = re.search(r"(?:v=|/v/|youtu\.be/|/embed/|/shorts/|/live/)([A-Za-z0-9_-]{11})", s)
    return m.group(1) if m else None


def fmt_ts(seconds: float) -> str:
    s = int(seconds)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m}:{sec:02d}"


def get_metadata(url: str, vid: str) -> dict:
    meta = {"title": "", "channel": "", "upload_date": "00000000",
            "duration": "?", "video_id": vid}
    try:
        out = subprocess.run(
            ["yt-dlp", "--no-warnings", "--skip-download",
             "--print", "%(title)s\t%(uploader)s\t%(upload_date)s\t%(duration_string)s",
             url],
            capture_output=True, text=True, timeout=60,
        )
        if out.returncode == 0 and out.stdout.strip():
            t, c, d, dur = (out.stdout.strip().split("\t") + ["", "", "", ""])[:4]
            if t and t != "NA":
                meta.update(title=t, channel=c,
                            upload_date=d or "00000000", duration=dur or "?")
    except Exception:
        pass
    return meta


def ts_to_secs(ts: str) -> float:
    # 00:00:01.234
    ts = ts.replace(",", ".")
    parts = ts.split(":")
    parts = [float(p) for p in parts]
    while len(parts) < 3:
        parts.insert(0, 0.0)
    h, m, s = parts
    return h * 3600 + m * 60 + s


def parse_vtt(path: Path) -> list[tuple[float, str]]:
    items: list[tuple[float, str]] = []
    cur_start: float | None = None
    cur_lines: list[str] = []
    seen: set[str] = set()
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.rstrip()
        m = re.match(r"(\d{1,2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*", line)
        if m:
            cur_start = ts_to_secs(m.group(1))
            cur_lines = []
            continue
        if "-->" in line:
            continue
        if line.strip() in ("WEBVTT",) or line.startswith(("Kind:", "Language:")):
            continue
        if line.strip() == "":
            if cur_start is not None and cur_lines:
                txt = " ".join(cur_lines)
                txt = re.sub(r"<[^>]+>", "", txt)  # strip <c>, timing tags
                txt = re.sub(r"\s+", " ", txt).strip()
                if txt and txt not in seen:
                    seen.add(txt)
                    items.append((cur_start, txt))
            cur_start = None
            cur_lines = []
            continue
        if cur_start is not None:
            cur_lines.append(line)
    # tail flush
    if cur_start is not None and cur_lines:
        txt = re.sub(r"<[^>]+>", "", " ".join(cur_lines))
        txt = re.sub(r"\s+", " ", txt).strip()
        if txt and txt not in seen:
            items.append((cur_start, txt))
    return items


def to_markdown(items: list[tuple[float, str]], url: str) -> str:
    base = url.split("&")[0]
    paragraphs: list[str] = []
    chunk_start: float | None = None
    buf: list[str] = []

    def flush():
        if buf and chunk_start is not None:
            text = re.sub(r"\s+", " ", " ".join(buf)).strip()
            if text:
                secs = int(chunk_start)
                link = f"[{fmt_ts(chunk_start)}]({base}&t={secs}s)"
                paragraphs.append(f"{link} {text}")
        buf.clear()

    for start, txt in items:
        if chunk_start is None or start - chunk_start >= CHUNK_SECONDS:
            flush()
            chunk_start = start
        buf.append(txt)
    flush()
    return "\n\n".join(paragraphs)


def write_file(meta: dict, url: str, text: str, source: str) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    date_part = meta.get("upload_date") or "00000000"
    fname = f"{date_part}__{slugify(meta['channel'])}__{slugify(meta['title'])}.md"
    out = OUT_DIR / fname
    body = f"""---
title: "{meta['title']}"
channel: "{meta['channel']}"
video_id: "{meta['video_id']}"
url: "{url}"
upload_date: "{date_part}"
duration: "{meta['duration']}"
transcript_source: "{source}"
fetched_with: "scripts/yt_transcript_ytdlp.py"
---

# {meta['title']}

**Channel:** {meta['channel']}
**URL:** {url}
**Uploaded:** {date_part} — **Duration:** {meta['duration']}
**Source:** {source}

---

{text}
"""
    out.write_text(body, encoding="utf-8")
    return out


def process(url_or_id: str) -> None:
    vid = extract_video_id(url_or_id)
    if not vid:
        print(f"!! could not parse id from: {url_or_id}")
        return
    url = f"https://www.youtube.com/watch?v={vid}"
    print(f">> {url}")
    with tempfile.TemporaryDirectory() as td:
        # Prefer human subs, fall back to auto-subs.
        subprocess.run(
            ["yt-dlp", "--no-warnings", "--skip-download",
             "--write-sub", "--write-auto-sub", "--sub-lang", "en.*",
             "--sub-format", "vtt", "-o", f"{td}/%(id)s.%(ext)s", url],
            capture_output=True, text=True, timeout=120,
        )
        vtts = sorted(Path(td).glob(f"{vid}*.vtt"))
        # Prefer a non-auto track if both exist (filename without ".auto" hint
        # isn't reliable, so just take the first English vtt).
        if not vtts:
            print("   FAILED: no subtitle track available")
            return
        items = parse_vtt(vtts[0])
    if not items:
        print("   FAILED: subtitle file parsed to 0 lines")
        return
    text = to_markdown(items, url)
    meta = get_metadata(url, vid)
    if not meta["title"]:
        meta["title"] = vid
    out = write_file(meta, url, text, "yt-dlp VTT subtitles (fallback)")
    print(f"   saved -> research/transcripts/{out.name}  ({len(text.split())} words)")


def main(argv: list[str]) -> int:
    args = argv[1:]
    if not args:
        print(__doc__)
        return 1
    for a in args:
        process(a)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
