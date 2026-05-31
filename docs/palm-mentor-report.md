# Palm — Mentor Report (2026-05-31)

**One-paragraph verdict:** Palm has built a genuinely rare top-of-funnel: a data-driven inspo→film→edit→post content engine (§1) and a hardware-isolated AI-persona warmup system (§3/§4) that most agencies in this space simply do not have. That is real moat. But Palm is excellent at *getting attention* and weak at *converting and keeping the money* — the entire back half of the value chain (pricing/commission model §7, retention/churn §9, traffic-to-conversion strategy §5/§8, and a systematized acquisition machine §6) is undocumented or ad-hoc, and the business still runs through two people's heads (§10). The single biggest opportunity right now is to stop treating commission as a number you set on a call and start treating monetization economics — pricing model, fan-tiering, LTV — as a designed system, because that is where the top operators make 3–5x more from the *same* traffic Palm is already generating. The good news: almost every fix below is "extend a system Palm already has," not "build from zero."

---

## The 5 things to fix first (ranked by impact)

### 1. Replace the flat commission % with a tiered pricing/deal model — and write down a PPV pricing ladder

**The gap.** Palm sets a single commission % per creator at onboarding and auto-invoices weekly (§7), but has **no documented pricing or deal model** — no tiers, no upfront fee, no PPV pricing ladder. The baseline doc itself flags this as Palm's #1 unwritten gap, and it's the single biggest creator concern in Palm's own market research. Better operators flex the deal to the creator's tier (medium consensus, DylanOFM + King Sam OFM) and sell through an *escalating PPV price ladder*, not one flat ask (medium consensus, Luca Pritchard + Markuss Hussle).

**Why it matters.** A flat 50/50 (or whatever single number) loses money at both ends. On a beginner you carry all the setup cost with no floor; on a whale-tier creator a high rev-share is uncompetitive and you lose the signing. DylanOFM structures it so the agency is profitable from month one: beginners on a paid/productized model (not 50/50), mid-tier (10–50k/mo) on 50/50 **plus an upfront setup fee**, whales (100k+/mo) on a *lower* rev-share **plus a fixed retainer** (e.g. 20k/mo + 50% of upside above current revenue). Separately, the PPV ladder is where per-fan revenue is actually made: Markuss Hussle's documented ladder runs roughly $10–15 → $35 → $70 → $140 → $200, sending free teasers between paid stages to over-deliver. With chatting outsourced, Palm currently has *zero* control over whether its creators' fans are being walked up a ladder or hit with one flat ask — that's revenue leaking straight out of the funnel Palm built.

**What to change.**
- Write a one-page Palm deal matrix: beginner / mid-tier / established, each with its split, upfront fee, and (for whales) retainer. Make it the default at onboarding instead of an improvised number.
- Document a default PPV ladder ($10–15 → $35 → $70 → $140 → $200 with free-content-between-stages) and hand it to the outsourced chatting vendor *now* as a required playbook — you don't have to run chat in-house to mandate the pricing structure your vendor sells at.
- Add a "free trial / $3.99 floor sub + monetize-in-DM" entry model (medium consensus, Ai Pimpin + Luca Pritchard, f0021) as the standard funnel framing.

**Proof.** DylanOFM, King Sam OFM (tiered deals): https://www.youtube.com/watch?v=o4s_nKjm2fw&t=1055s and https://www.youtube.com/watch?v=KilBfcIbXqU&t=498s. Markuss Hussle (PPV ladder): https://www.youtube.com/watch?v=T2LJ9cMoMEU&t=155s.

---

### 2. Turn the Fan Tracker into an operating playbook: tier fans and exclude whales from mass-blasts

**The gap.** Palm already *collects* the right data — Fan Tracker CRM, whale-hunting, going-cold detection (§9 PARTIAL) — but there's no in-house SOP that *acts* on it, because chatting is outsourced (§8). This is the highest-consensus monetization tactic in the entire dataset: **segment/tag fans by spender tier and personalize instead of mass-blasting** (high consensus — Ai Pimpin, Luca Pritchard, habibi all independently confirm), reinforced by the escalating-whale-nurture finding (medium consensus, f0009).

**Why it matters.** This is the difference between a page that earns linearly and one where the top 5 fans carry it. Luca Pritchard's documented numbers: tier fans on a smart list, anyone over ~$1,500 gets **zero** mass messages — only 1:1; spenders over $500 first night get a personalized voice note; over $2,500/mo gets a short personalized selfie video. One client made **$56,500 in 30 days from her top 5 fans**. Mass-blasting whales is the cardinal sin — it tells your biggest spender he's one of a crowd and burns the parasocial bond that justifies his spend. Palm has the whale data sitting in Airtable and is currently doing nothing structural with it.

**What to change.**
- Define a 4-type fan taxonomy (transactional / lover / whale / time-waster) as fields in Fan Tracker, fed from existing whale-hunting data — buildable today, no in-house chat required.
- Write the exclusion rule into the vendor contract: whales above a $ threshold are removed from all mass-PPV lists and handled 1:1 with personalized voice/video.
- Stand up the whale-nurture escalations (nickname use, voice note >$500/night, selfie video >$2,500/mo) as a documented sequence the vendor must follow — and bank it as the spec for the in-house/AI chat build.

**Proof.** Ai Pimpin / Luca / habibi (fan-tiering, high consensus): https://www.youtube.com/watch?v=H4n9rR1-ql0&t=568s and https://www.youtube.com/watch?v=JXLdjNmHL-8&t=92s. Luca (whale nurture, $56.5k/30 days from 5 fans): https://www.youtube.com/watch?v=T2LJ9cMoMEU&t=280s.

---

### 3. Systematize creator acquisition — committed daily volume, a fit scorecard, and a simple funnel

**The gap.** Acquisition is Josh-DM-led, ad-hoc, untracked (§6 THIN) — no daily quota, no multi-account structure, no fit scorecard, no funnel. Better operators run cold outreach as a **high-volume, tracked system** (medium consensus, DylanOFM + King Sam OFM) and **qualify against an ideal-client profile** (medium consensus, King Sam OFM + Markuss Hussle).

**Why it matters.** "Some DMs when Josh has time" is not a pipeline — it's a founder bottleneck disguised as a growth strategy. DylanOFM built a **$500k/mo agency on cold outreach before running a single ad**, on a documented commitment of **100 personalized DMs/day for 100 days** (25/account across 4 accounts), value-first voice/video openers, qualifying *in conversation* (10–30% qualify). The scorecard matters as much as the volume: signing for availability instead of fit is how you fill the roster with creators who churn in month two. Markuss Hussle's red-flag screen (under 3–4 months on OF, about to travel/move/have a baby, recent breakup, churned through 5+ agencies, know-it-all, takes weeks to sign) is a churn-prevention filter applied *before* you spend onboarding effort.

**What to change.**
- Set a committed daily DM quota across multiple accounts and **track it** (DMs sent → replies → calls booked → signed) — KPIs Palm currently doesn't keep.
- Adopt a written signing-call SOP (medium consensus, f0002): human-first rapport, then qualify on work-ethic/cadence non-negotiables, and *walk away* on misfit.
- Add Markuss Hussle's ideal-client checklist + red-flag screen to the onboarding wizard as a gate.
- Build one lead magnet + a 5-minute VSL (f0033) runnable on organic traffic — no ad spend — to convert outbound and inbound into pre-qualified booked calls.

**Proof.** DylanOFM (100 DMs/day → $500k/mo): https://www.youtube.com/watch?v=o4s_nKjm2fw&t=187s. Markuss Hussle (ideal client + red flags): https://www.youtube.com/watch?v=WRe_1foPug4&t=92s.

---

### 4. Get off the founders' heads: install an ownership ladder and revenue-gated org structure

**The gap.** Palm runs through Josh (acquisition/strategy) and Evan (everything technical/ops), with no org chart, no hiring scorecards, no ownership model (§10 THIN). Better operators **delegate outcomes up an accountability ladder** (medium consensus, DylanOFM + Markuss Hussle) and **split the agency into departments under managers on a revenue-gated hiring ladder** (medium consensus, GriffinOFM + Markuss Hussle).

**Why it matters.** Every gap in this report ultimately traces back here: pricing isn't written down, fans aren't tiered, acquisition isn't tracked — because the two people who could build those systems are the same two people running daily ops. GriffinOFM's five-level accountability dial (1 = wait to be told … 5 = solve it *and* build the SOP so it never recurs) names the problem precisely: most teams sit at level 1–2, which makes the owner the bottleneck by design. His example of a level-4/5 acquisition manager who independently bought aged IG accounts and hired a VA, then *just reported it*, is exactly the leverage Palm doesn't have yet. This also directly feeds Palm's own teammate-org initiative.

**What to change.**
- Name an owner for each function (acquisition, content, chat/monetization, ops) even if some are still Josh or Evan today — ownership before headcount.
- Install a decision filter: nobody escalates a problem without bullets + 2–3 options + a recommendation (f0010). This alone reclaims founder hours immediately.
- Master-then-document-then-delegate (medium consensus, f0025/f0042): write an SOP + Loom for each role before backfilling it; hire for coachability over experience.
- Adopt Mon–Fri short morning calls with department heads only, and use the "30-day disappear test" to find where the business breaks without the founders.

**Proof.** GriffinOFM (5-level ladder, departmental structure): https://www.youtube.com/watch?v=fURK_IrKfz4&t=434s. DylanOFM/Markuss Hussle (ownership ladder, decision filter): https://www.youtube.com/watch?v=fMV9M9Ldylo&t=992s.

---

### 5. Document a per-creator traffic mix graded on conversion — and codify real-creator account safety

**The gap.** Distribution today is Publer + Telegram-to-Amin posting (§5 PARTIAL); there's **no documented traffic strategy** across channels (§5/§8 GAP), and real-creator account warmup/link-safety is unformalized (§4 THIN — Palm's mature warmup is AI-only). Better operators run a **multi-platform traffic mix graded by conversion quality, not views** (medium consensus, Ai Pimpin + Markuss Hussle) and **warm new accounts behind a neutral landing page before any direct OF link** (medium consensus, Ai Pimpin + GriffinOFM).

**Why it matters.** Palm's content engine is optimized to win *views* — but "28.5M views ≠ money" (Ai Pimpin). Without per-channel conversion grading, Palm risks pouring its excellent content into low-quality traffic (X drives volume but weak subs; IG drives the highest-quality subs). And the link-safety gap is an existential risk to the asset Palm spends the most building: a reported *direct* OF/Fanvue link can trigger strikes/bans, so the rule is always route through a neutral landing page (e.g. Get All My Links) and delay the bio link 2–4 weeks while the account builds trust. Palm already enforces exactly this discipline for AI accounts (§4 Day-21 handoff, Day-45 CTA gate) — the real-creator side just hasn't inherited it.

**What to change.**
- Define a documented per-creator channel mix (IG primary, Threads + X secondary, TikTok/Snapchat optional) with **per-channel conversion grading** so spend follows sub quality, not view counts.
- Port the AI warmup gates to real-creator accounts: neutral landing page only, delayed bio link, no rapid-burst follows/automation (f0012/f0035) — clone a system you already run well.
- Consider an owned Telegram/email broadcast channel as a ban-resilient backup (f0024), and pilot Reddit (free subs ~$0.25–$1 returning $4–$8, f0026) as a high-ROI manual channel.

**Proof.** Ai Pimpin/Markuss Hussle (quality-over-views mix): https://www.youtube.com/watch?v=FNvgwCKOco8&t=371s. Ai Pimpin/GriffinOFM (warm + landing-page-only links): https://www.youtube.com/watch?v=gRwy2rxtWQc&t=372s.

---

## Strengths to protect

- **The data-driven content engine (§1) is genuinely ahead of the field.** When competitors describe content selection they describe *ad-hoc/manual* choice; Palm decides what to film from scored viral data through an 8-step productized pipeline. Don't dilute this — *extend* it. The one addition worth making is an explicit per-creator niche/positioning + creator-strengths step (high consensus, f0001/f0037: a defined niche separates earners), so promoted ideas are filtered for fit and replicability, not just virality.
- **Hardware-isolated AI-persona warmup (§3/§4) is a moat, not a science project.** The 90-day cadence, per-persona device/SIM isolation, vault-stored creds, and staged link/CTA gates are exactly the discipline gurus *tell people to build and most never do*. Protect it — and harvest it: the real-creator side should inherit these same safety gates (see fix #5).
- **The AI-persona scaling lever (§0/§3) is a structural advantage almost no real-creator agency has.** It's also the bridge to the single highest-upside future move (see watch list).

---

## Watch list / build-toward (prepare, don't act yet)

- **Real-creator AI cloning (high consensus, f0003 — Ai Pimpin, GriffinOFM, King Sam OFM).** This is the standout future lever and a *direct* extension of Palm's existing recreation pipeline (§3): take 20–30 photos of a cooperative signed creator, train an AI likeness, post a real+AI social mix to her existing funnel — keeping **100% of the OF vault content real** (nothing AI sold past the wall). One model films 35–40 videos/week; AI fills the other 40–45, enabling 4+ accounts of output from one creator. Timing: pilot *after* fixes #1–#2 are in place, because cloning multiplies traffic — and multiplying traffic into a leaky monetization funnel just multiplies waste. https://www.youtube.com/watch?v=JuJ9T7AEfSc&t=404s
- **In-house / AI chatting as a hybrid (medium consensus, f0016 — King Sam OFM, Markuss Hussle).** The target architecture is clear and matches Palm's stated roadmap: **AI handles new-sub volume and sorts spenders from time-wasters; humans own small VIP lists (~20 fans) for whale retention**, with unlock-rate as a tracked KPI (operators report ~70–80%). Build-toward: every fan-tiering, pre-sale-funnel, and PPV-ladder finding (f0004–f0006, f0009, f0032, f0040) is the SOP/training spec for this. Don't rush bringing chat in-house, but *start banking the playbook now* and mandate as much of it as possible with the current vendor — that's free conversion lift today and a head start on the build. https://www.youtube.com/watch?v=T4M3pAjLJp0&t=184s
- **A vault-as-inventory refresh cadence (medium consensus, f0015).** When OF-vault/PPV (§2 THIN) gets systematized, run it as inventory: weekly script adds, fresh teasers, prune what causes unsubs, price-test. Tee it up alongside the in-house chat build.

---

## How to read this

Confidence = how many independent top operators agree (high = 3+, medium = 2, low = 1); every claim traces to a real video — click any timestamped link to hear the operator say it. Fixes are ranked by impact on Palm's specific gaps, and weighted toward high/medium-consensus tactics because those are the safest bets multiple successful operators confirm independently.
