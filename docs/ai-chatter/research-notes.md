# AI Chatter — Research Notes

_Research synthesis for a suggest-mode AI that DRAFTS replies in a creator's voice for a human to approve. Grounded in our existing pieces: per-fan **dossiers** (buying formula, price band, kinks, never-dos, sleeping deals), per-creator **voice profiles**, and the nightly **chat-grading judge**. Draws on our OFM research corpus (`research/transcripts/`, `research/knowledge/whale-playbook.md`) plus targeted external sources, cited inline._

**Design stance:** the AI never sends. It proposes one (or a few) drafts; a human chatter approves, edits, or rejects. Every approval/edit is training data. This keeps us safe and turns the operator's existing work into the improvement loop.

---

## 1. Voice training — the efficient approach (context-assembly, NOT fine-tuning)

**Do not fine-tune a model per creator.** Fine-tuning is slow, expensive, must be redone every time her voice/menu/rules drift, produces an opaque artifact you can't inspect, and — critically — is worse at capturing a *specific* person's tone than good in-context prompting. Retrieval-augmented few-shot prompting "requires none of the setup requirements... zero cost and zero training time" and can match or beat fine-tuned models even at low shot counts; prompt/persona-prefixing "uses orders-of-magnitude fewer resources" than fine-tuning while improving persona consistency (https://arxiv.org/html/2512.04106v1, https://www.emergentmind.com/topics/deeply-contextualised-persona-prompting).

**Assemble context at request time from three sources we already have:**

1. **Creator voice profile** (system prompt) — her persona facts (name, age, location, pet, backstory), tone rules, sentence length/pacing, emoji whitelist, banned words. This mirrors what King Sam builds in Infloww scripts: "write down exactly how you want it to sound... make sure... the chatters are trained only to use these emojis so they all sound the same" (`research/transcripts/20251006__king-sam-ofm...`). Habibi's "power of words" (use his *name*, underuse "babe/horny/cum") is a voice-profile rule, not a script (`research/transcripts/20250315__habibi...`).
2. **A library of her REAL sent messages as few-shot examples** — the single biggest lever. Pull 6–15 of her actual approved lines that match the current situation (greeting, tease, PPV caption, objection reply) and drop them in as demonstrations. Few-shot examples carry the stuff a written style guide can't: rhythm, punctuation habits, how she flirts. "Few-shot prompting provides the best balance of accuracy and resource cost" (https://medium.com/@mary.schwaber/few-shot-prompting-vs-fine-tuning-a-cost-efficiency-perspective-5bf00257c3e8).
3. **The fan dossier** (context) — who *this* fan is: relationship type, kinks, price band, what he's bought, never-dos, sleeping deals. This is what makes the draft personal instead of a template.

**Keep it cheap:**
- **Retrieve, don't dump.** Embed her message library once; at draft time semantic-search the few examples that match the *current intent* (see §2) rather than stuffing hundreds. Small, relevant shot sets beat large ones — "few-shot RAG offers minimal additional gains at significantly higher computational expense" past a point.
- **Cache the stable prefix.** Voice profile + persona facts are identical across every turn in a thread → prompt-cache them so only the dossier + last few messages + retrieved examples are fresh tokens.
- **Short drafts are correct anyway.** Habibi: "less is more," PPV captions one sentence. Cheap tokens *and* better output align.

**It improves as approvals accumulate.** Every approved draft (and every human *edit*, which is a corrected gold example) goes back into her message library. The retrieval pool grows richer and more on-voice with zero retraining — the same pattern LangSmith/HITL systems use: "collect human corrections, build few-shot examples, and track agreement over time" (https://www.langchain.com/resources/llm-as-a-judge). The system gets better by being *used*, not by being retrained.

---

## 2. Conversation taxonomy — the "billion directions" mapped to ~11 intents

Fans say endless things, but they collapse into a small set of **intents**. Classify the fan's latest turn into one, then retrieve voice examples + apply the principle for that type. (This classification is also the retrieval key from §1.)

| # | Intent | What the fan is doing | Principle for the right response |
|---|--------|----------------------|----------------------------------|
| 1 | **Greeting / small talk** | Opening, "hey", "how's your day" | Warm, name-first, ask a question back. Habibi: never open with "hi how are you" — "you've missed so much... how could you've gotten cuter." Build rapport before selling. |
| 2 | **Discovery / data-gathering** | Answering or volunteering name, age, job, location, kinks | *Collect and log to the dossier.* "All of our job is actually data collection" — job → purchase power, kinks → what to sell later (King Sam). Reply feels like interest, secretly qualifies. |
| 3 | **GFE / emotional** | Wants attention, connection, to feel special; "I miss you", "how was your day really" | Lead with love, not lust — "customers buy because of love not lust" (Luca). This is the whale glue; voice notes are the strongest touch (whale-playbook). Don't rush to a PPV. |
| 4 | **Sexting / escalation** | Getting flirty/explicit, initiating spice | *Let him initiate*, then match and escalate — "when the customer initiates we're in the power position" (Luca). Push/pull, tease, paint pictures with words. This is the runway to a sale. |
| 5 | **Content request** | "Can I see...", "send me..." | Never hand it over free. Tease, delay, then price. "Even if a guy says send me photos of your tits you just say... no you're going to have to wait" (Habibi). Convert request → PPV. |
| 6 | **Price negotiation / haggling** | Trying to talk price down, wants a deal | Hold the frame with confidence, don't discount reflexively — "would you want your partner to send out discounts of their body?" Reframe as value, not a flea market (Habibi). If he keeps grinding, mark time-waster. |
| 7 | **Objection / "too expensive" / "broke"** | Resisting the buy | Don't argue or beg. Reframe, shrink the ask, or use "don't buy it" reverse-psychology ("please actually don't watch it, I did too much") (Habibi). Never shame a genuinely budget fan — match his price band from the dossier. |
| 8 | **Logistics / "can we meet up?"** | Wants to meet IRL, asks real-world questions | Never hard-no (burns the sub). "Move the goalpost further and further away without saying no" — safety framing, "I'd rather get to know you here first" (Bjorn, "$30k objection"). Keep the fantasy + recurring revenue alive. |
| 9 | **Re-engagement (cold/dormant fan)** | Went quiet, sub lapsing, hasn't spent in a while | Personal, specific re-open on *his* thing, not a generic "hey stranger." Whales get 1:1 (reference the old convo, voice note); mass-blast only the low tier. Rebill-off = act before expiry (whale-playbook). |
| 10 | **Boundary-pushing / off-limits** | Requests something on her never-do list (specific acts, IRL, another platform, personal contact) | Deflect gracefully, stay in character, redirect to what she *will* do. This is a hard guardrail (§4) — the dossier's never-dos and the voice profile's limits override any sales urge. |
| 11 | **Complaint / refund / tech** | Unhappy with content, chargeback threat, "it won't load" | De-escalate, empathize, make it right within policy; do NOT improvise money/refund promises. Route to a human — this is the lowest-tolerance-for-AI-error zone. |

_(Overflow bucket: "unknown/ambiguous" → default to rapport + a clarifying question, never a pitch. Ambiguity should lower sales aggression, not raise it.)_

Sources for the taxonomy: our corpus above + https://www.supercreator.app/guides/onlyfans-chatter, https://www.desirely.co/en/blog/onlyfans-chatter-training, https://infloww.com/blog/conversational-chatting-onlyfans.

---

## 3. The sales progression — moving toward a buy without breaking rapport

The consensus funnel across the corpus (Luca's $50k framework, King Sam's Infloww scripts) is a **staged escalation**, not a pitch:

1. **Warm / connect** (intents 1–3) — general conversation, feel like a friend. No selling. "We obviously don't want to build a relationship forever... but we want to lead it where we want it to go" (Luca).
2. **Qualify** (intent 2) — silently learn job/budget/kinks → this sets the *price band* and *what* to sell. Log to dossier.
3. **Check the moment ("imposition")** — is he in a position to buy? King Sam's "imposition": "curled up in bed right now, should I keep waiting?" If he's at work → "let me know when you finish." **Never pitch into the wrong moment.**
4. **Escalate** (intents 4–5) — let *him* initiate spice, then build arousal, paint pictures. Power position = he's chasing.
5. **Pitch** — assumptive caption phrased as a question he can't answer without unlocking ("do you like how I do this?"). First PPV low ($5–20) to build the buying habit; short caption; no content-describing wall of emojis (Habibi, Luca).
6. **Ladder up** — price off *his own purchase history*, not the menu (whale-playbook); re-tease, run "double scripts" (bedroom → shower) with pacing. Reward big spends with a small free gift to deepen rapport over squeezing +$40 (Habibi).

**When NOT to pitch:** during pure GFE/emotional moments (intent 3), when he's in the wrong place (failed imposition), when he just objected on price (defuse first), on a complaint (intent 11), or on an ambiguous turn. Over-pitching burns the sub — the corpus's #1 warning against "$20 mass-message pig-video bundles." **The chatting-ratio target is ~1:8–1:15 revenue:messages** (GriffinOFM) — i.e. most messages are *not* sells.

---

## 4. Guardrails & failure modes — what the drafter must never do

Persona chatbots have well-documented failure modes: **character hallucination** (drifting out of persona / inventing facts), driven by "query sparsity and role-query conflict," and **role-adherence bias** where the model "responds in character before executing the correct" constraint (https://arxiv.org/html/2409.16727v1, https://arxiv.org/pdf/2509.00482). Mapping those to our safeguards:

| Failure mode | What it looks like here | How our pieces prevent it |
|---|---|---|
| **Persona break** | Sounds like a generic bot / breaks the fourth wall / says "as an AI" | Voice profile + her real-message few-shots keep tone locked; classify + in-character refusal for out-of-scope asks (Character-LLM approach). |
| **Over-pricing a budget fan** | Pitches a whale-tier PPV to a $9 guy | Dossier **price band** is a hard input; drafter prices from *his* history, never the top of the menu. |
| **Ignoring stated boundaries** | Draft references a kink/act she won't do, or agrees to meet IRL / move platforms / share contact | Dossier **never-dos** + voice-profile limits are non-negotiable constraints checked before a draft is shown; intent-10/8 handling deflects, never confirms. |
| **Fabrication** | Invents a schedule, a promise, a piece of content, a discount that doesn't exist | Ground every factual claim in the dossier/vault; if not present, the draft must stay vague ("soon", "I'll see") — never assert specifics. Sleeping-deals field prevents re-offering a dead promo. |
| **Unsafe / compliance topics** | Age talk, illegal requests, self-harm, real-world meetup logistics, payment-off-platform | Hard STOP → no draft, flag to human. These are never auto-drafted; the AI's job is to *refuse to draft*, not to draft a refusal it might get wrong. |
| **Chat-before-constraint bias** | Flows a friendly reply that quietly violates a rule above | Constraints evaluated *before* style: dossier/limits gate first, voice second. |

**Core principle:** the dossier is the *guardrail source* (price band, never-dos, sleeping deals, kinks) and the voice profile is the *style source*. When they conflict with a sales instinct, they win. And because it's suggest-mode, a human is the final gate on every message — the strongest guardrail of all.

---

## 5. Efficient training & eval plan

**The approve/edit flywheel (the whole engine):**
- Operator sees N drafts per fan turn → **approves**, **edits**, or **rejects** with a one-tap reason.
- **Approved as-is** → gold on-voice example → added to her message library (§1). Strong signal.
- **Edited** → the *edit* is the correction. Store (draft → final) pair; the final becomes the gold example, and the diff tells you the model's systematic misses (too long? too explicit too early? wrong price?). This is the highest-value data — "all requirements labeled by humans... fed back to the generator as few-shot examples" (https://arxiv.org/pdf/2606.25550).
- **Rejected** → negative example + reason tag (persona break, over-priced, boundary, off-tone). Feed reasons into the system prompt as "avoid" rules.

**Sandbox / role-play mode:** an operator plays the *fan* (pick a dossier archetype: new sub, whale, cheapskate, meet-up pusher) and chats the AI creator. Cheap way to (a) stress-test each of the 11 intents and every guardrail before going live on real fans, (b) generate seed examples for a brand-new creator who has no message history yet, and (c) onboard new human chatters against the same scripts.

**Turning approvals into training — concretely:** nightly job re-embeds the growing approved-message library per creator so retrieval always pulls the freshest on-voice lines; promote frequently-approved lines to "canonical" few-shots; surface the top rejection-reason tags as prompt edits for review.

**Lightweight "is it good enough" measurement — reuse the nightly judge we already have:**
- **Approval rate** — % of drafts approved with no edit. Primary north star; track per creator and per intent to find weak spots.
- **Edit distance** — how much humans change accepted drafts (trending → 0 means it's learning her voice).
- **Judge score** — point the existing nightly chat-grading judge at AI-drafted-then-sent messages; use it as an offline scorer on new drafts (LLM-as-judge, calibrated against human corrections — https://www.langchain.com/resources/llm-as-a-judge). Send uncertain/low-agreement cases to a human, active-learning style.
- **Guardrail violation rate** — count drafts a human killed for a boundary/price/fabrication reason. Target: ~0, and it should *only* be caught pre-send.
- **Business tie-back** (slower signal): chatting ratio (1:8–1:15) and revenue-per-fan on AI-assisted threads vs human-only, to confirm drafts actually convert.

The elegance: we already have the dossiers, the voice profiles, and the judge. This plan wires them into a suggest-mode drafter whose only new moving part is the **approve/edit loop**, which the operator runs anyway — and that loop is simultaneously the safety net *and* the training signal.

---

### Sources
- Our corpus: `research/transcripts/` (habibi A-Z chatting playbook; Luca $50k script framework; King Sam Infloww scripts; Bjorn "$30k meet-up objection"), `research/knowledge/whale-playbook.md`.
- https://arxiv.org/html/2512.04106v1 — retrieval-augmented few-shot vs fine-tuning (cost, zero training time)
- https://medium.com/@mary.schwaber/few-shot-prompting-vs-fine-tuning-a-cost-efficiency-perspective-5bf00257c3e8 — few-shot cost/accuracy balance
- https://www.emergentmind.com/topics/deeply-contextualised-persona-prompting — persona prompting beats fine-tuning on resources/consistency
- https://arxiv.org/html/2409.16727v1 — character hallucination / role-query conflict
- https://arxiv.org/pdf/2509.00482 — role-adherence bias, chat-before-constraint
- https://www.langchain.com/resources/llm-as-a-judge — HITL corrections → few-shots, LLM-as-judge calibration
- https://arxiv.org/pdf/2606.25550 — human-labeled outputs fed back as few-shot examples
- https://www.supercreator.app/guides/onlyfans-chatter, https://www.desirely.co/en/blog/onlyfans-chatter-training, https://infloww.com/blog/conversational-chatting-onlyfans — chatter conversation types / staged selling
