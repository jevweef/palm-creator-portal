# YouTube Transcript Library

A growing corpus of YouTube video transcripts, used as source material for research,
summarization, and fact-checking.

## How to add a video

```bash
scripts/yt-transcript.sh "https://www.youtube.com/watch?v=VIDEO_ID"
```

You can pass multiple URLs at once. Each produces one markdown file here named:

```
<upload_date>__<channel-slug>__<title-slug>.md
```

## Transcript fetch fallback chain

`yt_transcript.py` tries, in order: (1) `youtube-transcript-api` (free), (2) `yt-dlp` json3
auto-captions (free), (3) **Apify** `pintostudio~youtube-transcript-scraper` (~$0.001/video,
reads `APIFY_TOKEN` from `.env.local`). YouTube rate-limits bulk free fetching hard — especially
from cloud/datacenter IPs — so for backfills and the daily scheduled agent, force Apify:

```bash
TRANSCRIPT_FORCE_APIFY=1 python3 scripts/yt_transcript.py "<url>"
TRANSCRIPT_FORCE_APIFY=1 python3 scripts/backfill_transcripts.py --delay 1   # bulk backlog
```

`scripts/backfill_transcripts.py` serially transcribes any video that was enriched
(`research/meta/*.json`) but not yet transcribed; resumable, skips existing.

## How transcripts are produced

1. **YouTube captions (default).** Pulled directly via `yt-dlp` — this is YouTube's own
   speech-to-text (or the creator's uploaded captions). Fast, free, no audio processing.
2. **Whisper fallback.** If a video has captions disabled, the script downloads the audio
   and transcribes it locally with Whisper — *only if `whisper` is installed*
   (`pip3 install -U openai-whisper`). Otherwise the file is created with a placeholder note.

## Importing from Clipto / Limitless (Lynx)

For audio you transcribe in Clipto, **export as Text (.txt)** — it's the only text-based
export that keeps speaker labels (the subtitle formats drop them). Then normalize it into
this library:

```bash
python3 scripts/clipto_import.py path/to/export.txt \
    --title "Interview with X" --channel "Podcast name" --date 20260530
```

This keeps speaker labels, strips timestamps, and writes the same headered markdown format
as the YouTube transcripts. Also accepts `.srt`/`.vtt` (timestamps only, no speakers).

## Timestamps

Every transcript is chunked into ~30-second paragraphs, each prefixed with a timestamp:

- **YouTube** → a clickable `[M:SS](url&t=Ns)` link that jumps straight to that moment in
  the video, so you can scrub back to see what's *on screen* at any line.
- **Clipto** → a plain `[M:SS]` marker (no clickable URL unless you pass `--url`).

## What's captured vs. not

- ✅ Spoken words, full text, with jump-back timestamps.
- ❌ On-screen text, slides, B-roll, visual demos — captions only cover audio. (See
  "Reading what's on screen" below.)

## Reading what's on screen (not built yet)

Transcripts cover audio only. Capturing on-screen content (slides, charts, demos, text)
is possible but a separate pipeline: sample frames from the video with `ffmpeg`, then run
each frame through a vision model to OCR/describe it, keyed to the same timestamps. Not
built yet — ask if you want it.

## Verifying digests (anti-hallucination guard)

The synthesis step is an LLM and **can fabricate source citations** — citing a video_id it
never actually read. Since the whole value here is traceability, every digest MUST be checked:

```bash
python3 scripts/verify_digest.py research/digests/<file>.json        # report
python3 scripts/verify_digest.py research/digests/<file>.json --fix  # strip fabricated cites
```

It cross-checks every `findings[].sources[].video_id` against the transcripts that actually
exist; `--fix` removes any citation with no backing transcript and flags any finding left with
zero real sources as `"unverified": true` (the Research tab marks those). This is a required
step in the pipeline, not optional. (First run caught 4 fabricated citations — real bug.)

## Using these for research

Each file has YAML frontmatter (title, channel, url, date, duration, source) so transcripts
are easy to grep, filter, and cite. Ask Claude to summarize across the library, extract and
verify claims, or feed a batch into the `deep-research` skill.
