# AI Chatting Rework — Master Build Plan

_Created 2026-07-21. Source of truth for replacing/augmenting the human chat team with per-creator AI chatters. Grounded in 3 deep research passes (OFM chatting craft from 150+ agency playbooks; AI-companion engineering; authentic creator-intake design) + the working sandbox at `/admin/chat-sandbox`._

---

## 0. The goal

Per-creator AI that chats with fans **as the creator** — in her real voice, running proven OFM sales craft (GFE + escalation-ladder PPV selling), at a fraction of the human chat-team cost. Target: indistinguishable-from-human on the axes that matter (voice, memory, control), guardrailed, with human QA on top.

**Guiding principles**
1. **Authenticity per creator comes from her real data, not adjectives.** Example dialogue in her actual words drives voice fidelity far more than "she's flirty." The intake IS the training.
2. **Right model for the job.** Permissive model (Grok) for explicit generation; Claude for the careful scaffolding (persona authoring, summarizing, fact extraction, safety). Never fight a model's nature.
3. **Token-efficient from day one** (caching + rolling summary + compact memory) — see §10.
4. **Human-in-the-loop until proven.** Shadow → approve → autonomous-with-QA. Never flip a creator to full-auto cold.
5. **Guardrails in code, not model discretion** (age-gate, adult-fiction-only, no real third parties in explicit content, disclosure).

---

## 1. Production architecture (the per-message pipeline)

Every inbound fan message flows through:

```
inbound fan message
  │
  ├─▶ [1 Director / classifier]   cheap fast model (grok-4.3 / haiku): fan TYPE,
  │                                intent, escalation level, safety flags, and the
  │                                next "beat" (tease / comfort / escalate / sell /
  │                                recall a fact) + how many bubbles. Also: reply or not?
  │
  ├─▶ [2 Context assembler]        builds the prompt:
  │      • persona spec (CACHED, static per creator)
  │      • house rules + sales playbook (CACHED, static)
  │      • this fan's fact memory (name, kinks, boundaries, where we left off)
  │      • rolling summary of older turns + recent turns verbatim
  │      • retrieved few-shot: 3-5 of HER real lines matched to the beat/mood
  │      • post-history anchor (hard rules, injected AFTER history)
  │
  ├─▶ [3 Generation]               permissive model (Grok 4.5) or per-creator LoRA;
  │                                temp ~0.9; returns multi-bubble output
  │
  ├─▶ [4 Post-processor]           strip AI tells (em dashes, "not X but Y", service
  │                                closers); enforce lowercase-casual + emoji cap;
  │                                dedupe vs recently-used openers/pet-names; split bubbles
  │
  ├─▶ [5 Pacing / delivery]        read lag (warmth-based) + typing indicator +
  │                                per-bubble delay (~normal texting speed)
  │
  └─▶ [6 Log + learn]              store the exchange; feed QA + coaching loop
```

The sandbox already implements a simplified 3→4→5 (single model + prompt + pacing + coaching). This plan builds out 1, 2, 6, the memory, and the intake.

---

## 2. Per-creator persona system

**Persona Spec** (modeled on the SillyTavern character-card v2 fields — the battle-tested schema; keep the whole thing under ~2000 tokens):
- CORE IDENTITY (2-3 sentences, first person)
- VOICE & MECHANICS (from a measured "style card": casing, avg length, emoji rules + her top emojis, signature phrases, greeting pattern)
- PET NAMES (rotate — never one on repeat)
- HUMOR & FLIRTING STYLE
- TURN-ONS
- HARD LIMITS + NEVER-SAY (non-negotiable)
- KEY PEOPLE & FACTS (best friend, pets, city, job — fixes "who's Mattie?")
- AVAILABILITY / PRICING
- **EXAMPLE DIALOGUE (few-shot, verbatim from roleplay + best real messages)** ← the load-bearing part

**Storage:** extend the existing Voice Card system (`lib/voiceCard.js`, keyed by HQ Record ID so Free+VIP share one voice). New Airtable table `Creator Persona` (see §12).

---

## 3. Creator intake & training (the ingest) — CONFIRMED FEASIBLE

**The winning format** (authenticity-per-effort; her real messages + voice are gold, written forms are the weakest signal):

1. **Voice intake, ~12 min** — AI voice agent interviews her with adaptive follow-ups. Front-load story/personality (voice gets ~4× completion + more candor than a form — big for the explicit/boundaries stuff), end with rapid-fire facts.
2. **Roleplay round, 8-12 situations** — "a fan says X, what do you fire back?" (compliment, new-sub opener, haggler, explicit ask, going quiet, lonely/emotional, boundary test, whale check-in). Her answers become the highest-value **few-shot examples**. Feels like a game.
3. **One-time DM export, 150-300 of her real SENT messages** — anchors her exact rhythm/emoji/punctuation. 30-sec Loom showing which button to remove friction. (Or we pull it via the OF API — we already have her `acct_...` id.)

**Minimum viable dataset:** ~10-12 min audio + 150-300 real sent messages + 8-12 roleplay pairs. Any two of three = passable; all three = convincing.

**Voice-agent tech options (pick one):**
- **Live AI voice call** (realtime voice API — e.g. an OpenAI Realtime / Vapi / Retell / ElevenLabs Conversational-AI style agent) that runs the script, asks follow-ups, records + transcribes. Best experience, most signal.
- **Fallback (build first, zero new infra):** record-prompts flow in the portal — she taps record and answers each prompt as a voice memo. **We already accept iPhone .m4a voice memos in onboarding**, so this is a small extension. Loses adaptive follow-ups, keeps ~90% of signal.

**Synthesis pipeline (all on our side, LLM-driven):**
1. Transcribe audio (enrich with tone notes if feasible).
2. **Style card** — LLM pass over her real sent messages: avg length, casing, emoji freq + top-5, signature phrases/openers, abbreviations, escalation pattern (measured, not guessed).
3. **Traits/facts** — LLM pass over the transcript: the 6 axes (identity/key people, personality, humor/flirt, turn-ons, hard limits, pricing/availability) — force concrete quotes.
4. **Assemble Persona Spec** (front-loaded) + **few-shot from her roleplay + real messages VERBATIM** (never paraphrased into generic flirt-speak — that's how fans catch a fake in ~3 messages).
5. **Human quick-approve** (Evan or the creator glances, fixes, approves).

---

## 4. Memory & continuity (per fan)

The thing that makes a relationship feel real. Stack (best used together):
- **Structured fact store** (highest ROI): name, kinks, hard nos, pet names he gave her, key life events, spend tier, where we left off. Injected every turn. Extract after each session.
- **Rolling summary**: compress old turns; keep recent verbatim. Caps context growth (token control).
- **Keyword lorebook**: his kink/boundary entries load only when the topic comes up — O(many facts) memory without paying tokens for irrelevant ones.
- **Vector RAG (optional, later)**: soft "have we talked about this" — keep precise to avoid creepy false "I remember" moments.

Ties into existing `project_fan_intel_system` / Fan CRM (we already analyze fan histories for whale-hunting).

---

## 5. Sales & behavior layer (from the OFM playbook research)

- **Fan-type classifier** (in the Director) → adapt: lonely/GFE, horny quick-buster, whale, haggler, time-waster, dom, sub, fetish/roleplay, "is this real?" skeptic. Each gets a different tone + sell.
- **Sexting funnel:** never open with a PPV; let HIM initiate the sexual turn; escalation **ladder** (cheap first unlock ~$7-9 to build the habit → each rung hotter + a notch pricier); free teasers between paid sends ("edge the sale"); permission-ask finale → free gratification video → win-back.
- **Objection handling:** concrete reframes for too-expensive / no-money / is-it-real / already-paid / just-talking / send-free. Never drop price first; 50/50 split on customs; add value not discount.
- **Pricing discipline:** don't name a price unless asked; hold firm; de-round; dynamic by spend tier.
- **Post-purchase / retention:** gratitude mode when he stops buying; daily touchpoints; 7/14/30-day win-back for lapsed subs.
- **The "content actually exists" problem (KEY DEPENDENCY) — cost-aware approach:** the bot can only sell content that's real, so it needs a **Content Catalog** per creator (item → semantic description, tags, explicitness tier, price, OF media/post ID, preview). Evan's worry is (rightly) the cost of downloading whole vaults (~3,000 OF credits per 1 GB video × thousands of items = huge). **The fix: don't download the vault — LIST it and analyze thumbnails.**
  - The OF API can **list** vault/media (IDs + preview thumbnails) cheaply — the expensive part is *downloading full files*, which we avoid.
  - **Analyze 1-3 preview frames / thumbnail** per item with a cheap vision model (~$0.001-0.005/item) → semantic description + tags + explicitness tier. Thousands of items = a few dollars, not thousands of credits.
  - **Content-request uploads:** analyze at upload time (file's already in Dropbox) → catalog entry created automatically. Easy, incremental, zero OF credits.
  - **Store** the OF media/post ID so the bot can lock+send the exact piece via the API. **Track per-fan purchases** from webhook `messages.ppv.unlocked` events so it never re-sells the same thing.
  - Optional: a cheaper 3rd-party bulk downloader + downscale only if we ever need the actual bytes (probably not — listing + thumbnails is enough for matching + selling).
  - Semantic search: embed the descriptions; when the fan wants X, retrieve the best-fit unowned item at the right price tier. This is its own sub-project (Phase 3), not a Phase 1 blocker.

---

## 6. Realism engineering (mostly prompt + post-processing)

- **Ban the AI tells:** em dashes, "not just X, it's Y", service closers ("let me know if…"), every-message-a-question. Name the bad habits (telling it to "sound human" does nothing).
- **Anti-repetition:** feed last N openers/pet-names back, forbid reuse. Temp ~0.9.
- **Message chunking** (have it): 1-5 short bubbles.
- **Emoji discipline** (have it): sparse, her emojis only, never on every message.
- **Post-history anchor:** hard rules AFTER the chat history (recency = obedience over long chats).
- **Pacing** (have it): warmth-based read lag + length-scaled typing.

---

## 7. Guardrails & compliance

- Age-gate; adult **fictional** personas only; **never real third parties** in explicit content; no illegal content — enforced by classifier + code, logged.
- **Disclosure:** ghost-chatting without disclosing AI/human handling has drawn lawsuits — decide the disclosure stance with legal.
- **OF ToS:** confirm AI chatting is within OnlyFans' terms / how it must be disclosed. **OPEN DECISION — do before going live on real fans.**
- **Human QA:** daily review of new-fan chats, weekly review of every $200+ spender (the industry says this relationship-quality judgment is the hard part to automate — keep a human on it).

---

## 8. Ongoing training loop (compounding, ~zero creator effort)

- **Sandbox coaching (BUILT):** thumbs-up/down + notes on drafts feed accepted lines into few-shot, demote rejected patterns.
- **Passive re-ingest:** periodically pull her real sent (or approved) messages → re-run the style card. Best training data is what she's already sending.
- **Drift detection:** flag when new messages diverge from the stored style card; suggest a spec update.
- **Quarterly 3-min refresh** micro-interview for new things only (new pet, catchphrase, boundary).

---

## 9. Rollout phases

- **Phase 0 — Sandbox (DONE).** Training ground: you're the fan, model plays the creator, coaching notes, Grok/Sonnet toggle, persona + playbook prompt, auto-save.
- **Phase 1 — Persona pipeline + intake pilot (Caitie).** Build the intake (voice memos fallback first), the synthesis pipeline, the Persona Spec table. A/B the generated spec vs current in the sandbox.
- **Phase 2 — Memory + retrieval few-shot.** Per-fan fact store + rolling summary + keyword lorebook; switch static few-shot → retrieval-based.
- **Phase 3 — Token efficiency.** Prompt caching on the static prefix; rolling summary live; the cheap Director model.
- **Phase 4 — Production wiring (shadow → approve → auto).** Connect to live OF chats via the OF API/webhook. Start in **shadow mode** (AI drafts, human sends), then **one-click approve**, then **autonomous with QA** on low-risk fans first.
- **Phase 5 — Scale + fine-tune.** LoRA-fine-tune top creators (WeClone pattern) where volume + consent justify it; roll to all creators.

---

## 10. Token / cost model — MEASURED

Real volume from the live-events sheet (`LIVE_EVENTS_SPREADSHEET_ID`), Jul 2-21 2026, 38 active accounts:
- **~75,700 messages / 20 days = ~3,800/day = ~114,000/month** (~54k inbound / ~60k outbound).
- AI pays to generate **replies only** (~54k generation calls/month, one per inbound) + a tiny Director classifier call each.
- **Per reply:** ~$0.003 cached (Grok persona cached at $0.30/M vs $2/M) to ~$0.007 uncached.
- **Real monthly cost: ~$200-400 with caching, ~$800 worst-case uncached.** Far under the $1,500 ballpark; trivial vs a human chat team.
- Efficiency levers: caching (biggest), rolling summary, compact memory, small retrieval, cheap Director model, fine-tune whales.

---

## 11. Decisions (RESOLVED 2026-07-21 by Evan) + remaining

**Resolved:**
1. **OF ToS/disclosure** — the whole system knowingly breaks OF ToS; **we accept that risk.** Not a blocker.
2. **Whales** — **full AI**, no human carve-out. The goal is a system good enough to handle whales (Evan believes it's already better at whales than the human team). Keep human QA as a safety net, not a handoff.
3. **Real volume** — measured: ~114k msgs/month (§10).
4. **Content Catalog** — approach set (§5): list + thumbnail-analyze, don't download vaults; analyze content-request uploads at upload. Phase 3.

**Remaining / to revisit:**
5. **Full-auto vs hybrid** — target is **fully autonomous** (find the right content, lock at the right price, send). Build with a manual/approve fallback and graduate to auto per creator as confidence grows — but the destination is 100% AI.
6. **Voice-agent tech** — live agent (Vapi/Retell/Realtime) vs record-prompts fallback. Start with the fallback.
7. **Shadow-mode duration** per creator before autonomy.

---

## 12. Data model (Airtable, OPS base `applLIT2t83plMqNx`)

- **`Creator Persona`** (new): Creator ID, Persona Spec (JSON/long text), Style Card (JSON), Few-shot Examples (long text), Status, Updated.
- **`Fan Memory`** (new): Fan key, Creator ID, Facts (JSON: name/kinks/nos/nicknames/spend tier/last-left-off), Rolling Summary, Updated.
- **`Content Catalog`** (new or extend Post Prep): Creator ID, item, tags, explicitness tier, price, exists-flag, Dropbox link.
- **`Sandbox Coaching`** (BUILT, `tblx7E2t5naaWD0oE`): the coaching-note loop.
- **`Intake Sessions`** (new): Creator ID, audio files, transcript, roleplay pairs, DM export, synthesized-spec link, approved.

---

## 13. What's already built (Phase 0 assets)

- `/admin/chat-sandbox` + `app/api/admin/chat-sandbox/route.js`: model routing (Grok 4.5 / 4.3 / Sonnet via `GROK_CHATTING_V1`), voice-card + persona + coaching prompt, playbook rules, warmth-based pacing, double-texting, tolerant JSON parsing, localStorage auto-save.
- `Sandbox Coaching` table + `/api/admin/chat-sandbox/notes`: the training-note loop.
- `lib/voiceCard.js`: per-creator voice card (onboarding survey → pet names/phrases/emojis/never-say/sample replies).

---

_Related memory: `project_ai_chatting_framework`, `project_voice_card`, `project_fan_intel_system`, `reference_site_research`._
