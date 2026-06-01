# Palm Management — Teammate Organization

> **Canonical checkpoint doc** for the "staff palm-mgmt with Claude agents" initiative.
> Also referenced as: *Palm Management Organization*, *Team Members / Teammates*, *Agent Org*.
> Started 2026-05-28 · last updated 2026-05-29 · **Status: DESIGN / REFINE phase — nothing in production yet.**
> If you're a future session: read this top to bottom. It is the line-in-the-sand for everything discussed.

---

## 0. TL;DR — where we are right now

- **Goal:** Build an "office" of autonomous Claude agents ("teammates") that do palm-mgmt's recurring admin work without Evan prompting them — like employees with standing marching orders. They should report to Evan in plain English, work on a schedule, check each other's work (accountability), and collaborate.
- **Key reframe Evan now understands:** Claude teammates are **back-office staff**, NOT a feature embedded in the website. They run in the Claude environment / cloud and operate *on top of* the existing site + Airtable, the way a remote employee with a laptop would. They are NOT shown to creators/users.
- **What's actually built:** One agent definition (`pipeline-qa-monitor.md`) + Maya the Chief of Staff (`chief-of-staff.md`) + the org docs + an HTML org-chart visual. **All on the `worktree-pipeline-qa-monitor` branch, NOT merged to dev/main.** Nothing runs on a schedule yet.
- **Current recommended design:** **Maya (Chief of Staff) + 5 fat department heads + 1 recommended add (Sentinel/Compliance).** This SUPERSEDES the older ~10/25-role drafts after the 2026-05-29 deep research — **see §16 for the current canonical org, the per-creator setup checklist, and the off-system gaps.**
- **Decisions locked:** (1) refine the org on paper before building more; (2) keep placeholder names for now; (3) draft-and-approve for anything creator/fan/money-facing; (4) crons = machines, agents = staff.
- **Biggest open questions:** (a) who are Evan's *human* team members and which departments should report to them instead of Evan; (b) are there whole departments not in the codebase (recruiting/sales, compliance/leak-monitoring, chat/PPV ops); (c) final lean-vs-fuller dial; (d) the data-access prerequisite for "while you sleep" autonomy (see §9).

---

## 1. The core concept

**The office analogy (Evan's framing, adopted):**
- **Crons = the machines.** The 10 existing Vercel cron jobs are deterministic factory equipment. They move files and never think.
- **Agents = the staff.** Teammates exercise judgment — they notice, decide, draft, escalate — and they *operate* the machines and watch the queues the machines feed.
- **Airtable (base `applLIT2t83plMqNx`) = the office building** everyone works in. Real-creator content also flows through Telegram; AI content through Publer.
- **"Walking to each other's desks"** = in one coordinated morning "standup" run, a manager agent delegates to specialists, they hand results back, the manager checks the work and reports up. That's the collaboration — one orchestrated run, not 12 disconnected alarms.

**How a teammate is actually built (the mechanics):**
1. **A job-description file** — `.claude/agents/<name>.md` with frontmatter (name, allowed tools, model) + a system-prompt body that *is* its marching orders.
2. **A schedule** — a recurring run (cloud "routine" via `/schedule`, or a local `/loop`) that fires the agent with no prompting. That's the "works without me" part.

**Hard rules every agent inherits:**
1. Read-only by default — never patch/create/delete or call a write/send endpoint unless explicitly authorized.
2. **Never auto-send to a creator or fan.** Creator/fan-facing work is DRAFT-AND-APPROVE: the agent drafts, a human taps send.
3. Never spend money unprompted (paid generation jobs like Kling require per-run approval).
4. Escalate, don't hide — if a data source is unreachable, say so. A false "all clear" is the worst outcome.
5. Report up, not around — specialists → manager → Chief of Staff → Evan.

---

## 2. The journey so far (chronological — don't lose this)

1. **Started with one hire to learn the feature:** the **Pipeline QA Monitor** — a read-only agent that audits the Publer AI-posting pipeline.
   - It was **built AND test-run locally** against live Airtable on 2026-05-28.
   - **Finding:** the Publer pipeline is **built but fully dormant** — `0` Publer Accounts mapped, `0` Posts have ever entered the pipeline. So the monitor correctly reported "⚠️ dormant, not broken." (Consistent with the Publer launch prerequisites in [[project-publer-ai-pipeline]] not being done yet.)
   - This proved the whole teammate pattern end-to-end: a markdown job description + a data source = an autonomous worker that produces an honest text report.
2. **Discovered the autonomy constraint:** a *remote cloud* routine can't read Airtable today — only Google Calendar and Vercel are connected as claude.ai connectors. (See §9.)
3. **Evan expanded the scope:** don't just do social media — design an org for the *whole* OnlyFans agency, all positions, with a hierarchy, accountability (managers checking workers), and everyone reporting to Evan in layman's terms.
4. **Scouted the entire admin surface:** six parallel explore agents mapped every department for the *manual admin work* an agent could take over. Findings in §7 — this is the gold.
5. **Drafted a full 25-role org** (7 departments + Chief of Staff). See §6.
6. **Evan flagged that many roles had tiny workloads** and asked the right architecture question: should each agent have one responsibility, or should department heads do more solo?
7. **Consolidated** on the principle *"split by context, not by chore"* → the lean ~10-agent design in §5. Built an HTML visual.
8. **Evan chose to refine on paper before building** and to keep placeholder names. → This checkpoint doc.

---

## 3. The consolidation principle (the most important design rule)

> **One agent = one coherent context + one kind of decision.**
> Work that reads the same data and makes the same kind of call belongs in ONE agent — no matter how small each individual piece is. "This task is small" is NOT a reason to give it its own agent (Claude agents aren't hour-limited the way humans are; over-splitting just adds spin-up overhead, duplicated context reads, more handoffs, and more prompts to maintain).

**Split a department into multiple agents ONLY when:**

| Split when… | Because | Example in this org |
|---|---|---|
| **Stakes are high** | A mistake costs money/face → isolate it, give it extra review | Revenue (Marcus's team) |
| **Different data world** | Shares no context with neighbors → merging buys nothing | Nico (inspo lives in an external repo) |
| **Heavy / costs money** | Deserves its own gated run | Rex (Recreate, Kling ~$1–4/clip) |
| **Different cadence** | Not part of the morning standup; fires when Evan does the task | Penny, Cleo (on-call shelf) |
| **Sheer volume** | High-frequency enough to dedicate a worker | (Inbox, if it grows) |

Otherwise: **one capable agent per department, doing the whole job.** Workload size alone is never the reason to split.

---

## 4. Communication design

- **Channel:** SMS / text to Evan. (Requires a small sender hookup — e.g. Twilio ~$1/mo + pennies per message — NOT yet wired. Telegram is the lower-friction alternative since the agency already lives there.)
- **Cadence:** one **morning briefing** (the standup output) per day. Urgent events (failed posts, payment overdue, whale going cold) may fire an extra ping.
- **Two tiers (Evan's explicit ask):**
  - **Layman briefing** — short, plain-English, leads with what needs him, no jargon/IDs/field-names, uses real people's names. This is the text he reads.
  - **Detailed report** — the full audit trail behind it (every finding, who raised it, the evidence, what was escalated/merged/killed and why). Saved for drill-down (future: an Airtable "Briefings" table or a portal page).
- **Urgency tiers:** 🔴 needs you today · 🟡 heads up · 🟢 handled.
- **Accountability chain (the hierarchy Evan wanted):**
  `Specialist finds X → Manager challenges it ("did you miss context Y?") → Maya dedupes across departments + prioritizes → Evan gets one line.`
  Nothing reaches Evan until a manager has fact-checked it and Maya has confirmed it's real and not double-counted. A specialist cannot cry wolf straight to Evan.

**Sample morning briefing:**
```
☀️ Palm @ 8am, Tue — 🔴2 need you · 🟡4 fyi · 🟢 rest good
🔴 Bella 1/5 reels — Vivian drafted a nudge
🔴 Whale "J" cold on Sunny — Wendy's alert ready to send
🟡 Mike's edits bouncing 2x; 3 creators overdue check-in; Publer still dormant; runway fine
Reply DETAIL for the full report or OK BELLA to send Vivian's draft.
```

---

## 5. RECOMMENDED ORG (lean build — current recommendation)

~10 daily agents + 3 on-call specialists. Tiers: 🟢 read-only/safe · 🟡 drafts, human approves · 🔴 future/assist-only.

**Chief of Staff**
- **Maya** — runs the daily standup, fact-checks every finding, dedupes/prioritizes, writes Evan's briefing + the detailed report. The single point of contact between Evan and all other agents. *(Built: `.claude/agents/chief-of-staff.md`.)*

**Daily standup crew (each does its whole department solo unless noted):**
- **Vivian — Talent & Relations** 🟡 — quota gaps, creator outreach drafts, onboarding follow-up, retention/at-risk. *(Absorbs the original Riley + Sam + Olive + Quinn.)*
- **Theo — Content Production** 🟢 — editor performance metrics, review-queue triage, content-request chasing. *(Absorbs Jordan + Mara + Devin.)*
- **Dana — Distribution** 🟢 — posting-pipeline health (the Pipeline QA Monitor work), quota & account coverage, AI-account warmup health. *(Absorbs Pax + Cody + Wes.)*
- **Nova — Intelligence** 🟡 — inbox triage + reply drafts, daily analytics/dashboard digest. *(Absorbs Bea + Ana.)*
- **Nico — Inspo / Trend Scout** 🟢 — source-reel grading, per-creator trend analysis. *Kept separate: own data world + ties to external repo `jevweef/inspo-pipeline`.*
- **Gil — Engineering & Reliability** 🟢 — cron health, Vercel error logs, dead/stub buttons, drafts bug tickets. *Can run in the cloud TODAY (Vercel MCP is connected).*
- **Marcus — Revenue (department head WITH a sub-team — kept split for STAKES, not workload)** 🟡
  - **Wendy** — whale watch / going-cold alerts (reads chat logs + Fan Tracker).
  - **Fin** — earnings data integrity + invoicing. *(Merge of the original Ed + Ivy.)*

**On-call specialists (NOT in the daily standup — summoned when Evan does the task):**
- **Penny — Post-Prep drafter** 🟡 — drafts captions/hashtags, suggests thumbnails when Evan is prepping posts.
- **Cleo — Carousel QA** 🟡 — pre-screens AI carousel slides vs. source when carousels are pending.
- **Rex — Recreate co-pilot** 🔴 — babysits the Wan/Kling reel pipeline; future hire (vision-heavy + per-clip cost).

**The dial:** this is the *middle* setting. Leaner (~6) is possible (fold Nico→Nova, Gil→Dana, run Revenue solo) at the cost of broader per-agent context + a coarser briefing. Do NOT go fatter than ~10 — one agent juggling unrelated data worlds gets sloppy.

---

## 6. ORIGINAL 25-role draft (preserved for context)

The first, fuller version — kept so nothing is lost. Format: **Name — role (tier)**. The "→" shows where each landed in the lean build (§5).

- **Maya** — Chief of Staff → unchanged.
- **Talent & Relations — Vivian (Director)**
  - Riley — Creator Relations 🟡 → into **Vivian**
  - Sam — Content Supply Analyst 🟢 → into **Vivian**
  - Olive — Onboarding Coordinator 🟡 → into **Vivian**
  - Quinn — Retention / Offboarding 🟡 → into **Vivian**
- **Content Production — Theo (Manager)**
  - Jordan — Editor QA Auditor 🟢 → into **Theo**
  - Mara — Review-Queue Triage 🟢 → into **Theo**
  - Devin — Content-Request Tracker 🟡 → into **Theo**
- **AI Studio — Iris (Lead)** *(department dissolved in lean build)*
  - Rex — Recreate Pipeline 🔴 → **on-call (Rex)**
  - Cleo — Carousel QA 🟡 → **on-call (Cleo)**
  - Wes — Warmup Ops 🟢 → into **Dana**
- **Distribution — Dana (Manager)**
  - Pax — Pipeline Monitor 🟢 → into **Dana** (this is the already-built `pipeline-qa-monitor.md`)
  - Cody — Quota & Coverage Analyst 🟢 → into **Dana**
  - Penny — Post-Prep Assistant 🟡 → **on-call (Penny)**
- **Revenue — Marcus (Manager)**
  - Wendy — Whale Watch 🟡 → **Wendy** (kept)
  - Ed — Earnings Data Steward 🟢 → merged into **Fin**
  - Ivy — Invoicing Clerk 🟡 → merged into **Fin**
- **Intelligence — Nova (Lead)**
  - Bea — Inbox Triage 🟡 → into **Nova**
  - Nico — Inspo / Trend Scout 🟢 → **Nico** (kept separate)
  - Ana — Analytics Reporter 🟢 → into **Nova**
- **Gil** — Engineering & Reliability 🟢 → **Gil** (kept)

---

## 7. The manual-work map (scout findings — the evidence base)

Every place the admin currently acts by hand, by department. These are the chores the agents are designed to take over or assist with. File paths/lines are pointers (may drift). Tables in base `applLIT2t83plMqNx`.

**Talent & Onboarding** (→ Vivian)
- Start/resend onboarding links, view survey answers, offboard (modal). Offboarding cascade leaves **Apify removal + final invoice manual** (`app/admin/OffboardModal.js:109-113`).
- Upload creator docs → **manually click "Run Analysis"** → "Refine" feedback loop → "Accept & Save" (`app/admin/creators/page.js:2307`). Profile analysis is manual-trigger (status "Ready to Analyze" waits for the click).
- "Analyze Conversation" on whale chats → "Send to Chat Manager" (Telegram).
- Tables: Palm Creators `tbls2so6pHGbU4Uhh`, Onboarding Survey Responses `tblXfWKr3Nbf9j0Wb`, Creator Profile Documents `tblzRPH4149dUg0SL`, SM Setup Requests `tbleoXUtTGyJ22yti`.

**Content Production / Editing** (→ Theo)
- The admin **review queue**: watch RAW | EDIT | INSPO side-by-side, then **Approve** (auto-creates a Post) or **Request Revision** (write feedback + screenshots via frame-picker/crop → Telegram to editor). `app/admin/editor/page.js` ForReview ~1928-2324; revision modal ~1616-1807.
- **Editor performance signals (objective):** turnaround (`Completed At` − `Started At`), revision count (`Revision History` length), first-pass approval rate (`Admin Review Status='Approved'` with empty history), per `Submitted By Name`. *(Jordan/Theo grades these — NEVER aesthetics.)*
- Content Requests: creation is manual (via Airtable); **there is no "send" endpoint** — sending to creators is manual; overdue/incomplete tracking is manual.
- Tables: Tasks `tblXMh2UznOJMgxl6`, Assets `tblAPl8Pi5v1qmMNM`, Content Requests `tblr1QLpcyD7p5HRb`, Content Request Items `tblXsW7GsyZrplVkq`, Templates `tblpvD4cbs8KlbexQ`.

**Social Posting** (→ Dana)
- Post-Prep: write caption/hashtags, pick platforms, choose thumbnail (frame-picker / pool / photo lib), set scheduled date, save; "Send to Telegram"; send-back; discard. `app/admin/posts/page.js`.
- Grid Planner: drag posts onto IG/FB grids, distribute queue, "Send All" then **watch a drain loop for 30–90 min**. `components/GridPlanner.js`.
- Publer mapping: sync, map creator, tag Real/AI, set status, AI-consent link, save. `app/admin/publer/page.js`.
- **Weekly Reel Quota is NOT enforced or monitored anywhere** — pure manual eyeball in Airtable. **No account-coverage / pipeline-status dashboard exists.** (These gaps = Dana's core value.)
- Tables: Posts `tblTEaiscTQQkEvj2`, Publer Accounts `tblGDhVY73UT2gLSW`.

**AI Production Studio** (→ Dana/warmup, on-call Cleo/Rex)
- Recreate: ~50-min, 9-step manual orchestration (reel lookup, frame selection, prompt extract, creator select, identity swap [Wan], motion prompt, animation [Kling, ~$1.12–$4.20/clip], critique [Gemini], prompt override). `app/admin/recreate/page.js`.
- Carousel: per-batch / per-slide approve/reject. `app/admin/editor/CarouselSubmissionsReview.js`.
- Warmup Tasks: mark done daily (10–50 tasks), day-gated prerequisites, owner-approval gates. `app/admin/recreate-source/_warmup/`.
- Tables: Recreate Reels `tblgKIecr9rdn8M60`, Carousel Projects `tblU1yON9P7zQljYM`, AI Account Profile `tbloVP7ocqHpeK9mo`, Warmup Tasks `tblbj1dYPbS2o58sM`.

**Fan / Revenue / Billing** (→ Marcus: Wendy + Fin)
- Invoices: generate (cron + manual) → generate PDFs → **review/approve PDF** → preview email (test vs prod) → **send** (Resend or manual) → **mark paid** → populate-from-earnings → edit earnings inline. `app/admin/invoicing/`.
- **Biggest manual choke point: OF transaction CSVs are hand-exported from OnlyFans and pasted into Google Sheets** (OF has no API). Earnings coverage gaps tracked manually.
- Whale "going cold" = top-10% fan whose rolling-30 spend < 25% of peak → review → "Analyze Chat" (Claude) → "Send Alert" (Telegram PDF + brief to chat manager) → update Fan Tracker status → log effectiveness 30–60 days later.
- Tables: Fan Tracker `tblZLOSnP5z5uypWm`, Fan Analysis `tblNMtOEg2AIzvLDK`, Account Stats `tblLfdJiok8X7Yw1j`.

**Inspo / Inbox / Analytics** (→ Nova, Nico)
- Inbox: triage 10–50 tasks/day (Done/Snooze/Dismiss), edit wording, **dismiss-with-feedback trains the `extract-tasks` cron**, reply via Telegram (AI-draft or manual), "Extract Now". Triage which Telegram chats are watched. `app/admin/inbox/page.js`.
- Inspo: rate reels (👍/👎), save, pick sources, **grade 50–200 source reels**, import custom reels. Deep analysis runs in **external repo `jevweef/inspo-pipeline`**, not the website; the site's trigger is partly a stub.
- Dashboards (`app/admin/dashboard`): read revenue, runway, alerts (low runway, overdue invoices, revision backlog, OFTV ready-for-review).
- Tables: Inspiration `tblnQhATaMtpoYErb`, Inspo Sources `tblH0K1xMsBonqmMx`, Source Reels `tbl8oOEYRagarULgD`, Telegram Messages `tblz8x1gxPrHE6FUD`, Telegram Chats `tblSUmwkCg1opPFEL`, Inbox Tasks `tblsBAhyj4GmyFeO1`.

**The 10 existing crons (the "machines"):**
`mirror-cloudflare` (30m), `mirror-video-frames` (1h), `mirror-stream` (15m), `generate-invoices` (1st & 15th), `extract-tasks` (hourly window), `telegram-queue` (1m), `publer-queue` (1m), `publer-job-poll` (5m), `compress-pending-assets` (2m), `purge-inbox-messages` (daily). Registered in `vercel.json`.

> Note: `Roadmap & Automations` table `tbl0k3UErL1JRObHD` is a backend cache/state table for chart crons — NOT a human to-do list.

---

## 8. Feasibility tiers

- 🟢 **Tier 1 — build freely:** read-only monitors/analysts/draft-writers. Theo, Dana, Nico, Gil, plus the safe parts of others. ~60% of the org; most of the time savings; near-zero risk.
- 🟡 **Tier 2 — build with a leash:** drafts creator/fan/money-facing messages. Vivian, Nova, Marcus/Wendy/Fin, Penny, Cleo. Draft-and-approve only.
- 🔴 **Tier 3 — not yet:** Rex (vision + per-clip cost); auto-logging payments (needs bank/Stripe); warmup auto-execution (needs SM APIs + ToS risk). Agents assist/monitor; they don't drive.

---

## 9. Infrastructure prerequisite for "while you sleep"

A cloud routine runs in Anthropic's cloud with **no access to local env vars** and **only the claude.ai connectors Evan has authorized — currently just Google Calendar + Vercel** (NOT Airtable). So today a remote agent can't read the Posts table or Publer/OF keys.

Ways to give the staff their "key to the filing cabinet":
1. **(Recommended) Build a read-only "ops API" on the site** — one (or a few) endpoints, guarded by a bearer token, that run server-side where Airtable + all keys already live. Every agent calls it. Build once → the whole org runs on it. Bonus: it doubles as the data source for the Phase-3 monitoring dashboard already scoped in [[project-publer-ai-pipeline]].
2. Connect Airtable as a claude.ai connector (no app code, but can't reach Publer/OF keys server-side).
3. Run the team locally (full env + MCP) — fine for proving it out, not "while you sleep."
- **Exception:** Gil can run in the cloud right now (Vercel MCP is connected).

**Cost:** ~$2–6/day for the full agency running daily on Sonnet; phased start ~$1/day. A rounding error vs. the human coordinator being replaced.

---

## 10. Decisions locked

1. Refine the org on paper before building more agents.
2. Keep placeholder names (Maya, Vivian, Theo, Dana, Nova, Nico, Gil, Marcus, Wendy, Fin, Penny, Cleo, Rex) — rename anytime, it's one line per file.
3. Draft-and-approve for anything creator/fan/money-facing; never auto-send.
4. Crons = machines, agents = staff. Airtable = the office.
5. Architecture rule: split by context, not by chore (§3). Recommended size = lean ~10 (§5).

---

## 11. Open questions (resolve next)

1. **Human team / reporting lines** — who are Evan's actual people, and which departments should report to *them* instead of Evan? Hints from code: **Josh** is cc'd on invoices (money?); there's a **chat manager** (whales?); editors; an incoming **strategy hire**. This is the #1 thing to resolve — it turns "Evan's 10 robots" into a properly staffed agency.
2. **Missing departments** (not in the codebase — do they exist elsewhere, and want agents?): creator **recruiting / sales**; **content protection / compliance** (DMCA takedowns, leak monitoring, AI-likeness/TGP consent tracking); **chat / PPV monetization ops** (the actual DM revenue engine — in-house chatters? outsourced?).
3. **Final dial** — lean ~6 vs. recommended ~10.
4. **Comms channel** — SMS needs a Twilio-ish hookup; Telegram is lower-friction (agency already lives there).
5. **Which department to fully staff first** (recommended sequence in §12).
6. **Merge** — move these docs + agent files off the `worktree-pipeline-qa-monitor` branch into the main repo so they're permanent / visible in every session (pending Evan's OK; per memory, don't push to dev unprompted).

---

## 12. Recommended hiring sequence

1. **Foundation + Distribution** — Dana (absorbs the already-built Pipeline Monitor) + stand up Maya to deliver the first real daily briefing. Fastest path to seeing the whole loop work.
2. **Talent & Relations** — Vivian (the "reach out to creators" wins Evan asked for first).
3. **Revenue** — Marcus + Wendy + Fin (high dollar impact, Tier-2 leash).
4. **Intelligence** (Nova) + **Inspo** (Nico) + **Content** (Theo).
5. **On-call specialists** (Penny, Cleo) and finally **Rex** when vision tooling is ready.

Don't hire all at once. Stand up one department, watch a week of briefings, then expand.

---

## 13. How the teammates work together (collaboration map)

They are interconnected, but they do NOT ping each other ad-hoc. Collaboration happens two ways:
1. **Through Maya (the switchboard).** In the daily standup run, Maya takes one agent's finding and feeds it to another as input. That's the "walking to each other's desk," routed through the manager. E.g. Dana spots a coverage gap → Maya hands it to Vivian to draft the creator nudge.
2. **Through shared state in Airtable.** One agent writes a flag/field; another reads it on its next run. Async — like a sticky note on a colleague's desk.

Within a sub-team (only Revenue), the head delegates to its members in-run and reviews their work before reporting up — that's why Marcus's card shows Wendy + Fin. Everyone else is a solo department head, so there's no one "inside" their card; they *are* the whole department.

**Natural handoffs in the lean org (all funnelled through Maya):**
- Everyone → **Maya** (report up).
- **Theo** (content approved) → **Dana** (posts it, tracks coverage).
- **Dana** (coverage/quota gap) or **Theo** (pipeline empty) → **Vivian** (drafts the creator nudge).
- **Nova** (creator message in the inbox) → **Vivian** (relationship action).
- **Marcus/Wendy** (whale cold / earnings down) → **Vivian** (retention check-in).
- **Nico** (trend spotted) → **Theo/Dana** (content direction) + **Vivian** (pitch to the creator).
- **Gil** (a cron is down) → contextualizes **Dana's** pipeline gaps.

Not chaotic cross-chatter — Maya is the switchboard, Airtable is the shared desk.

## 14. How Evan sees and interacts with them (interaction & visibility)

**Reality:** today these agents run in the Claude environment, NOT inside the website. There is **no agent display on the site yet** — buildable, not built. Interaction surfaces, lowest build-effort first:
1. **The daily text briefing (Maya).** Passive — read the "what did everyone do" digest. Default for scheduled agents.
2. **A drafts / approval queue** — where draft-and-approve (Tier-2) output lands for yes/edit/no:
   - *No build:* drafts written into Airtable fields already in use (e.g. "Suggested Caption" on a Post, "Draft Outreach" on a Creator). Approve where you already work.
   - *Light build:* an "Agent Inbox" panel in admin with Approve / Edit / Reject.
3. **An "Agents" status panel on the site (most build)** — the live "office floor": each agent, last run, findings, pending items, on/off toggle. This is the "display of who's doing what" Evan pictured. Phase 2.

**On-call trigger mechanics (clarifying the earlier hand-wave):** an on-call specialist fires one of two ways —
- **Watcher (proactive):** runs on a schedule, watches for state (e.g. Posts needing a caption), pre-fills a draft. Invisible but convenient — the caption is just *there* when you open Post-Prep.
- **Button (on-demand):** a "✨ Draft" button in the relevant admin screen; click → spinner → output. Most obvious, you stay in control.

**"Will it be obvious when they're working?"** Button model: yes (you trigger it, watch it run). Scheduled/watcher model: no — you see the *result* (a briefing line, a pre-filled draft), not the work. Want visible activity → use buttons and/or build the status panel.

**Bottom line for v1:** no website UI needed to start. Scheduled agents text a briefing; draft agents drop drafts into fields/a queue you already check; you approve. The office-floor display is the phase-2 upgrade.

## 16. DEEP RESEARCH (2026-05-29) — CURRENT CANONICAL ORG

Six parallel research agents scoured the whole site (onboarding, content, distribution/AI, revenue, intel/inbox, sales/IT/meta). This section supersedes §5–§6.

### 16.1 The headline insight
**The website records everything but reminds the owner of nothing.** Across every department the finding was "reminder today? No." The teammate org's true purpose is a **remembering machine** that puts a prioritized to-do list on Evan's desk daily.

### 16.2 Two real onboarding BUGS found (not just gaps)
1. **`run-setup` is orphaned** — `lib/creatorSetup.js` / `POST /api/admin/onboarding/run-setup` creates a new creator's Dropbox folders, HQ account rows, file-request links, and SM Setup Request, but **no UI calls it**. Forgotten = creator has no folders/upload links.
2. **Default "Palm IG 1/2/3 / IG Main" rows in Creator Platform Directory are never created by any code**, yet the SMM go-live flow *requires* them and errors without them. Go-live is silently broken per creator until someone hand-creates the rows in Airtable.

### 16.3 Per-creator SETUP CHECKLIST (~48 items, bucketed)
Two Airtable bases: **HQ** `appL7c4Wtotpz07KS` (business/legal/credentials/invoicing) + **Ops** `applLIT2t83plMqNx` (content/AI/pipeline), linked by `HQ Record ID`.
- **Identity & legal (HQ):** name, AKA, birthday, location, timezone, contract signed + commission %. *(off-system: 2257/ID verification, model release)*
- **Accounts & creds (HQ):** OF/Fansly logins, social handles (TikTok/Twitter/Reddit/YT/OFTV), credential records.
- **Brand survey (60+ Q → Onboarding Survey Responses):** pricing (~12 price points), dos/don'ts, prohibited words, voice, pet-names — tagged A-team/B-team for the chat team.
- **Back-end provisioning (`run-setup` — ORPHANED):** Dropbox folder tree, 2 file requests, HQ account rows, SM Setup Request seed.
- **Social go-live:** default CPD "Palm IG" rows (BROKEN — never created), 3 IG usernames (SMM), **Telegram IG Topic ID + FB Topic ID on Palm Creators** (no UI; Grid Planner hard-errors without both), `Social Media Editing` toggle (unguarded go-live gate).
- **Content intelligence:** Creator Profile Documents → **Run Profile Analysis** (→ Profile Summary, Brand Voice, Dos/Donts, ~46 tag weights, embeddings) → content pillars, inspo handles, tag weights, **Weekly Reel Quota** (default differs: 5 vs 14!), Music DNA. *Most have NO writer in code = pure Airtable hand-entry.*
- **AI (if enabled):** AI ref images (front/back/face) + clone approval, Kling Element ID, AI Account Profile + warmup playbook + vault item IDs (IG/FB/Gmail/recovery).
- **Publishing:** Publer sync → map account → **AI Consent on File** (enforced for AI accounts, but free-text only).
- **Finance:** Revenue Account named `"{AKA} - {Type} OF"` (must match the Google-Sheet tab exactly), management start date, commission %, whale Telegram topic (**hardcoded in `lib/whaleAlertConfig.js`** — new creators get no whale alerts until code edit).

### 16.4 CURRENT ORG — fewer, fatter (Maya + 5, +1 recommended)
Reframe: a teammate is NOT a person with an 8-hr day; it's a tireless department head doing one full sweep and reporting what needs the owner. So roles can be fat; heavy "doing" tasks become on-call tools.

- **Maya — Chief of Staff.** Runs the standup, fact-checks all heads, sits atop the existing `extract-tasks` inbox engine, writes the ONE morning to-do text. Accountability layer.
- **Vivian — Creator Lifecycle.** Lead/sales pipeline → onboarding progress → full setup checklist (§16.3) → relations + quota + content-request chasing → retention/at-risk → offboarding. *(absorbs old Sales/Onboarding/Talent/Retention.)*
- **Theo — Content Operations.** Editor pipeline (QA, review queue, runway/buffer), AI studio oversight (recreate/carousel/warmup incl. Day-21 & Day-45 gates), posting cadence & coverage, failed-send watchdog, "what to post next" strategy. On-call tools: recreate co-pilot, caption drafter, carousel QA. *(absorbs old Production + AI Studio + Distribution + Pipeline Monitor/Pax.)*
- **Marcus — Revenue.** Invoice-cycle conductor (after the 1st/15th cron), earnings-upload + coverage-gap reminders, **whale/going-cold sweep across ALL creators** (today hardcoded to Laurel/Taby/MG/Sunny, page-load only — no cron), collections drafts, whale-alert effectiveness closer, fee/commission audit. Briefs Evan; Josh handles money questions. *(absorbs Whale + Earnings + Invoicing.)*
- **Nova — Intelligence.** Inspo scrape→promote→analysis watchdog (scrape freshness, the stuck `Ready for Analysis` backlog, the **external repo `jevweef/inspo-pipeline`** handoff), review-queue assistant, trend analysis. *(absorbs Inspo + Analytics; inbox-triage moved to Maya.)*
- **Gil — Reliability (IT).** 11 crons' health, the **iMessage daemon** (Mac+Cloudflare tunnel = silent SPOF), Publer/Telegram send failures, banned/shadowbanned accounts, scrape staleness, **auto-push-to-prod (`autopush.sh`) build failures** (every change ships to prod in ≤30 min, no gate). Fully automatable; can run in the cloud TODAY via the Vercel connector.
- **Sentinel — Compliance & Brand Protection (RECOMMENDED ADD).** Contracts/2257/AI-consent tracking (flag missing per creator) + DMCA/leak monitoring + takedown drafts. A real OF-agency department, 100% off-system today, legal exposure.

Outsourced / not-us (scope boundaries, confirmed): the **chat team** (ManageHer / "A Team") runs all OF DMs/PPV/sales — we detect/package/route/reconcile only, never chat. **Amin** runs the AI personas' phones (we instruct + approve, he executes). **Josh** = internal finance contact (cc on invoices). Freelance AI editors (Yassine) produce AI scenes.

### 16.5 Off-system departments (can't be teammate-owned until data exists)
Real agency functions with zero system footprint today — "build a little data, then hire a teammate": **creator payouts** (banking/payout destination not stored), **chat-team & editor staff management** (scheduling/QA/payroll — black boxes), **agency P&L / tool-cost dashboard** (Apify/OpenAI/Publer/Vercel spend invisible), **tax docs** (W-9/1099), **earnings ingestion automation** (OF CSV is hand-exported → Google Sheet; the master dependency with no reminder).

## 17. Artifacts (file index)

All currently on branch `worktree-pipeline-qa-monitor` (NOT merged):
- `docs/agent-org/PALM-MANAGEMENT-TEAMMATES.md` — **this doc** (canonical checkpoint).
- `docs/agent-org/ORG-CHART.md` — earlier org-chart draft (superseded by this doc; kept for history).
- `docs/agent-org/org-chart.html` — the styled visual org chart (open in a browser).
- `.claude/agents/chief-of-staff.md` — Maya's job description (built).
- `.claude/agents/pipeline-qa-monitor.md` — the Pipeline Monitor / "Pax", built + locally tested (found Publer dormant).

Related memory: [[project-publer-ai-pipeline]], [[reference-palm-codebase]], [[reference-inspo-pipeline-workflow]], [[feedback-communication-style]], [[feedback-localhost-not-dev]].
