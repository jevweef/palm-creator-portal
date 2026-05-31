# How Palm Operates — OFM Agency Baseline

> **Purpose.** The **comparison lens** for the OFM Research knowledge base. When the research
> agent analyzes how *other* agencies operate, it compares against THIS to answer: "what are they
> doing that we aren't, and should we change?" Accuracy here governs the quality of every "vs. us".
>
> **Status:** Living doc. Rewritten 2026-05-30 from a deep codebase pass (see
> `docs/build-plans/ofm-research/MASTER-PLAN.md`). Each department tagged **maturity**:
> MATURE / PARTIAL / THIN / OUTSOURCED / ABSENT. Sections marked **🔲 GAP** have no internal
> baseline — the agent must NOT invent a Palm position; flag and capture what competitors do.
>
> **Applicability note for the agent.** Palm currently serves **REAL creators on OnlyFans**. A
> big wave of **AI creators** ("girls that don't exist") exists in the OFM space — they can't use
> OnlyFans (they use Fanvue etc.). Palm is NOT doing AI creators yet but wants the playbook for
> later. So tag each competitor finding: **real-creator / AI-only / both**. Where AI-OFM tactics
> overlap with real-creator work (Palm already makes AI *social content* for some real creators;
> plus IG warmup, Reddit, traffic, chatting), treat the overlap as **high-confidence** signal.

---

## 0. What Palm is (the model)

Dual-stream creator-management agency in the OnlyFans-adjacent space:
- **Real creators** — real women; Palm runs social presence (IG/TikTok), content production, and
  (outsourced) DM monetization. Revenue split with creator. **This is the current core business.**
- **AI personas** — synthetic creators (Amelia, Katie Rosie, Brielle) built via Palm's recreation
  pipeline; same social funnel. A structural scaling lever most agencies lack.

**Funnel:** social presence → OnlyFans sub → DM monetization.
**Tech spine:** Next.js admin portal (Vercel) · Airtable (HQ `appL7c4Wtotpz07KS` + Content Ops
`applLIT2t83plMqNx`) · Clerk auth · Cloudflare media · Publer scheduling · Telegram coordination.

---

## 1. Content production — SOCIAL (top-of-funnel) — **MATURE**

Palm's strongest, best-documented system: an **8-step inspo-driven pipeline** that decides *what
creators should film* from viral data, not guesswork (`pipeline/CLAUDE.md`):

1. **Scrape** — Apify pulls Reels from inspo IG accounts → `Inspo Sources`
2. **Queue** → `Inspiration` (status New)
3. **Analyze** — GitHub Actions AI vision (transcript, visual breakdown, hook, viral score)
4. **Review** — best reels surface in inspo review UI
5. **Promote** — admin promotes a reel to a creator's board as a filming idea
6. **Film** — creator films their version
7. **Upload** → becomes `Asset` + editing `Task`
8. **Edit** → approval → schedule → post

Editor workflow: day-counter task queue, 2 slots/day per creator (`app/admin/editor/`):
submissions → library → grid planner → carousels → OFTV → post prep → revisions.
Tables: `Inspiration`, `Source Reels`, `Inspo Sources`, `Assets`, `Tasks`, `Posts`.

**Strength to weigh competitors against:** data-driven, productized content *ideation*. When a
competitor describes ad-hoc/manual content choice, Palm is ahead here.
**🔲 GAP (partial):** real-creator posting *cadence* (frequency, time-of-day) not codified.

---

## 2. Content production — OF VAULT / PPV — **THIN**

No system for the explicit content sold on the OF page itself (distinct from social). OFTV
long-form has a separate submission/approval workflow (`app/admin/.../oftv-projects/`) but it's
decoupled from the social pipeline. When a competitor describes a "content system," first classify
**social (type 1)** vs **OF vault/PPV (type 2)** — Palm is strong on 1, thin on 2.

---

## 3. AI personas / synthetic creators — **MATURE**

Hardware-isolated synthetic-creator program (`docs/build-plans/publer-ai-account-creation-playbook.md`):
GrapheneOS Pixel (1 profile/persona), 1 SIM/persona, dedicated aged Gmail, vault-stored creds
(never plaintext), Beacons link-in-bio, Publer publishing. EU AI Act compliance (AI label +
watermark). Tables: `AI Account Profile`, `Warmup Tasks`, `Pixel Devices`, `SIM Inventory`.
**Note:** these personas still funnel to OnlyFans via social — distinct from the AI-creator/Fanvue
model that AI-OFM gurus teach. Competitor AI-creator content = build-toward for a future Palm line.

---

## 4. Account warming & social setup — **MATURE (AI) / THIN (real)**

90-day warmup cadence for AI accounts, fully specified (Days 1–7 profile+1–2 posts; 8–14 add
stories+bio link day 10; 15–21 reels/carousels+DMs; 22–30 sustainable+soft OF promo; 31–90
monetize). Day-21 Publer handoff; Day-45 OF-CTA approval gate. Operator UI: Today view, per-account
tabs, playbook editor (`app/admin/account-warmup/`, `batch-2-warmup-flow.md`).
**🔲 GAP:** real-creator warmup/cadence not formalized.

---

## 5. Posting / scheduling / distribution — **PARTIAL (Phase 3 in-flight)**

Publer (Phases 1–2 live; Phase 3 = jitter, caption/hashtag rotation, monitoring, alerts — in
batch-5). Telegram routing to **Amin** (contractor) for manual posting, per-account topics, ET+IST
times, `/posted` compliance webhook. `Pipeline Target` field routes Publer vs Telegram.
**🔲 GAP:** traffic/distribution *strategy* (Reddit, paid, mass-DM, S4S) — not documented.

---

## 6. Creator acquisition / onboarding — **THIN**

Acquisition is **Josh-DM-led** (outbound DMs + referrals; 75-convo market research). Onboarding =
form wizard (name, email, commission %, state, contract, voice memo; Puppeteer contract PDF) →
`Creators` table. Status: not started → link sent → in progress → completed.
**🔲 GAP:** no systematic acquisition machine (paid, affiliate, content, referral program).
Competitor cold-outreach/signing systems are high-value here.

---

## 7. Pricing / commission / invoicing — **THIN**

Commission % set per-creator at onboarding; weekly invoices auto-computed (multi-account combining,
PDF via Puppeteer, Dropbox, Resend email) — `app/admin/invoicing/`, `Creator Invoices Weekly`.
**🔲 GAP — no documented pricing/commission *model*** (split rationale, tiers, PPV pricing). This is
the #1 creator concern in our own research yet our position isn't written down. Competitor PPV
pricing ladders / tip menus / anchoring = pure learn-from-others.

---

## 8. Chatting / DM monetization — **OUTSOURCED**

DM monetization (drives most OF revenue) is **subbed to an external chatting team** today. Palm does
not run chatters in-house; no internal SOP/scripts/fan-tiering. **Deliberate current state.**
Roadmap: **in-house chat team (~1yr out)** + **AI chatting (active project)**.
**Agent treatment:** do NOT say "no baseline." Capture competitor chatting tactics (funnels,
scripts, fan tiers, PPV sequencing, objection handling) as **build-toward intelligence** for those
two roadmap projects. Very high volume of competitor content here.

---

## 9. Fan intelligence / retention — **PARTIAL**

Whale-hunting (`app/admin/whale-hunting/`, Palm Internal + Chat Team Report tabs), Fan Tracker CRM,
going-cold detection, per-fan analysis. Data collection live; leadership reporting in-flight.
**🔲 GAP:** no written retention/churn/win-back strategy or QBR cadence.

---

## 10. Team / org / staffing — **THIN**

Josh (CEO, acquisition, strategy) · Evan (tech/product/ops, super_admin) · Amin (contractor, manual
posting) · editors · external chat team. Clerk roles: super_admin, admin, editor, ai_editor,
chat_manager, creator.
**🔲 GAP:** no org chart, hiring criteria/scorecards, comp bands, scaling plan.

---

## 11. Current initiative — SMM hub redesign — **IN-FLIGHT**

Consolidating SMM admin into `/admin/social` (Overview / Content / Accounts & Setup / Outbound),
Real/AI strictly separated, one design language, filterable. Phases 1–7 built; QA + merge pending.
`docs/build-plans/smm-consolidation/HUB-REDESIGN-SPEC.md`. Palm is actively systematizing SMM now,
so "how to structure SMM" findings are timely.

---

## How the agent uses this doc

Per competitor claim → matching section above:
- **Documented section** → compare directly: "They do X; we do Y (§N); recommend Z."
- **🔲 GAP** → don't fabricate a Palm position; say "no internal baseline yet (§N)", capture what
  they do, mark gap to fill.
- **OUTSOURCED (§8)** → frame as build-toward for in-house/AI chat roadmap.

Tag every finding **real-creator / AI-only / both** and weight overlap as high-confidence.
Palm strengths (don't undersell): AI-persona scaling lever (§0/§3), data-driven content engine
(§1), hardware-isolated warmup (§3/§4). Biggest learn-from-others gaps: acquisition system (§6),
pricing (§7), chatting (§8, build-toward), retention (§9), traffic (§5/§8).
