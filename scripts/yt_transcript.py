#!/usr/bin/env python3
"""
yt_transcript.py — Fetch YouTube transcripts + metadata and save them as clean
markdown files under research/transcripts/, building a research library.

Primary path : youtube-transcript-api  (hits YouTube's caption endpoint directly,
               no login / no cookies / no bot-gate on a residential IP).
Metadata     : yt-dlp if available (title/channel/date/duration); otherwise we
               fall back to oEmbed (title + channel only, no auth needed).

Usage:
    python3 scripts/yt_transcript.py <url-or-id> [more...]
    python3 scripts/yt_transcript.py --list      # list current library

Output:
    research/transcripts/<upload_date>__<channel-slug>__<title-slug>.md
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = REPO_ROOT / "research" / "transcripts"


def slugify(s: str, maxlen: int = 60) -> str:
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:maxlen] or "unknown"


def extract_video_id(url_or_id: str) -> str | None:
    s = url_or_id.strip()
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", s):
        return s
    patterns = [
        r"(?:v=|/v/|youtu\.be/|/embed/|/shorts/|/live/)([A-Za-z0-9_-]{11})",
    ]
    for p in patterns:
        m = re.search(p, s)
        if m:
            return m.group(1)
    return None


def get_metadata(url: str, vid: str) -> dict:
    """Try yt-dlp first; fall back to oEmbed (no auth) for title/channel."""
    meta = {
        "title": "",
        "channel": "",
        "upload_date": "00000000",
        "duration": "?",
        "video_id": vid,
    }
    # yt-dlp (may be bot-gated; that's fine, we just skip it)
    try:
        out = subprocess.run(
            ["yt-dlp", "--no-warnings", "--skip-download",
             "--print", "%(title)s\t%(uploader)s\t%(upload_date)s\t%(duration_string)s",
             url],
            capture_output=True, text=True, timeout=45,
        )
        if out.returncode == 0 and out.stdout.strip():
            t, c, d, dur = (out.stdout.strip().split("\t") + ["", "", "", ""])[:4]
            if t and t != "NA":
                meta.update(title=t, channel=c, upload_date=d or "00000000",
                            duration=dur or "?")
                return meta
    except Exception:
        pass
    # oEmbed fallback (title + author only, no date/duration)
    try:
        oe = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={vid}&format=json"
        with urllib.request.urlopen(oe, timeout=20) as r:
            j = json.loads(r.read().decode())
        meta["title"] = j.get("title", "") or meta["title"]
        meta["channel"] = j.get("author_name", "") or meta["channel"]
    except Exception:
        pass
    return meta


# How often to drop a new timestamp marker (seconds). Each marker is a clickable
# link that jumps straight to that moment in the video — your index back into the
# footage to see what's on screen.
CHUNK_SECONDS = 30


def fmt_ts(seconds: float) -> str:
    """Seconds -> M:SS or H:MM:SS."""
    s = int(seconds)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m}:{sec:02d}"


def _items_via_api(vid: str) -> list[tuple[float, str]]:
    """Primary path: youtube-transcript-api (can be IP-blocked on some hosts)."""
    from youtube_transcript_api import YouTubeTranscriptApi

    # Support both the newer instance API and the older static API.
    try:
        api = YouTubeTranscriptApi()
        data = api.fetch(vid)
        snippets = data.snippets if hasattr(data, "snippets") else data
        return [(float(s.start), s.text) for s in snippets]
    except AttributeError:
        data = YouTubeTranscriptApi.get_transcript(vid)
        return [(float(d["start"]), d["text"]) for d in data]


def _items_via_ytdlp(vid: str) -> list[tuple[float, str]]:
    """Fallback: download auto-captions (json3) with yt-dlp and parse them.

    yt-dlp reaches YouTube through a different code path than
    youtube-transcript-api, so it can still succeed when the direct caption
    endpoint returns IpBlocked (though both share YouTube's rate limits).
    """
    import glob
    import tempfile

    url = f"https://www.youtube.com/watch?v={vid}"
    with tempfile.TemporaryDirectory() as td:
        tmpl = os.path.join(td, "cap.%(ext)s")
        subprocess.run(
            ["yt-dlp", "--no-warnings", "--skip-download",
             "--write-auto-subs", "--write-subs",
             "--sub-langs", "en.*,en", "--sub-format", "json3",
             "-o", tmpl, url],
            capture_output=True, text=True, timeout=180,
        )
        files = sorted(glob.glob(os.path.join(td, "*.json3")))
        if not files:
            raise RuntimeError("yt-dlp produced no caption file (rate-limited?)")
        with open(files[0], encoding="utf-8") as f:
            data = json.load(f)
        items: list[tuple[float, str]] = []
        for ev in data.get("events", []):
            segs = ev.get("segs")
            if not segs:
                continue
            text = "".join(s.get("utf8", "") for s in segs)
            if not text.strip():
                continue
            items.append((float(ev.get("tStartMs", 0)) / 1000.0, text))
        if not items:
            raise RuntimeError("yt-dlp caption file had no usable events")
        return items


def _read_env(key: str) -> str | None:
    """Read a key from .env.local (CLI scripts don't get Vercel/process env)."""
    if os.getenv(key):
        return os.getenv(key)
    envf = REPO_ROOT / ".env.local"
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


def _items_via_apify(vid: str) -> list[tuple[float, str]]:
    """Paid, reliable fallback: Apify YouTube transcript actor (~$0.001/video).

    Used when YouTube rate-limits the free paths (esp. on cloud/datacenter IPs).
    Returns YouTube's own captions — same source/quality as the direct method,
    just fetched from Apify's IPs. Reads APIFY_TOKEN from .env.local.

    Actor: supreme_coder/youtube-transcript-scraper
      input : {"urls":[{"url": "..."}]}
      output: [{transcript:[{text,start,duration}], isGenerated, videoDetails, ...}]
    """
    import urllib.request

    tok = (_read_env("APIFY_TOKEN") or _read_env("APIFY_API_TOKEN")
           or _read_env("APIFY_TOKEN_2"))
    if not tok:
        raise RuntimeError("no APIFY_TOKEN in .env.local for Apify fallback")
    actor = "supreme_coder~youtube-transcript-scraper"
    api = f"https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items?token={tok}"
    body = json.dumps({"urls": [{"url": f"https://www.youtube.com/watch?v={vid}"}]}).encode()
    req = urllib.request.Request(api, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        payload = json.loads(r.read().decode())
    # payload is a list of dataset items; transcript lives under item["transcript"]
    # (older actors used "data") — accept either.
    rows = []
    for item in (payload or []):
        rows = item.get("transcript") or item.get("data") or []
        if rows:
            break
    import html
    items: list[tuple[float, str]] = []
    for seg in rows:
        txt = html.unescape(seg.get("text") or "").strip()  # &#39; -> ', &amp; -> &
        if not txt:
            continue
        try:
            start = float(seg.get("start", 0))
        except (TypeError, ValueError):
            start = 0.0
        items.append((start, txt))
    if not items:
        raise RuntimeError("Apify returned no transcript segments")
    return items


def fetch_transcript(vid: str, url: str) -> tuple[str, str]:
    """Return (timestamped_markdown, source_label). Raises on hard failure.

    Output groups caption snippets into ~CHUNK_SECONDS paragraphs, each prefixed
    with a clickable [M:SS](url&t=Ns) link to that exact spot in the video.

    Tries free paths first (youtube-transcript-api → yt-dlp), then falls back to
    the paid Apify actor when YouTube rate-limits us. Set TRANSCRIPT_FORCE_APIFY=1
    to skip straight to Apify (useful for bulk backfill during a rate-limit block).
    """
    if os.getenv("TRANSCRIPT_FORCE_APIFY") == "1":
        items = _items_via_apify(vid)
        source = "Apify (pintostudio youtube-transcript-scraper)"
    else:
        try:
            items = _items_via_api(vid)
            source = "YouTube captions (youtube-transcript-api)"
        except Exception:
            try:
                items = _items_via_ytdlp(vid)
                source = "YouTube auto-captions (yt-dlp json3)"
            except Exception:
                items = _items_via_apify(vid)
                source = "Apify (pintostudio youtube-transcript-scraper)"

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
        txt = txt.replace("\n", " ").strip()
        if not txt:
            continue
        if chunk_start is None or start - chunk_start >= CHUNK_SECONDS:
            flush()
            chunk_start = start
        buf.append(txt)
    flush()

    return "\n\n".join(paragraphs), source


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
fetched_with: "scripts/yt_transcript.py"
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
        print(f"!! could not parse a video id from: {url_or_id}")
        return
    url = f"https://www.youtube.com/watch?v={vid}"
    print(f">> {url}")
    try:
        text, source = fetch_transcript(vid, url)
    except Exception as e:
        print(f"   FAILED to fetch transcript: {type(e).__name__}: {str(e)[:160]}")
        return
    meta = get_metadata(url, vid)
    if not meta["title"]:
        meta["title"] = vid
    out = write_file(meta, url, text, source)
    print(f"   saved -> research/transcripts/{out.name}  ({len(text.split())} words)")


def list_library() -> None:
    if not OUT_DIR.exists():
        print("(no library yet)")
        return
    files = sorted(p for p in OUT_DIR.glob("*.md") if p.name != "README.md")
    if not files:
        print("(library is empty)")
        return
    print(f"{len(files)} transcript(s) in research/transcripts/:\n")
    for p in files:
        words = len(p.read_text(encoding="utf-8").split())
        print(f"  {p.name}  ({words} words)")


def main(argv: list[str]) -> int:
    args = argv[1:]
    if not args:
        print(__doc__)
        return 1
    if args[0] == "--list":
        list_library()
        return 0
    for a in args:
        process(a)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
