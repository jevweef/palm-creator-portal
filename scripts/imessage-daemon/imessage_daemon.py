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
import plistlib
import sqlite3
import sys
import threading
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

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

# ─── Contact resolution (macOS AddressBook) ──────────────────────────
#
# macOS stores Contacts in a SQLite db tree under
#   ~/Library/Application Support/AddressBook/Sources/<UUID>/AddressBook-v22.abcddb
# (one Source dir per account: iCloud, Local, Exchange, etc.)
#
# We query all sources for phone numbers + emails + names, normalize each
# phone to its last-10-digits, and build a {normalized_handle -> display name}
# map. Refreshed lazily (cached per-process for 5 min).

import re

_CONTACTS_CACHE = {"map": None, "ts": 0.0, "ttl_sec": 300}


def _normalize_handle(handle):
    """Phone -> last 10 digits. Email -> lowercase. None -> None."""
    if not handle:
        return None
    h = handle.strip().lower()
    if "@" in h:
        return h
    digits = re.sub(r"\D", "", h)
    if len(digits) >= 10:
        return digits[-10:]
    return digits or None


def _addressbook_paths():
    base = HOME / "Library" / "Application Support" / "AddressBook" / "Sources"
    if not base.exists():
        return []
    paths = []
    for src in base.iterdir():
        if src.is_dir():
            db = src / "AddressBook-v22.abcddb"
            if db.exists():
                paths.append(db)
    return paths


def _load_contacts_map():
    """Build {normalized handle -> 'First Last'} from all AddressBook sources."""
    result = {}
    for db_path in _addressbook_paths():
        try:
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            # ZABCDRECORD has names; ZABCDPHONENUMBER and ZABCDEMAILADDRESS
            # link to it via ZOWNER. Schema is consistent across macOS versions.
            rows = conn.execute("""
                SELECT
                    p.ZFULLNUMBER AS phone,
                    NULL          AS email,
                    r.ZFIRSTNAME  AS first_name,
                    r.ZLASTNAME   AS last_name,
                    r.ZORGANIZATION AS org
                FROM ZABCDPHONENUMBER p
                JOIN ZABCDRECORD r ON p.ZOWNER = r.Z_PK
                UNION ALL
                SELECT
                    NULL,
                    e.ZADDRESS    AS email,
                    r.ZFIRSTNAME,
                    r.ZLASTNAME,
                    r.ZORGANIZATION
                FROM ZABCDEMAILADDRESS e
                JOIN ZABCDRECORD r ON e.ZOWNER = r.Z_PK
            """).fetchall()
            conn.close()
        except Exception as e:
            log(f"contacts: failed to read {db_path}: {e!r}", "WARN")
            continue
        for phone, email, first, last, org in rows:
            handle = _normalize_handle(phone or email)
            if not handle:
                continue
            name_parts = [p for p in (first, last) if p]
            display = " ".join(name_parts) or org or ""
            if display and handle not in result:
                result[handle] = display
    log(f"contacts: loaded {len(result)} mappings from {len(_addressbook_paths())} source(s)")
    return result


def get_contacts_map():
    """Cached accessor. Refreshes every 5 min on access."""
    now = time.time()
    if _CONTACTS_CACHE["map"] is None or now - _CONTACTS_CACHE["ts"] > _CONTACTS_CACHE["ttl_sec"]:
        try:
            _CONTACTS_CACHE["map"] = _load_contacts_map()
            _CONTACTS_CACHE["ts"] = now
        except Exception as e:
            log(f"contacts: load failed: {e!r}", "ERROR")
            if _CONTACTS_CACHE["map"] is None:
                _CONTACTS_CACHE["map"] = {}
    return _CONTACTS_CACHE["map"]


def resolve_contact(handle):
    """Return display name for a phone/email, or empty string."""
    if not handle:
        return ""
    norm = _normalize_handle(handle)
    if not norm:
        return ""
    return get_contacts_map().get(norm, "")


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


_META_PREFIXES = (
    "NS", "$", "iMessage", "__kIM", "attributed",
    "NSAttributed", "NSDictionary", "NSArray", "NSObject",
    "com.apple", "kIM",
)

def _parse_typedstream(blob):
    """
    Parse Apple's NSArchiver `typedstream` format (the OLDER serialization,
    distinct from NSKeyedArchiver bplist). iMessage's `attributedBody` uses
    this format. Headers start with b'\\x04\\x0bstreamtyped'.

    The format encodes strings as: 0x2B ('+') + varint length + UTF-8 bytes.
    We scan for that pattern and collect all length-prefixed strings, then
    filter out class metadata (NSAttributedString, NSObject, etc.) and
    return the longest remaining string — almost always the message body.
    """
    candidates = []
    i = 0
    n = len(blob)
    while i < n - 1:
        if blob[i] == 0x2B:  # '+'
            length_byte = blob[i + 1]
            if length_byte < 0x80:
                length = length_byte
                start = i + 2
            elif length_byte == 0x81 and i + 3 < n:
                length = blob[i + 2] | (blob[i + 3] << 8)
                start = i + 4
            elif length_byte == 0x82 and i + 5 < n:
                length = int.from_bytes(blob[i + 2:i + 6], "little")
                start = i + 6
            else:
                i += 1
                continue
            if 0 < length < 8192 and start + length <= n:
                try:
                    s = blob[start:start + length].decode("utf-8")
                    candidates.append(s)
                    i = start + length
                    continue
                except UnicodeDecodeError:
                    pass
        i += 1

    if not candidates:
        return ""
    user = [c for c in candidates if c and not c.startswith(_META_PREFIXES)]
    if not user:
        return ""
    return max(user, key=len).strip()


def parse_attributed_body(blob):
    """
    Extract message text from iMessage's `attributedBody` blob.

    Two possible formats:
    - typedstream (most common, header starts with b'\\x04\\x0bstreamtyped')
    - NSKeyedArchiver bplist (header starts with b'bplist00')

    Returns "" if extraction fails.
    """
    if not blob or len(blob) < 8:
        return ""

    if blob.startswith(b"\x04\x0bstreamtyped"):
        return _parse_typedstream(blob)

    if blob.startswith(b"bplist00"):
        try:
            data = plistlib.loads(blob)
        except Exception:
            return ""
        objects = data.get("$objects") if isinstance(data, dict) else None
        if not isinstance(objects, list):
            return ""
        candidates = [o for o in objects if isinstance(o, str) and len(o) > 1 and not o.startswith(_META_PREFIXES)]
        if not candidates:
            return ""
        return max(candidates, key=len).strip()

    # Unknown format — last-ditch heuristic search for any UTF-8 strings.
    try:
        text = blob.decode("utf-8", errors="ignore")
        runs = [r for r in text.split("\x00") if len(r) > 2 and not r.startswith(_META_PREFIXES)]
        return max(runs, key=len).strip() if runs else ""
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
        # Outbound: set senderHandle to a stable "us" identifier so the server
        # extractor recognizes it ("jevweef" matches Telegram username for
        # unified detection across sources). Inbound: pass through actual handle.
        "senderHandle": "jevweef" if row.get("is_from_me") else (row.get("sender_handle") or ""),
        # Resolve display name from Contacts when available (else empty,
        # portal falls back to handle).
        "senderName": "Evan" if row.get("is_from_me") else (resolve_contact(row.get("sender_handle")) or ""),
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


def reset_to_days_ago(days):
    """
    Reset state so the next run begins from N days ago. Looks up the rowid of
    the earliest message within the window and rewinds last_rowid to that-1.
    The daemon then re-emits all messages from that point forward. Server-side
    backfill logic absorbs duplicates and fills text on metadata-only records.
    """
    if not DB_PATH.exists():
        log(f"chat.db not found at {DB_PATH}", "ERROR")
        sys.exit(1)
    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=days)
    apple_seconds = cutoff.timestamp() - APPLE_EPOCH.timestamp()
    apple_ns = int(apple_seconds * 1e9)
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    cur = conn.execute("SELECT MIN(ROWID) FROM message WHERE date > ?", (apple_ns,))
    row = cur.fetchone()
    conn.close()
    earliest = (row[0] if row and row[0] else 0)
    new_last = max(0, earliest - 1)
    state = load_state()
    prev = state.get("last_rowid", 0)
    state["last_rowid"] = new_last
    save_state(state)
    log(f"Reset state: last_rowid {prev} -> {new_last} (earliest in last {days}d = rowid {earliest}).")
    log("Restart launchd to start backfilling:")
    log("  launchctl unload ~/Library/LaunchAgents/com.palm.inbox.imessage.plist")
    log("  launchctl load ~/Library/LaunchAgents/com.palm.inbox.imessage.plist")


# ─── Local HTTP server (paired with Cloudflare Tunnel) ──────────────
#
# Serves chats + messages from chat.db on demand. Lets the portal fetch
# data without writing it to Airtable first. Lives on port 8765 by default.
# Auth: X-Daemon-Secret header against cfg['daemon_secret'].

_HTTP_PORT = 8765


def _http_fetch_chats(limit):
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT
            c.ROWID                AS chat_rowid,
            c.chat_identifier      AS chat_identifier,
            c.display_name         AS display_name,
            c.style                AS style,
            COUNT(m.ROWID)         AS msg_count,
            MAX(m.date)            AS last_date
        FROM chat c
        JOIN chat_message_join cmj ON c.ROWID = cmj.chat_id
        JOIN message m ON m.ROWID = cmj.message_id
        GROUP BY c.ROWID
        ORDER BY last_date DESC
        LIMIT ?
    """, (limit,)).fetchall()
    chats = []
    for row in rows:
        chat = dict(row)
        last = conn.execute("""
            SELECT m.text, m.attributedBody, m.is_from_me, m.cache_has_attachments
            FROM message m
            JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
            WHERE cmj.chat_id = ?
            ORDER BY m.date DESC LIMIT 1
        """, (chat["chat_rowid"],)).fetchone()
        text = ""
        is_from_me = False
        if last:
            text = last["text"] or ""
            if not text and last["attributedBody"]:
                text = parse_attributed_body(last["attributedBody"])
            is_from_me = bool(last["is_from_me"])
            if not text and last["cache_has_attachments"]:
                text = "[media]"
        # Resolve a friendly title:
        # - If chat has a display_name (group chats often do), use it.
        # - Else if chat_identifier is a phone/email, look up in Contacts.
        # - Else fall back to chat_identifier.
        ident = chat["chat_identifier"]
        title = chat["display_name"]
        if not title and ident:
            title = resolve_contact(ident) or ident
        chats.append({
            "chatId": ident,
            "title": title,
            "type": "group" if chat["style"] == 43 else "private",
            "messageCount": chat["msg_count"],
            "lastMessageAt": apple_ts_to_iso(chat["last_date"]),
            "lastMessageSnippet": text[:140],
            "isFromMeLast": is_from_me,
        })
    conn.close()
    return chats


def _http_fetch_messages(chat_id, limit):
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT
            m.ROWID AS rowid, m.guid AS guid, m.text AS text,
            m.attributedBody AS attributed_body,
            m.is_from_me AS is_from_me, m.date AS date,
            m.cache_has_attachments AS has_attachments,
            h.id AS sender_handle
        FROM chat c
        JOIN chat_message_join cmj ON c.ROWID = cmj.chat_id
        JOIN message m ON m.ROWID = cmj.message_id
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        WHERE c.chat_identifier = ?
        ORDER BY m.date DESC LIMIT ?
    """, (chat_id, limit)).fetchall()
    conn.close()
    messages = []
    for r in reversed(rows):
        text = r["text"] or ""
        if not text and r["attributed_body"]:
            text = parse_attributed_body(r["attributed_body"])
        sender_handle = "" if r["is_from_me"] else (r["sender_handle"] or "")
        sender_name = resolve_contact(sender_handle) if sender_handle else ""
        messages.append({
            "messageKey": f"imsg:{chat_id}_{r['rowid']}",
            "text": text,
            "senderHandle": sender_handle,
            "senderName": sender_name,
            "sentAt": apple_ts_to_iso(r["date"]),
            "isFromMe": bool(r["is_from_me"]),
            "hasMedia": bool(r["has_attachments"]),
            "mediaType": "photo" if r["has_attachments"] else None,
        })
    return messages


class _DaemonHandler(BaseHTTPRequestHandler):
    server_version = "PalmInboxDaemon/1.0"

    def log_message(self, fmt, *args):
        pass  # silence access logs

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "X-Daemon-Secret, Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _check_auth(self, secret):
        provided = self.headers.get("X-Daemon-Secret", "")
        if not secret:
            self._send_json(500, {"error": "daemon_secret not configured"})
            return False
        if provided != secret:
            self._send_json(401, {"error": "unauthorized"})
            return False
        return True

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "X-Daemon-Secret, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.end_headers()

    def do_GET(self):
        cfg = load_config()
        secret = cfg.get("daemon_secret")
        url = urlparse(self.path)
        params = parse_qs(url.query)
        path = url.path.rstrip("/")

        if path == "/health":
            self._send_json(200, {
                "ok": True,
                "dbExists": DB_PATH.exists(),
                "secretConfigured": bool(secret),
                "service": "palm-inbox-daemon",
            })
            return

        if not self._check_auth(secret):
            return

        try:
            if path == "/chats":
                limit = max(1, min(int(params.get("limit", [200])[0]), 1000))
                self._send_json(200, {"chats": _http_fetch_chats(limit)})
                return
            if path == "/chat":
                chat_id = (params.get("chatId") or [None])[0]
                if not chat_id:
                    self._send_json(400, {"error": "chatId required"})
                    return
                limit = max(1, min(int(params.get("limit", [200])[0]), 1000))
                self._send_json(200, {"messages": _http_fetch_messages(chat_id, limit)})
                return
            self._send_json(404, {"error": "not found"})
        except Exception as e:
            log(f"http error: {e!r}", "ERROR")
            self._send_json(500, {"error": str(e)})


def start_http_server_thread():
    """Spawn the local HTTP server on a daemon thread. Inherits FDA from
    the parent process (launchd-grant), so DB queries succeed."""
    def _run():
        try:
            srv = ThreadingHTTPServer(("127.0.0.1", _HTTP_PORT), _DaemonHandler)
            log(f"HTTP server listening on http://localhost:{_HTTP_PORT}")
            srv.serve_forever()
        except Exception as e:
            log(f"HTTP server crashed: {e!r}", "ERROR")
    t = threading.Thread(target=_run, daemon=True, name="palm-http-server")
    t.start()


def main():
    if "--backfill-days" in sys.argv:
        idx = sys.argv.index("--backfill-days")
        try:
            days = int(sys.argv[idx + 1])
        except (IndexError, ValueError):
            log("Usage: --backfill-days N", "ERROR")
            sys.exit(1)
        reset_to_days_ago(days)
        return

    once_mode = "--once" in sys.argv

    cfg = load_config()
    state = load_state()

    # Start the HTTP server thread (skipped in --once mode)
    if not once_mode:
        start_http_server_thread()

    # One-shot backfill: if config has backfill_days_on_next_start set, do
    # the reset, clear the flag, then continue polling normally. Lets us
    # trigger a backfill remotely without needing direct chat.db access.
    backfill = cfg.get("backfill_days_on_next_start")
    if backfill and isinstance(backfill, int) and backfill > 0:
        log(f"Config-triggered backfill: rewinding {backfill} days")
        reset_to_days_ago(backfill)
        # Clear the flag so we don't re-backfill on every restart
        cfg["backfill_days_on_next_start"] = None
        with open(CONFIG_PATH, "w") as f:
            json.dump(cfg, f, indent=2)
        # Reload state since reset_to_days_ago wrote it
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
