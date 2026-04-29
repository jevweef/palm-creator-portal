# Palm Inbox — iMessage Daemon Setup

A small Python script that runs on your Mac, polls the iMessage SQLite DB
every 30 seconds, and POSTs new messages to the Palm portal so they flow
into the Inbox alongside Telegram.

**Stdlib only — no `pip install` required.** Needs Python 3.8+ (which ships
with macOS by default at `/usr/bin/python3`).

---

## One-time setup (~10 minutes)

### 1. Pick a folder for the daemon

Wherever you like. Suggested:

```
mkdir -p ~/palm-inbox
cp imessage_daemon.py ~/palm-inbox/
cp com.palm.inbox.imessage.plist ~/palm-inbox/
cd ~/palm-inbox
```

### 2. Grant Full Disk Access

The daemon reads `~/Library/Messages/chat.db`, which macOS protects.

1. Open **System Settings → Privacy & Security → Full Disk Access**
2. Click the **+** button
3. Press **Cmd+Shift+G**, type `/usr/bin/python3`, hit Enter, then "Open"
4. Toggle the new entry **on**
5. (Optional but cleaner) Also add **Terminal.app** so the test run works

> Without this step you'll get `OperationalError: unable to open database file`.

### 3. Create the config file

```bash
python3 ~/palm-inbox/imessage_daemon.py --once
```

First run will write a default config to `~/.palm-inbox.json` and exit. Open
that file and edit:

```json
{
  "endpoint": "https://app.palm-mgmt.com/api/inbox/imessage",
  "secret": "PASTE_THE_SECRET_HERE",
  "poll_interval_seconds": 30,
  "batch_size": 50,
  "ignore_messages_before": "now",
  "block_chats": []
}
```

- **endpoint**: keep as-is for production. For dev testing, point at the
  Vercel preview URL: `https://palm-creator-portal-git-dev-evan-5378s-projects.vercel.app/api/inbox/imessage`
- **secret**: paste the value of `IMESSAGE_INGEST_SECRET` from Vercel env vars
- **ignore_messages_before**: `"now"` skips your entire historical chat.db
  on first run (recommended). Use `null` to ingest everything (will be a
  lot of messages).
- **block_chats**: phone numbers, emails, or group names you want completely
  ignored. Spam, mom, group chats with 50 randoms — list them here. The
  daemon never sees those messages, so the portal never does either.

### 4. Test once

```bash
python3 ~/palm-inbox/imessage_daemon.py --once
```

You should see something like:

```
[2026-04-29T18:30:00] [INFO] Daemon starting. once_mode=True, last_rowid=0.
[2026-04-29T18:30:00] [INFO] First run: skipping 142387 historical messages, starting fresh.
```

It exits after one poll. Send yourself an iMessage from your phone, then
run again — you should see it post the new message and the server log.

### 5. Install as a launchd service (auto-start on login)

Edit `com.palm.inbox.imessage.plist` — replace `CHANGE_ME` with your
actual macOS username (or update the absolute path to wherever you put
the .py file). Then:

```bash
cp ~/palm-inbox/com.palm.inbox.imessage.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.palm.inbox.imessage.plist
```

Verify it's running:

```bash
launchctl list | grep palm
# Should show com.palm.inbox.imessage with a PID
tail -f ~/.palm-inbox.log
```

---

## What's happening

- Daemon polls `~/Library/Messages/chat.db` every 30s
- Tracks the last-seen `ROWID` in `~/.palm-inbox.state.json`
- Sends new messages (incoming + outgoing) to the portal
- Portal stores them in **Telegram Chats / Telegram Messages** Airtable
  tables with `Source = imessage`
- New chats land as **Pending Review** — nothing flows to AI extraction
  until you explicitly Watch them in `/admin/inbox?tab=chats`

---

## Daily ops

**Logs**: `~/.palm-inbox.log` (script-level), `~/Library/Logs/palm-inbox.{out,err}` (launchd-level)

**Check it's running**: `launchctl list | grep palm`

**Restart**:
```bash
launchctl unload ~/Library/LaunchAgents/com.palm.inbox.imessage.plist
launchctl load ~/Library/LaunchAgents/com.palm.inbox.imessage.plist
```

**Reset state** (re-ingest from a different point):
```bash
rm ~/.palm-inbox.state.json
# Edit ~/.palm-inbox.json, set ignore_messages_before to "now" or an ISO timestamp
launchctl unload ~/Library/LaunchAgents/com.palm.inbox.imessage.plist
launchctl load ~/Library/LaunchAgents/com.palm.inbox.imessage.plist
```

**Stop entirely**:
```bash
launchctl unload ~/Library/LaunchAgents/com.palm.inbox.imessage.plist
```

---

## Troubleshooting

**"unable to open database file"** → Step 2 (Full Disk Access) wasn't done correctly. Re-add `/usr/bin/python3` and restart Terminal.

**"unauthorized" 401 from server** → Secret in `~/.palm-inbox.json` doesn't match `IMESSAGE_INGEST_SECRET` in Vercel env. Copy/paste again.

**No new messages appearing despite sending iMessages** → Send a message from your *phone* to a contact (not Mac to Mac) and wait 60 seconds. Mac-to-Mac messages sometimes don't write to chat.db immediately.

**Want to ingest a specific older chat retroactively** → Stop the daemon, query chat.db manually for the chat's earliest ROWID, set `last_rowid` in `~/.palm-inbox.state.json` to that value minus 1, restart. Be aware this will replay ALL messages in ALL chats since that point (the daemon doesn't filter by chat at the DB level).
