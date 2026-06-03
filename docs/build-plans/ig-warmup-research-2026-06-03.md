# Instagram Warmup & Account Strategy — Research Report (2026-06-03)

> Source: 8-specialist deep-research workflow (`ig-warmup-research`, run wf_ea198d96-8f4).
> For OF-adjacent AI-content accounts on the Pixel/GrapheneOS + Mint SIM + Publer/Graph-API + Beacons stack.
> This report drives `lib/warmupPlaybook.js` (PLAYBOOK_VERSION 2). Numbers are vendor/crowd-derived,
> NOT Meta-published — treat as ceilings to stay under, and pilot before scaling the fleet.

## 1. Bottom line
Create accounts fresh on the per-persona Pixel/GrapheneOS/Mint stack — never buy — then warm each one for
**10–14 days of mostly-passive, human-on-device activity before any link or offer goes live**, ramping
engagement slowly and posting Reels (not follows) as the growth engine. The make-or-break window is the
**first 48–72 hours**: complete the profile, scroll, do almost nothing else. The real reach-killers are NOT
the mandatory AI label (Meta says it doesn't cut distribution) — they're suggestive visuals, banned
platform-words/links in public surfaces, and bot-like posting/engagement velocity. Keep every visible
surface SFW enough that "it would also work for a fitness coach," nest the OF link one hop deep in Beacons,
and let Publer post on a jittered human cadence.

## 2. Buy vs. create — verdict
**CREATE FRESH. Do not buy.** Unambiguous for this model.
**Decision rule:** if the account must (a) survive long-term AND (b) operate OF-adjacent → create fresh.
There is no buy scenario that satisfies both. Why buying fails here:
- Throws away the biggest asset: a clean per-persona device fingerprint born on your Pixel. Meta fingerprints
  mobile devices ~98–99% from hardware alone, linked across FB/IG/WhatsApp, persistent across reinstalls.
  Logging a bought account into your Pixel = the exact new-device+new-IP+behavior-change "sold account" signature.
- Inherit invisible strikes: one prior OF-adjacent violation can leave an account permanently non-recommendable;
  no way to audit the ledger pre-purchase.
- "Aged = trusted" is a 2026 myth — behavioral flags ignore age; fake-birthdate aged inventory gets wiped by
  age-verification crackdowns, which OF-adjacent accounts draw.
- Dominant scam is unfixable: seller keeps the original creation email and reclaims later. Escrow only protects
  from the seller, not from the platform-side transfer ban.

If you ignore this and buy anyway (reduces *scam* risk only, NOT ban risk): demand the **original creation email**
transfer; log in only from the final Pixel/IP from the first login; immediately change password+email+recovery,
remove seller's phone/2FA; press "This was me." The contradiction: logging in from your device IS the #1
transfer-detection trigger — no timing trick hides an ownership change.

## 3. Day-by-day warmup (Day 0 → 90)
Run every number at the LOW end (OF-adjacent = higher scrutiny). All engagement is **manual, in-app, on the
persona's own Pixel** — the Graph API has no like/follow/comment, so there's no automation to flag during warmup.

**Phase 1 — Setup & observation (Days 0–2) · make-or-break window**
- Day 0: sign up on **mobile data (4G/5G), not Wi-Fi**, using the **real Mint SIM** (not VOIP) + permanent
  secondary email. Profile photo + clean bio (no banned words, **no link**). 1–2 SFW Highlights covers. Stay
  **Personal**. Scroll ~15 min. Follows 0–5, likes 0–10, comments 0, DMs 0, posts none.
- Day 1: profile polish, scroll ~15 min passive. ~5 follows, 10–20 likes, 0–3 comments.
- Day 2: watch ~10 Stories. 5–10 follows, 10–20 likes, 3–5 comments.
- Hard don'ts: no VPN/proxy/IP change, no link, no Business switch, no automation, no burst actions.
- Conflict resolved: "fast" guides post Day 1; "safe" guides demand 7 consume-only days. Hybrid conservative =
  profile complete Day 0–1, **no posting until ~Day 3**. Aggressive/automated action in first 72h → reported
  80%+ ban-within-30-days.

**Phase 2 — First content (Days 3–7)**
- Day 3: **first feed post** (neutral/lifestyle, SFW, no link, 1–3 hashtags). 5–10 follows, 10–15 likes, 1–3 comments.
- Day 4: **first Story** + optional 2nd post. 5–10 follows, ~15 likes, 3 comments.
- Day 5–6: **first Reel** (neutral, no CTA/link). 1–2 Stories/day. 5–10 follows, 15–20 likes, 3–5 comments.
- Day 7: **assessment / reach gate** — post a creative close to your real offer but WITHOUT a link, watch reach.
  Go/no-go: normal non-follower reach → proceed to link; suppressed → +3–5 neutral days, re-test.

**Phase 3 — Go live: link, Business, Publer (Days 8–14)**
- Day 8–10: **switch to Business + link a FB Page** (Graph API publishing needs Business; Creator can't publish via
  API). **Add the Beacons link** (earliest Day 8; OF-adjacent → hold to Day 10). Begin Publer at **50% cadence**.
- Day 11–14: 1 Reel/day (jittered), 1–2 Stories/day, soft CTA in content.
- The link is the single most-cited instant-shadowban trigger ("new account + link day one = ban"). Never the raw
  `onlyfans.com` URL or the word "OnlyFans" in bio — machine-scanned. Beacons (age-gate, allows OF); AllMyLinks
  backup; **avoid Linktree** (2026 reports: bans adult creators). Don't swap the bio link frequently.

**Phase 4 — Ramp (Days 15–28):** Days 15–21: 3 feed + 1–2 Reels/week, daily Stories, ~30 follows/~100 likes/~20
comments per day, Publer 50%. Days 22–28: 3–4 feed + 2 Reels/week, 2 Stories/day, 30–50 follows, Publer 50→70%.

**Phase 5 — Steady state (Days 30–90):** ~**2 Reels/week + 3–5 feed/week + 1–3 Stories/day** (Mosseri heuristic).
Ceilings: ≤2 feed/day, ≤1 Reel/day, space posts by hours (never burst a Publer backlog). Follows 30–50/day
(credibility signal, not a growth lever; Reels drive ~2× non-follower reach). Never run follow/unfollow churn.
Best times (audience-local): OF-leaning → 7–11pm local; verify against the account's own Insights. No hard
Day-60/90 number — maintain consistency, scale slowly, watch non-follower reach as the health signal.
**Multi-account rule (load-bearing): never post the same Reel/photo or run identical action scripts across
personas — duplicate content across accounts is itself a ban pattern.**

## 4. Hard limits cheat-sheet (ceilings, not targets; OF-adjacent → new-account floor)
| Action | New (0–3 mo)/day | New/hour | Warmed (6–8 wk+)/day |
|---|---|---|---|
| Follows | 10–30 (start 5–10) | ≤5/hr | 100–150 (max ~200) |
| Likes | 50–100 (ceiling ~250) | 15–25/hr | 500–1,000 |
| Comments | 20–30 | 3–5/hr | 100–150 |
| DMs | 10–20 (warm replies only) | 2–4/hr | 50–100 |
| Feed posts | first ~Day 3–5; then 1–2/day | space by hrs | 3–5/week |
| Reels | first ~Day 5–7; ≤1/day | — | 2–4/week |
| Stories | 1–3/day | — | up to ~10/day |

- **Pacing beats totals** — 30 follows in 5 min flags even under the daily cap. Randomize intervals.
- **Hashtags: HARD CAP of 5** per post (since mid-Dec 2025, down from 30). Use 3–5 niche tags, rotate sets,
  never reuse one block. Over-tagging is useless and a spam flag.
- Hard caps: 7,500 lifetime follows; ~500 total actions/24h; Graph API ~25–50 posts/24h, ~200 req/hr.
- DMs: never cold-blast; identical text to 25+/hr or 2+ links in a DM = hard spam trigger; never put OF/Beacons
  links in DMs. Action block on overage: 24–48h.

## 5. Shadowban avoidance + recovery
For OF-adjacent, "shadowban" is mostly recommendation-suppression — you can be 100% compliant yet permanently
"not eligible to be recommended" on niche/visual signals alone. Grow via Reels/saves/shares/DMs, not Explore.
- DO: keep every visible surface SFW ("works for a fitness coach"); nest OF link one hop in Beacons; keep CTA off
  the IG bio text; post like a slow human; jitter Publer; self-label all AI (Meta: label does NOT cut distribution;
  undisclosed-but-detected AI is the real ~80% downrank); check Settings → Account Status; detect suppression by
  searching your username + a niche tag from a non-following account.
- DON'T: put "OnlyFans"/"OF"+subscribe/link, "DM for price", "PPV", "NSFW", "18+"+CTA, "nudes/feet/explicit", or
  suggestive emoji in captions/bio (safer: "exclusive content", "VIP page", "members only", "link in bio"); add the
  link in week 1 or swap it often; burst-publish; run any auto-like/follow/comment/DM bot (#1 true-shadowban
  trigger); log into Business with the raw password from random IPs.
- Recovery: delete flagged content/tags → **48–72h complete silence** → check Account Status → file ONE appeal
  (describe the symptom, don't say "shadowban") → resume with one clean SFW post, watch reach 48h, rebuild
  gradually. Typical clear: mild 3–7 days, moderate 2–3 weeks, severe 1 month+. Dead account → wait 30 days, fresh
  email/phone/identity, never reuse a near-identical username.

## 6. Myths to ignore
- "Aged accounts are safer" — false in 2026 (behavioral flags ignore age; aged carries invisible strikes).
- "A safe transfer avoids the ban" — only reduces seller-scam risk; your login IS the transfer trigger.
- "You need 1,000 followers / Business to add a bio link" — outdated; every account gets ≥1 link slot (the 1k gate
  is for going Live).
- "Use 30 hashtags" — dead; 5 is a hard cap and hashtags barely drive reach.
- "The AI label tanks reach, hide it" — Meta says no distribution effect; hiding is the actual penalty path (and
  violates EU law from Aug 2026).
- "28 days of zero posting required" — that's anti-detection advice for automation farms; 10–14 days is enough here.
- "API posts, so engagement can be automated too" — Graph API has no like/follow/cold-DM endpoints; tools claiming
  it use the private API, exactly what gets OF-adjacent accounts banned.

## 7. Open questions — verify with a 2–3 persona pilot
1. Exact safe daily limits (vendor-derived; pilot whether OF-adjacent needs even lower). *(med)*
2. Day-7 reach gate as a true survival predictor. *(med)*
3. AI-label engagement effect (Meta: no algorithmic penalty; 3rd-party claims 15–80% lower from user behavior). *(med, disputed)*
4. Beacons/AllMyLinks current TOS vs Linktree. *(med)*
5. Optimal consume-only length (1 vs 7 days — biggest disagreement). *(med/high)*
6. Best posting times — lock to each account's Insights after ~2 weeks. *(audience-specific)*
7. Exact Mosseri cadence ("2 Reels + 3–5 feed/week" widely repeated, not primary-sourced). *(med)*
