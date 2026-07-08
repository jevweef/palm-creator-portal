#!/usr/bin/env python3
"""
bank_ledger_import.py — daily SimpleFIN → Airtable "Bank Ledger" importer.

Pulls Chase Business Complete Checking transactions from the SimpleFIN Bridge
(simplefin.org) and upserts them into HQ `Bank Ledger` (tbl3nEPyB10CfvjBN),
keyed on the SimpleFIN transaction id so re-runs never duplicate.

Two consumers read this table:
  • Ivy  — invoice reconciliation (match incoming Zelle/ACH to outstanding invoices)
  • Scrooge v2 — cost diff vs the Software Stack (untracked spend / price hikes / cancelled)

Amount is SIGNED: positive = money in (credit), negative = money out (debit).
SimpleFIN refreshes Chase ~once/day, so this runs once/day in the morning chain
BEFORE Ivy. Read-only against the bank; only writes the ledger table.

Usage:
  python3 bank_ledger_import.py            # daily incremental (45-day window)
  python3 bank_ledger_import.py --days 90  # wider backfill (first run / catch-up)

SECURITY: the SimpleFIN access URL embeds credentials. It is read from .env.local
and NEVER printed. All error paths are sanitized so the URL can't leak to logs.
"""
from __future__ import annotations

import base64
import json
import os
import re
import ssl
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

from palm_agent import airtable_token

HQ = "appL7c4Wtotpz07KS"
T_LEDGER = "tbl3nEPyB10CfvjBN"
ACCESS_URL_ENV = "SIMPLEFIN_ACCESS_URL"
ENV_FILE = Path(__file__).resolve().parents[2] / ".env.local"
DEFAULT_DAYS = 45

# ---- merchant normalization + categorization -------------------------------
# Known recurring debit merchants → (display name, category). Matched on the raw
# descriptor (uppercased). Order matters — first hit wins.
MERCHANT_MAP = [
    ("DROPBOX",            "Dropbox",        "Software"),
    ("VERCEL",             "Vercel",         "Software"),
    ("ANTHROPIC",          "Anthropic",      "Software"),
    ("CLAUDE.AI",          "Claude.ai",      "Software"),
    ("OPENAI",             "OpenAI",         "Software"),
    ("APIFY",              "Apify",          "Software"),
    ("RAPIDAPI",           "RapidAPI",       "Software"),
    ("WAVESPEED",          "WaveSpeed",      "Software"),
    ("AIRTABLE",           "Airtable",       "Software"),
    ("ELEVENLABS",         "ElevenLabs",     "Software"),
    ("WISPR",              "Wispr Flow",     "Software"),
    ("CONTENTSNARE",       "Content Snare",  "Software"),
    ("CONTENT SNARE",      "Content Snare",  "Software"),
    ("GROK",               "Grok (xAI)",     "Software"),
    ("XAI",                "Grok (xAI)",     "Software"),
    ("ONLYFANSAPI",        "OnlyFans API",   "Software"),
    ("FANBASIS",           "Fanbasis",       "Chatting"),
    ("TJP",                "TJP (editor)",   "Editing"),
    ("WISE INC",           "Wise (payout)",  "Payout"),
    ("WISE",               "Wise (payout)",  "Payout"),
    ("PAYPAL",             "PayPal",         "Other"),
]


def normalize_merchant(desc: str, payee: str, amount: float):
    """Return (merchant, category). Handles Zelle people + known merchants."""
    raw = (desc or "").strip()
    up = raw.upper()

    # Zelle: pull the human name out of "Zelle payment from/to NAME <ref digits>"
    m = re.search(r"ZELLE\s+PAYMENT\s+(FROM|TO)\s+(.+)", up)
    if m:
        name = re.sub(r"\s+[0-9A-Z]{8,}$", "", m.group(2).strip())   # strip trailing ref id
        name = re.sub(r"\s+\d{6,}$", "", name).strip()
        pretty = " ".join(w.capitalize() for w in re.split(r"\s+", name)) or "Zelle"
        # money IN from a person = creator payment candidate; money OUT = payout/transfer
        cat = "Creator Payment" if amount > 0 else "Payout"
        return pretty, cat

    for needle, name, cat in MERCHANT_MAP:
        if needle in up:
            return name, cat

    # ACH credit not from Zelle — still a possible creator/biz inflow
    if amount > 0:
        cleaned = re.sub(r"\bORIG (CO NAME|ID)\b.*", "", raw, flags=re.I).strip(" :")
        return (cleaned[:40] or "Deposit"), "Other"

    # generic debit: take the leading token, drop ref codes
    token = re.split(r"[\*#]| {2,}", raw)[0].strip()
    token = re.sub(r"\s+[0-9]{4,}.*$", "", token)
    return (token[:40] or "Unknown"), "Other"


def load_access_url() -> str:
    if os.getenv(ACCESS_URL_ENV):
        return os.getenv(ACCESS_URL_ENV).strip()
    if not ENV_FILE.exists():
        print("ledger: .env.local not found", file=sys.stderr); raise SystemExit(2)
    for line in ENV_FILE.read_text().splitlines():
        if line.startswith(ACCESS_URL_ENV + "="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    print(f"ledger: {ACCESS_URL_ENV} missing from .env.local", file=sys.stderr); raise SystemExit(2)


def fetch_transactions(days: int):
    """GET SimpleFIN /accounts. Returns (account_label, [txn dicts]). Sanitized errors."""
    url = load_access_url()
    p = urllib.parse.urlparse(url)
    auth = base64.b64encode(f"{p.username}:{p.password}".encode()).decode()
    clean = f"{p.scheme}://{p.hostname}{p.path}".rstrip("/")          # no creds in this string
    start = int((datetime.now(timezone.utc) - timedelta(days=days)).timestamp())
    endpoint = f"{clean}/accounts?start-date={start}"
    try:
        req = urllib.request.Request(endpoint, headers={"Authorization": f"Basic {auth}",
                                                        "User-Agent": "palm-ledger/1.0"})
        with urllib.request.urlopen(req, timeout=60, context=ssl.create_default_context()) as r:
            data = json.load(r)
    except Exception as e:                                            # never echo the url
        print(f"ledger: SimpleFIN request failed ({type(e).__name__})", file=sys.stderr)
        raise SystemExit(1)
    out = []
    label = "?"
    for a in data.get("accounts", []):
        label = f"{a.get('name','?')}".strip()
        for t in a.get("transactions", []):
            out.append((label, t))
    return label, out


# ---- Airtable REST (urllib, token from palm_agent) -------------------------
def _air(method: str, path: str, token: str, body=None):
    url = f"https://api.airtable.com/v0/{HQ}/{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Authorization": f"Bearer {token}",
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.load(r)


def fetch_all_ledger(token: str):
    rows, offset = [], None
    while True:
        q = "Bank%20Ledger?pageSize=100&fields%5B%5D=Txn%20ID&fields%5B%5D=Merchant&fields%5B%5D=Posted%20Date&fields%5B%5D=Recurring"
        if offset:
            q += f"&offset={offset}"
        d = _air("GET", q, token)
        rows.extend(d.get("records", []))
        offset = d.get("offset")
        if not offset:
            break
    return rows


def upsert(token: str, records: list):
    """PATCH upsert in batches of 10, merging on Txn ID."""
    n = 0
    for i in range(0, len(records), 10):
        batch = records[i:i + 10]
        body = {"performUpsert": {"fieldsToMergeOn": ["Txn ID"]},
                "records": [{"fields": f} for f in batch], "typecast": True}
        _air("PATCH", "Bank%20Ledger", token, body)
        n += len(batch)
    return n


def main():
    days = DEFAULT_DAYS
    if "--days" in sys.argv:
        try:
            days = int(sys.argv[sys.argv.index("--days") + 1])
        except (ValueError, IndexError):
            pass

    label, txns = fetch_transactions(days)
    if not txns:
        print(f"ledger: 0 transactions in last {days}d (nothing to import)"); return 0

    now_iso = datetime.now(timezone.utc).astimezone().isoformat()
    records = []
    for acct_label, t in txns:
        amount = float(t.get("amount") or 0)
        desc = t.get("description") or ""
        merchant, category = normalize_merchant(desc, t.get("payee") or "", amount)
        posted = datetime.fromtimestamp(int(t.get("posted") or 0), timezone.utc).date().isoformat()
        rec = {
            "Txn ID": str(t.get("id")),
            "Posted Date": posted,
            "Amount": round(amount, 2),
            "Direction": "Credit" if amount > 0 else "Debit",
            "Description": desc[:200],
            "Merchant": merchant,
            "Account": acct_label,
            "Category": category,
            "Memo": (t.get("memo") or "")[:200],
            "Imported At": now_iso,
        }
        # Only creator-payment credits enter the reconciliation queue for Ivy.
        if category == "Creator Payment" and amount > 0:
            rec["Reconcile Status"] = "Unreviewed"
        records.append(rec)

    token = airtable_token()
    wrote = upsert(token, records)

    # --- recurring pass: merchant seen in 2+ distinct months across whole ledger ---
    ledger = fetch_all_ledger(token)
    months = {}
    for r in ledger:
        f = r.get("fields", {})
        mname = (f.get("Merchant") or "").strip()
        pd = f.get("Posted Date") or ""
        if mname and len(pd) >= 7:
            months.setdefault(mname, set()).add(pd[:7])
    recurring_merchants = {m for m, ms in months.items() if len(ms) >= 2}
    flips = []
    for r in ledger:
        f = r.get("fields", {})
        want = (f.get("Merchant") or "").strip() in recurring_merchants
        if bool(f.get("Recurring")) != want:
            flips.append({"id": r["id"], "fields": {"Recurring": want}})
    for i in range(0, len(flips), 10):
        _air("PATCH", "Bank%20Ledger", token, {"records": flips[i:i + 10]})

    credits = sum(1 for _, t in txns if float(t.get("amount") or 0) > 0)
    debits = len(txns) - credits
    print(f"ledger: imported/updated {wrote} txns from {label} "
          f"({credits} credits, {debits} debits) · {len(recurring_merchants)} recurring merchants "
          f"· {len(flips)} recurring flags updated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
