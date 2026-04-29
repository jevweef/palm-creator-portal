#!/usr/bin/env python3
"""
Palm Inbox — iMessage daemon.

Polls ~/Library/Messages/chat.db every POLL_INTERVAL seconds, reads new
messages since the last-seen ROWID, and POSTs them to the portal's
/api/inbox/imessage endpoint.

Stdlib only — no pip install required.

Setup:
1.  Grant Full Disk Access to /usr/bin/python3 (or whatever interpreter you use).
    System Settings → Privacy & Security → Full Disk Access → "+" → Cmd+Shift+G
    → /usr/bin/python3 (toggle on). Restart Terminal afterward.
2.  Create a config file at ~/.palm-inbox.json (see DEFAULT_CONFIG below).
3.  Test once: `python3 imessage_daemon.py --once`
4.  Install as launchd service (see palm.inbox.imessage.plist).

Local state lives in ~/.palm-inbox.state.json — tracks last-seen ROWID across
restarts so we never re-process the same message.

Author: Palm Management
"""

import json
import os
import sqlite3
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

HOME = Path.home()
DB_PATH = HOME / "Library" / "Messages" / "chat.db"
CONFIG_PATH = HOME / ".palm-inbox.json"
STATE_PATH = HOME / ".palm-inbox.state.json"
LOG_PATH = HOME / ".palm-inbox.log"

DEFAULT_CONFIG = {
    "endpoint": "https://app.palm-mgmt.com/api/inbox/imessage",
    "secret": "PASTE_IMESSAGE_INGEST_SECRET_HERE",
    "poll_interval_seconds": 30,
    "batch_size": 50,
    # Skip messages older than this (relative to first run). Prevents
    # ingesting your entire iMessage history. Set to None to ingest all.
    "ignore_messages_before": "now",  # "now" | ISO timestamp | None
    # Drop chats where you don't want any messages going through.
    # Match against chat_identifier (phone/email) or chat title (group name).
    "block_chats": [],  # e.g. ["+1800SPAMMER", "Spam Group"]
}


# ─── logging ─────────────────────────────────────────────────────────

def log(msg, level="INFO"):
    line = f"[{datetime.now().isoformat(timespec='seconds')}] [{level}] {msg}"
    print(line, flush=True)
    try:
        with open(LOG_PATH, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass


# ─── config + state ──────────────────────────────────────────────────

def load_config():
    if not CONFIG_PATH.exists():
        log(f"No config at {CONFIG_PATH} — writing default. EDIT IT before running again.", "WARN")
        with open(CONFIG_PATH, "w") as f:
            json.dump(DEFAULT_CONFIG, f, indent=2)
        sys.exit(1)
    with open(CONFIG_PATH) as f:
        cfg = json.load(f)
    if cfg.get("secret", "").startswith("PASTE_"):
        log("Edit ~/.palm-inbox.json and set 'secret' to the IMESSAGE_INGEST_SECRET value from Vercel.", "ERROR")
        sys.exit(1)
    return cfg


def load_state():
    if not STATE_PATH.exists():
        return {"last_rowid": 0, "first_seen_rowid": None}
    with open(STATE_PATH) as f:
        return json.load(f)


def save_state(state):
    tmp = STATE_PATH.with_suffix(".tmp")
    with open(tmp, "w") as f:
        json.dump(state, f, indent=2)
    tmp.replace(STATE_PATH)


# ─── chat.db helpers ─────────────────────────────────────────────────

# Apple stores message timestamps as nanoseconds since 2001-01-01 UTC.
# This converts to a standard ISO 8601 UTC string.
APPLE_EPOCH = datetime(2001, 1, 1, tzinfo=timezone.utc)

def apple_ts_to_iso(apple_ns):
    if not apple_ns:
        return None
    # Older messages: seconds. Newer: nanoseconds. Heuristic:
    # if value > 1e10 it's nanoseconds.
    seconds = apple_ns / 1e9 if apple_ns > 1e10 else apple_ns
    dt = datetime.fromtimestamp(APPLE_EPOCH.timestamp() + seconds, tz=timezone.utc)
    return dt.isoformat()


def query_messages(db_path, after_rowid, limit):
    """
    Read new messages from chat.db.

    Joins:
      message → handle    (sender info for received messages)
      message → chat_message_join → chat   (which chat each message is in)

    is_from_me=1 → outgoing (Evan); handle_id will be null in that case.
    Group chats: chat.style=43 (43=group, 45=1on1 in older versions); we use
    chat_identifier and chat.display_name.
    """
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("""
        SELECT
            m.ROWID                      AS rowid,
            m.guid                       AS guid,
            m.text                       AS text,
            m.attributedBody             AS attributed_body,
            m.is_from_me                 AS is_from_me,
            m.date                       AS date,
            m.cache_has_attachments      AS has_attachments,
            h.id                         AS sender_handle,
            c.chat_identifier            AS chat_identifier,
            c.display_name               AS chat_display_name,
            c.style                      AS chat_style
        FROM message m
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        LEFT JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE m.ROWID > ?
        ORDER BY m.ROWID ASC
        LIMIT ?
    """, (after_rowid, limit))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


def parse_attributed_body(blob):
    """
    iMessage stores formatted text in `attributedBody` as an NSKeyedArchiver
    blob. The plain-text payload is embedded with `NSString` markers. We
    don't need full parsing — just pull the longest UTF-8 run we can find.
    Returns "" if nothing meaningful.
    """
    if not blob:
        return ""
    try:
        # Heuristic: find "NSString" then a length byte, then the string.
        # Works for typical short messages without full plist parsing.
        idx = blob.find(b"NSString")
        if idx == -1:
            return ""
        # Skip "NSString" + class tag bytes; find the next printable run.
        start = idx + 8
        # Find the longest run of valid UTF-8.
        # This is ugly but reliable enough for English-ish messages.
        for offset in range(start, min(start + 64, len(blob))):
            try:
                chunk = blob[offset:].decode("utf-8", errors="strict")
                # Trim non-printable head/tail
                chunk = chunk.lstrip("\x00\x01\x02\x03\x04\x05\x06\x07\x08\x0b\x0c\x0e\x0f\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f\x7f")
                # Stop at first run of bad chars
                clean = ""
                for ch in chunk:
                    if ord(ch) < 32 and ch not in "\n\r\t":
                        break
                    clean += ch
                if len(clean) > 2:
                    return clean.strip()
            except UnicodeDecodeError:
                continue
        return ""
    except Exception:
        return ""


def transform_row(row):
    text = row.get("text") or ""
    if not text and row.get("attributed_body"):
        text = parse_attributed_body(row["attributed_body"])

    chat_id = row.get("chat_identifier") or row.get("sender_handle") or "unknown"
    chat_title = row.get("chat_display_name") or chat_id
    is_group = (row.get("chat_style") or 0) == 43
    chat_type = "group" if is_group else "private"

    return {
        "chatId": chat_id,
        "chatTitle": chat_title,
        "chatType": chat_type,
        "messageId": str(row["rowid"]),
        "senderHandle": "" if row.get("is_from_me") else (row.get("sender_handle") or ""),
        "senderName": "",  # daemon doesn't have CNContact lookup; portal renders handle
        "text": text,
        "sentAt": apple_ts_to_iso(row.get("date")),
        "isFromMe": bool(row.get("is_from_me")),
        "hasMedia": bool(row.get("has_attachments")),
        "mediaType": "image" if row.get("has_attachments") else None,
    }


# ─── HTTP ────────────────────────────────────────────────────────────

def post_batch(endpoint, secret, messages):
    body = json.dumps({"messages": messages}).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Inbox-Secret": secret,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = resp.read().decode("utf-8")
            return resp.getcode(), payload
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")
    except Exception as e:
        return 0, str(e)


# ─── main loop ───────────────────────────────────────────────────────

def run_once(cfg, state):
    if not DB_PATH.exists():
        log(f"chat.db not found at {DB_PATH} — Messages app may not be set up.", "ERROR")
        return state

    after = state.get("last_rowid", 0)

    # First run: optionally start from "now" so we don't ingest history.
    if state.get("first_seen_rowid") is None:
        try:
            conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
            cur = conn.execute("SELECT COALESCE(MAX(ROWID), 0) FROM message")
            current_max = cur.fetchone()[0]
            conn.close()
        except Exception as e:
            log(f"Initial probe failed: {e}", "ERROR")
            return state
        state["first_seen_rowid"] = current_max
        if cfg.get("ignore_messages_before") == "now":
            after = current_max
            state["last_rowid"] = current_max
            log(f"First run: skipping {current_max} historical messages, starting fresh.")
        else:
            log(f"First run: ingesting from beginning (current max ROWID = {current_max}).")
        save_state(state)

    rows = query_messages(DB_PATH, after, cfg.get("batch_size", 50))
    if not rows:
        return state

    block_set = set(s.lower() for s in cfg.get("block_chats", []))
    messages = []
    new_max = after
    for r in rows:
        new_max = max(new_max, r["rowid"])
        m = transform_row(r)
        # Apply block list
        if (m["chatId"] or "").lower() in block_set or (m["chatTitle"] or "").lower() in block_set:
            continue
        # Skip message if both text AND no media (probably empty system row)
        if not m["text"] and not m["hasMedia"]:
            continue
        messages.append(m)

    if not messages:
        state["last_rowid"] = new_max
        save_state(state)
        return state

    code, body = post_batch(cfg["endpoint"], cfg["secret"], messages)
    if code == 200:
        log(f"Posted {len(messages)} message(s), rowid {after} → {new_max}. Server: {body[:120]}")
        state["last_rowid"] = new_max
        save_state(state)
    else:
        log(f"POST failed (HTTP {code}): {body[:300]}", "ERROR")
        # Don't advance state — we'll retry next loop
    return state


def main():
    once_mode = "--once" in sys.argv

    cfg = load_config()
    state = load_state()
    log(f"Daemon starting. once_mode={once_mode}, last_rowid={state.get('last_rowid')}.")

    interval = cfg.get("poll_interval_seconds", 30)
    while True:
        try:
            state = run_once(cfg, state)
        except KeyboardInterrupt:
            log("Interrupted.")
            return
        except Exception as e:
            log(f"Unhandled error in run_once: {e}", "ERROR")
        if once_mode:
            return
        time.sleep(interval)


if __name__ == "__main__":
    main()
