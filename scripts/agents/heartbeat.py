#!/usr/bin/env python3
"""
heartbeat.py — the org's watchdog. Runs LAST (08:50) with RunAtLoad=true so it
fires even if the Mac woke late. It makes a DEAD system visible:

  - empty bus today              -> the scheduler is dead, nothing ran, Maya was
                                    silent -> post a RED directly to Telegram.
  - Maya didn't post her brief    -> Evan got no morning brief -> post RED (and
                                    name any dark departments).
  - all healthy                   -> stay quiet, append a health line to runs.log.

When Maya DID post, the watchdog trusts her to have flagged any dark department
(she asserts the expected roster), so it doesn't double-alert.

Posts to the Palm Team Telegram group, Maya's topic, via @palmmanage_bot.
"""
from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from datetime import date

from palm_agent import read_env, BUS

EXPECTED = {"theo", "vivian", "marcus", "nova", "iris", "dana", "gil"}
CHAT_ID = "-1004293138854"
MAYA_THREAD = "3"


def post(text: str) -> None:
    token = read_env("TELEGRAM_HEARTBEAT_BOT_TOKEN")
    if not token:
        print("heartbeat: no TELEGRAM_HEARTBEAT_BOT_TOKEN", file=sys.stderr)
        return
    data = urllib.parse.urlencode({"chat_id": CHAT_ID, "message_thread_id": MAYA_THREAD,
                                   "text": text, "disable_web_page_preview": "true"}).encode()
    try:
        urllib.request.urlopen(urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=data), timeout=30)
    except Exception as e:  # noqa: BLE001
        print(f"heartbeat: telegram post failed: {e}", file=sys.stderr)


def main() -> int:
    d = date.today().isoformat()
    busdir = BUS / d
    files = list(busdir.glob("*.json")) if busdir.exists() else []
    ids = set()
    for f in files:
        try:
            ids.add(json.loads(f.read_text(encoding="utf-8"))["id"])
        except Exception:  # noqa: BLE001
            pass
    missing = sorted(EXPECTED - ids)
    maya_posted = (busdir / "_maya_posted.flag").exists()

    if not files:
        post(f"Palm Team WATCHDOG {d}: the report bus is EMPTY — no teammate ran today. "
             "The scheduler is likely down (Mac asleep at 8am?). You got no brief. Check launchd.")
        return 0
    if not maya_posted:
        tail = f" Dark departments: {', '.join(missing)}." if missing else ""
        post(f"Palm Team WATCHDOG {d}: workers ran but Maya did NOT post your morning brief — "
             f"her synthesis or Telegram step failed.{tail} Check maya-brief run.log.")
        return 0

    # healthy — Maya posted and (she) already flags any dark department; just log.
    try:
        with open(BUS.parent / "runs.log", "a", encoding="utf-8") as fh:
            fh.write(json.dumps({"ts": d, "id": "heartbeat", "status": "ok",
                                 "n_findings": len(files),
                                 "headline": f"healthy: {len(files)} reports, Maya posted, "
                                             f"{'all top-level present' if not missing else 'missing '+','.join(missing)}"}) + "\n")
    except Exception:  # noqa: BLE001
        pass
    print(f"heartbeat OK — {len(files)} reports, Maya posted, missing={missing or 'none'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
