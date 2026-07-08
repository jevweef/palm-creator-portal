#!/usr/bin/env python3
"""
Maya — Chief of Staff. Reads every teammate's report for the day from the report
bus, asks Claude to synthesize ONE exception-based briefing for Evan, and posts
it to the Palm Team Telegram group (Maya's topic). Read-only: Maya never acts,
she only summarizes and prioritizes.

Report bus:   ~/.claude/palm-team/reports/<YYYY-MM-DD>/<teammate>.json
Each report:  { id, teammate, dept, status, urgency(red|amber|green),
                headline, findings:[{urgency,text}], notes }

Usage:
  python3 maya_brief.py --dry-run     # print the brief, post nothing (default-safe)
  python3 maya_brief.py               # post to Telegram (Maya's topic)
  python3 maya_brief.py --date 2026-06-04
"""
import os, sys, json, glob, subprocess, datetime, urllib.request, urllib.parse

CLAUDE = "/opt/homebrew/bin/claude"
BUS = os.path.expanduser("~/.claude/palm-team/reports")
ENV = "/Users/jevanleith/palm-creator-portal/.env.local"
CHAT_ID = "-1004293138854"      # Palm Team group
MAYA_THREAD = "3"               # "Maya — Chief of Staff" topic

def today_str():
    return datetime.datetime.now().strftime("%Y-%m-%d")

def load_reports(date):
    """Maya reads the TOP layer only: department-head roll-ups (tier=manager) and
    solo monitors (tier=solo). Each manager already escalates its workers' red/amber
    items, so reading workers directly would double-report. Worker reports still
    live on the bus (inspectable) and feed their manager."""
    files = sorted(glob.glob(os.path.join(BUS, date, "*.json")))
    out = []
    for f in files:
        try:
            rep = json.load(open(f))
        except Exception as e:
            print(f"  (skipped {os.path.basename(f)}: {e})", file=sys.stderr)
            continue
        if rep.get("tier") in ("manager", "solo"):
            out.append(rep)
    return out

# Expected top-level reporters every morning (6 dept heads + Gil solo). If one is
# absent, its whole department is dark — Maya must flag that, not brief less silently.
EXPECTED_TOPLEVEL = {"theo", "vivian", "marcus", "nova", "iris", "dana", "gil"}


def build_prompt(date, reports):
    blob = json.dumps(reports, indent=2)
    present = {r.get("id") for r in reports}
    missing = sorted(EXPECTED_TOPLEVEL - present)
    alert = ""
    if missing:
        alert = (f"\n\nSYSTEM ALERT — these expected departments did NOT report today: {', '.join(missing)}. "
                 "Lead the brief with this as RED: their monitor or the scheduler may be down, so you are "
                 "BLIND on that area today. Tell Evan to check it.\n")
    return f"""You are Maya, Chief of Staff for Palm Management, an OnlyFans creator-management agency. \
It is the morning of {date}. Below are today's DEPARTMENT-HEAD roll-ups (each manager has already \
summarized and escalated their team's exceptions) plus any solo monitors (JSON). Findings are tagged \
[Worker] to show which teammate surfaced them.{alert}

Your job: write ONE short morning briefing for Evan (the owner). This is EXCEPTION-BASED — \
tell him what needs his attention or is urgent, and stay quiet about everything that is fine. \
He does NOT want a status dump; he wants to know what to act on.

Rules:
- Lead with anything urgent (urgency "red") — what needs him TODAY.
- Then "amber" heads-up items, briefly.
- Do NOT list green / all-clear items individually. If everything else is fine, say so in one short line.
- Dedupe and group related items. Be concrete (names, numbers). Plain English.
- No emoji. Use plain text labels like "NEEDS YOU TODAY:" and "HEADS UP:".
- Anything creator/fan/money-facing is drafted, never sent — if a draft is waiting, say it's ready for his approval.
- End with a single line: the one thing most worth doing first.

VOICE — this is the most important rule. Talk like a sharp human chief of staff who has
already looked at the data and is telling Evan what to DO, not a dashboard reading out stats.
For every item: state the practical recommended action AND the timing reason in one natural
sentence. Turn raw facts into advice.
- Bad (robotic):  "1 onboarding link sent, not completed (Bianca, 1d)."
- Good (admin):   "Check in with Bianca — you sent her onboarding link yesterday and she still
                   hasn't clicked it; a quick nudge now keeps her from going cold."
- Bad:  "4 invoices overdue, $1,762."
- Good: "Chase the 4 overdue invoices today (~$1,760) — MG's is a month late now, so start there."
Be warm, direct, and specific. Recommend the move; don't just report the number.
- Keep it tight — aim for under 180 words. Write it as the message itself, no preamble.

Today's reports:
{blob}
"""

def synthesize(prompt):
    # On servers (GitHub Actions) there is no Claude CLI — use the API when a
    # key is present; the local Mac keeps using the CLI (subscription billing).
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if api_key or not os.path.exists(CLAUDE):
        if not api_key:
            raise RuntimeError("no Claude CLI and no ANTHROPIC_API_KEY")
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=json.dumps({
                "model": "claude-sonnet-4-6",
                "max_tokens": 1500,
                "messages": [{"role": "user", "content": prompt}],
            }).encode(),
            headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read())
        return "".join(b.get("text", "") for b in data.get("content", [])).strip()
    r = subprocess.run([CLAUDE, "-p", prompt], capture_output=True, text=True, timeout=180)
    if r.returncode != 0:
        raise RuntimeError(f"claude -p failed ({r.returncode}): {r.stderr[:500]}")
    return r.stdout.strip()

def telegram_token():
    # Env var first (GitHub Actions / any server), .env.local fallback (Mac).
    if os.getenv("TELEGRAM_HEARTBEAT_BOT_TOKEN"):
        return os.getenv("TELEGRAM_HEARTBEAT_BOT_TOKEN")
    for line in open(ENV):
        if line.startswith("TELEGRAM_HEARTBEAT_BOT_TOKEN="):
            return line.split("=", 1)[1].strip().strip("'\" ")
    raise RuntimeError("TELEGRAM_HEARTBEAT_BOT_TOKEN not found in env or .env.local")

def post_telegram(text):
    token = telegram_token()
    data = urllib.parse.urlencode({
        "chat_id": CHAT_ID, "message_thread_id": MAYA_THREAD,
        "text": text, "disable_web_page_preview": "true",
    }).encode()
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    with urllib.request.urlopen(urllib.request.Request(url, data=data), timeout=30) as resp:
        return json.load(resp)

def main():
    dry = "--dry-run" in sys.argv
    date = today_str()
    if "--date" in sys.argv:
        date = sys.argv[sys.argv.index("--date") + 1]

    reports = load_reports(date)
    if not reports:
        print(f"No reports in bus for {date} — nothing to brief.")
        return
    print(f"Maya: synthesizing {len(reports)} report(s) for {date}...", file=sys.stderr)
    brief = synthesize(build_prompt(date, reports))

    if dry:
        print("\n===== MAYA'S BRIEF (dry-run, not posted) =====\n")
        print(brief)
        print("\n==============================================")
    else:
        res = post_telegram(brief)
        ok = res.get("ok")
        print("Posted to Telegram." if ok else f"Telegram error: {res}")
        if ok:  # marker so the heartbeat watchdog knows Maya actually briefed today
            try:
                (os.path.join(BUS, date, "_maya_posted.flag"))
                open(os.path.join(BUS, date, "_maya_posted.flag"), "w").write(today_str())
            except Exception:
                pass

if __name__ == "__main__":
    main()
