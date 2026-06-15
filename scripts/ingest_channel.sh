#!/usr/bin/env bash
#
# ingest_channel.sh — Add a YouTube channel's recent videos to the research library,
# end to end: discover → date-filter → enrich → transcribe (Apify) → dedupe.
# This is THE repeatable process for adding channels. Re-runnable; skips anything
# already transcribed or denylisted.
#
# Usage:
#   scripts/ingest_channel.sh <name> <channel_url> [since_YYYYMMDD] [limit]
#
# Examples:
#   scripts/ingest_channel.sh bjorn "https://www.youtube.com/@bjornolsenofficial/videos"
#   scripts/ingest_channel.sh someguy "https://www.youtube.com/@SomeGuy/videos" 20250530 80
#
# Defaults: since = 20250530 (last ~12 months), limit = 100 newest videos.
# Requires APIFY_TOKEN in .env.local (transcription) + yt-dlp (discovery/metadata).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="${1:?usage: ingest_channel.sh <name> <channel_url> [since] [limit]}"
URL="${2:?need channel /videos URL}"
SINCE="${3:-20250530}"
LIMIT="${4:-100}"
TMP="${CLAUDE_JOB_DIR:-/tmp}/ingest_$NAME"
mkdir -p "$TMP"

echo ">> [1/4] discovering $URL (newest $LIMIT)"
yt-dlp --no-warnings --flat-playlist --print "%(id)s|%(title)s" --playlist-end "$LIMIT" "$URL" \
  | sed 's/|/\t/' > "$TMP/list.tsv"
echo "   found $(grep -c . "$TMP/list.tsv") videos"

echo ">> [2/4] enriching + date-filtering (>= $SINCE) -> research/meta/$NAME.json"
python3 "$REPO/scripts/stage_channel.py" "$NAME" "$TMP/list.tsv" --since "$SINCE" --limit "$LIMIT" \
  | tail -1

echo ">> [3/4] transcribing new videos via Apify"
TRANSCRIPT_FORCE_APIFY=1 python3 "$REPO/scripts/backfill_transcripts.py" --delay 1 | tail -1

echo ">> [4/4] de-duplicating"
python3 "$REPO/scripts/dedupe_transcripts.py" --apply >/dev/null 2>&1 || true

echo ">> done. library status:"
python3 "$REPO/scripts/research_status.py" 2>/dev/null | sed -n '1,3p'
