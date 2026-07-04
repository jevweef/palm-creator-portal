# Fan Intelligence System — Master Design

_Started 2026-07-04 after the Chris (@mrgnar1979) deep-dive. Goal: an AI-powered agency
backend that reads each fan's messages + buying history, understands what makes THAT fan
engage and buy, and hands chatters a tiny card that tells them exactly how to work him._

## The core insight

Every fan has a different **engagement trigger** — the thing that turns him from lurker to
buyer. The trigger is discoverable from his chat log + purchase timing. Long analyses are
for us; chatters get a **card** (~8 lines). The system's job: conversation + transactions
in → card out, automatically, kept current by the incremental chat pulls.

## Per-fan profile (the "simple data")

The structured record the system maintains per fan (feeds the chatter card, the analysis,
and eventually automation):

| Field | Example (Chris) |
|---|---|
| Identity | Chris @mrgnar1979 · calls her "Queen" · HP fan, climber, Talking Heads |
| Tier / state | Former $500/mo whale (Feb–Jun 2025), decayed, **REVIVAL WINDOW** |
| Money shape | $3,255 life · peak mo $624 (2025-02) · best-6mo ~$450/mo · band **$25–70** |
| Engagement trigger | **Participation** — roleplay where he narrates; humor is the on-ramp |
| The formula | banter → his theme (HP/maid/roleplay) → let him narrate → ladder $25–70 |
| Likes | roleplay themes, ass content, solo/dildo play vids, sit-on-face |
| Avoid | bath/shower content (said twice), single items >$80, cold pitches, ALL blasts |
| Buying hours | ~10pm–1am ET, session buyer (3–4 unlocks per night) |
| Open loops (sales waiting) | dildo-play custom (asked 3×, quoted $100/min Dec 6 2025, never followed up) |
| Red lines | NEVER mention a video call unless we will actually deliver it (broken promise Oct 22 2025) |

## Chatter card (what actually gets sent — the whole thing)

> **CHRIS @mrgnar1979 — revival window, treat as whale**
> Formula: joke with him first (he's funny — play along), then roleplay HE narrates. Ladder $25–70, 3–4 unlocks/night, ~10pm–1am ET.
> Themes: Harry Potter / maid / sit-on-face. Wants: solo+dildo play vids (custom sale waiting — quote ~$300).
> Never: bath/shower content, anything over $80 single, mass blasts (exclude him), video-call talk.
> He calls her "Queen" — mirror warmth, notice when he's been away.

## Engagement-trigger taxonomy (v0 — grows with each case study)

1. **Participation** — buys while co-authoring the fantasy (Chris)
2. **Worship / guided submission** — buys the ritual of being led (Chuck: $200 steps, command framing, the $2,000 "VIP pledge"); short compliant replies; do NOT chase — one strong re-entry when he resurfaces
3. **Routine** — fixed-schedule buyer, same night/type; disruption = churn signal
4. **GFE / emotional** — buys after genuine connection moments (the "Chucky" pattern)
5. **Collector** — buys content itself (bundles, completeness), chat optional
6. **Whale-status** — buys to be the top fan; rank/recognition driven
7. **Silent buyer** — buys without talking; do NOT force chat, keep supply coming

_(Expect to split/add types as we run the 10–15 fan case studies.)_

## Chatter error taxonomy — what we monitor + the fix for each

Seeded by Chris's history (his Oct–Nov 2025 damage was the PRIOR agency — grading is
forward-looking for the current team; past errors define the monitors).

| # | Error | Detection (automatable) | Fix / prevention |
|---|---|---|---|
| 1 | **Broken promise** (VC "I'll confirm" → never did) | Scan our msgs for commitments ("I'll check/confirm/send") with no follow-up in 72h | Commitment log per fan; follow-up queue in the card's Open Loops |
| 2 | **Ignored buy-signal** (asked for dildo vids 3×) | Fan requests w/ no fulfillment/answer across sessions | Open Loops field = pre-sold sales list; custom-request pipeline |
| 3 | **Price-ceiling violation** ($145 pitch to a $25–70 buyer who just balked) | Pitch price vs fan's historical band; pitch-after-refusal same session | Price band printed on the card; ladder from HIS history |
| 4 | **Whale blast-burial** (150 unopened blasts) | Whale (>$1.5k) receiving mass messages; blast:personal ratio | Auto-exclude threshold + EXPOSED signal on the Save List (built) |
| 5 | **Persona/tone break** ("daddy" blasts vs his "Queen" dynamic; broken English) | Chatter QA vs voice profile (built) + per-fan dynamic field | QA flags with rewrite; per-fan address/dynamic on the card |
| 6 | **Missed activation** (fan engaged, nobody capitalized / slow replies mid-session) | Fan msg unanswered >X min during an active buying session | Session alerts; inbound-first staffing (research corpus) |
| 7 | **Wrong formula** (cold pitch at a rapport fan; forced chat at a silent buyer) | Compare approach used vs fan's trigger type | Trigger type + formula line on the card |
| 8 | **Begging after refusal** ("what if I lower it 🥺" 90 min later) | Discount-chase pattern after a "no" | Rule: after a balk, drop the pitch, return to the formula |
| 9 | **Desperation pinging** (Chuck: ~25 needy check-ins in 30 days, all ignored — "you owe me at least one reply") | Consecutive unanswered creator messages > 5 | Cadence cap; re-enter only on a trigger (his return, renewal date, new content in his lane) |

## Roadmap

1. **Case studies (now):** run 10–15 fans across creators — mix of tiers/types — same
   deep-dive as Chris. Each produces: a case file in `docs/whale-intel/case-studies/`,
   taxonomy updates, and prompt refinements. (Analysis prompt already upgraded: monthly
   ARC + CHATTER PERFORMANCE sections.)
2. **Structured extraction:** analysis outputs the per-fan profile as JSON (not just
   prose) → stored (Dropbox next to the chat archive; tracker holds the pointer).
3. **The card:** auto-generate the 8-line chatter card from the profile; attach to the
   whale-alert PDF / Telegram brief.
4. **Monitors:** chatter-QA extends to the error taxonomy (runs on incremental pulls —
   cheap, ~1 credit/fan); per-error counts become forward-looking chatter grades.
5. **Automation:** webhooks (transactions + messages) keep profiles current in real time;
   Save List + cards + QA all update without buttons.

## Related

- Chris case study: `case-studies/chris-mrgnar1979.md`
- Win-back playbook (research corpus): `research/knowledge/whale-playbook.md`
- Live signals + Save List: whale-hunting page (audit route)
