#!/usr/bin/env python3
"""
palm_agent.py — shared foundation for Palm Management teammate monitors.

Every read-only monitor (Sam, Devin, …) uses these helpers so it stays tiny and
its report lands on the bus in the one canonical shape Maya (Chief of Staff)
reads. Stdlib only — these run unattended from the isolated cron clone
(palm-research-cron), so no third-party deps.

Report bus:  ~/.claude/palm-team/reports/<YYYY-MM-DD>/<id>.json
Report shape: { id, teammate, dept, date, ran_at, status, urgency, headline,
                findings:[{urgency, text}], notes }
  urgency rolls up automatically: red if any red finding, else amber if any
  amber, else green. Maya brief is exception-based, so green = stay quiet.

A monitor is typically ~40 lines:
    from palm_agent import airtable_token, fetch_all, write_report, finding
    token = airtable_token()
    rows = fetch_all(token, BASE, TABLE, ["Field"])
    findings = [finding("…", "red")] if bad else [finding("all clear")]
    write_report(id="x", teammate="X", dept="…", headline="…", findings=findings)
"""
from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import date as _date, datetime
from pathlib import Path

API = "https://api.airtable.com/v0"
# repo root = two levels up from scripts/agents/  (works in portal AND clone)
REPO = Path(__file__).resolve().parent.parent.parent
PORTAL_ENV = Path("/Users/jevanleith/palm-creator-portal/.env.local")
BUS = Path.home() / ".claude" / "palm-team" / "reports"
CONFIG = Path.home() / ".claude" / "palm-team" / "config.json"


# ---- tunable config (the "training" surface — edit config.json, no code) -----
def _config() -> dict:
    try:
        return json.loads(CONFIG.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def cfg(teammate: str, key: str, default):
    """A per-teammate threshold, overridable in config.json; falls back to the
    in-code default so monitors are safe if the file/key is missing."""
    return _config().get("thresholds", {}).get(teammate, {}).get(key, default)


def cfg_list(key: str, default=None):
    v = _config().get(key)
    return v if isinstance(v, list) else (default or [])


def excluded(teammate: str) -> set:
    """AKAs/names the operator has muted for this teammate (planned break, etc.)."""
    return set(_config().get("exclusions", {}).get(teammate, []))


_OFFBOARDED_CACHE = None
def offboarded_creators(token: str) -> set:
    """Names + AKAs of creators with Status=Offboarded (OPS Palm Creators).
    Monitors must skip these — an offboarded creator's stale rows are noise,
    not action items (Gracie kept haunting Penny, 2026-07-07). Cached per run."""
    global _OFFBOARDED_CACHE
    if _OFFBOARDED_CACHE is not None:
        return _OFFBOARDED_CACHE
    names = set()
    try:
        rows = fetch_all(token, "applLIT2t83plMqNx", "Palm Creators", fields=["Creator", "AKA", "Status"])
        for r in rows:
            f = r.get("fields", {})
            st = f.get("Status")
            st = st if isinstance(st, str) else (st or {}).get("name", "")
            if st == "Offboarded":
                for k in (f.get("Creator"), f.get("AKA")):
                    if k:
                        names.add(str(k).strip().lower())
    except Exception:
        pass
    _OFFBOARDED_CACHE = names
    return names


# ---- env / secrets ----------------------------------------------------------
def read_env(key: str) -> str | None:
    """env var first, then the local repo's .env.local, then the portal's."""
    if os.getenv(key):
        return os.getenv(key)
    for envf in (REPO / ".env.local", PORTAL_ENV):
        if envf.exists():
            for line in envf.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    if k.strip() == key:
                        return v.strip().strip('"').strip("'")
    return None


def airtable_token() -> str:
    t = read_env("AIRTABLE_PAT") or read_env("AIRTABLE_API_KEY")
    if not t:
        raise RuntimeError("no AIRTABLE_PAT / AIRTABLE_API_KEY in env or .env.local")
    return t


# ---- Airtable reads (read-only) ---------------------------------------------
def _get(url: str, token: str) -> dict:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def get_meta(token: str, base: str) -> dict:
    """Base schema (tables + fields + choices) — for paranoid preflight checks."""
    return _get(f"{API}/meta/bases/{base}/tables", token)


def fetch_all(token: str, base: str, table_id: str, fields: list[str],
              formula: str | None = None) -> list[dict]:
    rows, offset = [], None
    while True:
        params = [("pageSize", "100")]
        for f in fields:
            params.append(("fields[]", f))
        if formula:
            params.append(("filterByFormula", formula))
        if offset:
            params.append(("offset", offset))
        url = f"{API}/{base}/{table_id}?" + urllib.parse.urlencode(params)
        data = _get(url, token)
        rows.extend(data.get("records", []))
        offset = data.get("offset")
        if not offset:
            break
    return rows


def name_map(token: str, base: str, table_id: str, name_field: str = "Creator") -> dict[str, str]:
    """recId -> display name, for resolving linked-record arrays to people."""
    out = {}
    for r in fetch_all(token, base, table_id, [name_field]):
        out[r["id"]] = (r.get("fields", {}).get(name_field) or "").strip() or r["id"][:6]
    return out


# ---- the report bus ---------------------------------------------------------
def now_iso() -> str:
    """Local time with offset, e.g. 2026-06-04T08:35:04-04:00."""
    return datetime.now().astimezone().isoformat(timespec="seconds")


def finding(text: str, urgency: str = "green") -> dict:
    return {"urgency": urgency, "text": text}


def roll_urgency(findings: list[dict]) -> str:
    if any(f.get("urgency") == "red" for f in findings):
        return "red"
    if any(f.get("urgency") == "amber" for f in findings):
        return "amber"
    return "green"


def write_report(*, id: str, teammate: str, dept: str, headline: str,
                 findings: list[dict], notes: str = "", status: str = "ok",
                 date: str | None = None, tier: str = "worker",
                 reports_to: str = "") -> dict:
    """Write a teammate's report to the bus (best-effort) and return it.

    tier: 'worker' | 'manager' | 'solo' — Maya reads manager/solo as the top
    layer and treats worker reports as the detail underneath their manager.
    reports_to: the manager id this rolls up to (for the org graph)."""
    d = date or _date.today().isoformat()
    report = {
        "id": id, "teammate": teammate, "dept": dept, "tier": tier, "reports_to": reports_to,
        "date": d, "ran_at": now_iso(), "status": status, "urgency": roll_urgency(findings),
        "headline": headline, "findings": findings, "notes": notes,
    }
    try:
        out = BUS / d
        out.mkdir(parents=True, exist_ok=True)
        (out / f"{id}.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    except Exception as e:  # noqa: BLE001 — never let a bus write crash a run
        print(f"({id}: could not write report to bus: {e})", file=sys.stderr)
    _audit(report)
    return report


def _audit(report: dict) -> None:
    """Append a one-line run record to the accountability log so every teammate's
    runs (and errors) are trackable over time: ~/.claude/palm-team/runs.log (jsonl)."""
    try:
        rec = {"ts": report["ran_at"], "id": report["id"], "tier": report.get("tier"),
               "dept": report["dept"], "status": report["status"], "urgency": report["urgency"],
               "n_findings": len(report["findings"]), "headline": report["headline"]}
        with open(BUS.parent / "runs.log", "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec) + "\n")
    except Exception:  # noqa: BLE001
        pass


def read_reports(ids: list[str], date: str | None = None) -> dict[str, dict]:
    """Manager helper: load the given teammates' reports for the day from the bus.
    Returns {id: report}; missing ids are simply absent (manager notes the gap)."""
    d = date or _date.today().isoformat()
    out = {}
    for i in ids:
        p = BUS / d / f"{i}.json"
        if p.exists():
            try:
                out[i] = json.loads(p.read_text(encoding="utf-8"))
            except Exception:  # noqa: BLE001
                pass
    return out


def rollup_findings(reports: dict[str, dict], keep=("red", "amber")) -> list[dict]:
    """Carry the red/amber findings from a manager's workers upward, attributed."""
    out = []
    for rep in reports.values():
        who = rep.get("teammate", rep.get("id"))
        for f in rep.get("findings", []):
            if f.get("urgency") in keep:
                out.append({"urgency": f["urgency"], "text": f"[{who}] {f['text']}"})
    return out


# ---- Google Sheets (read-only, OAuth refresh-token flow, stdlib only) -------
def google_access_token() -> str:
    """Exchange the stored refresh token for a short-lived access token."""
    cid = read_env("GOOGLE_CLIENT_ID"); secret = read_env("GOOGLE_CLIENT_SECRET")
    refresh = read_env("GOOGLE_REFRESH_TOKEN")
    if not (cid and secret and refresh):
        raise RuntimeError("Google OAuth creds missing (GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN)")
    body = urllib.parse.urlencode({"client_id": cid, "client_secret": secret,
                                   "refresh_token": refresh, "grant_type": "refresh_token"}).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())["access_token"]


def sheets_values(spreadsheet_id: str, rng: str, token: str | None = None):
    """GET a range from a Google Sheet. Returns the `values` 2D list, or raises
    urllib HTTPError 400 if the tab/sheet is absent (caller treats as 'missing tab')."""
    token = token or google_access_token()
    url = (f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/"
           f"{urllib.parse.quote(rng)}")
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.loads(r.read().decode()).get("values", [])


def emit_error(*, id: str, teammate: str, dept: str, problems: list[str]) -> dict:
    """Schema-drift / data-contract failure → a LOUD red report, never a false all-clear."""
    return write_report(
        id=id, teammate=teammate, dept=dept, status="error",
        headline="Data contract changed — checks skipped this run",
        findings=[finding(p, "red") for p in problems],
        notes="Self-verifies its Airtable contract every run and stops rather than report wrong numbers.",
    )
