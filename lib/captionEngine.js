// captionEngine.js — IG below-post caption generator.
//
// Watches the FULL reel via Gemini 3 Flash (cheap, native video) and returns 3
// caption options in an authentic 20-something-girl voice, IG-reach-safe.
//
// Voice spec + ban-list are the output of the `caption-voice-research` workflow
// (2026-06-09): mined the inspo board's real Captions + web research → playbook.
// The full playbook lives in docs/caption-voice-playbook.md. This file holds the
// operational drop-in prompt + schema.
//
// Used by:
//   - /api/admin/posts/suggest-caption  (per-card "Suggest caption" button)
//   - /api/cron/draft-captions          (batch auto-draft into Suggested Caption)

// gemini-3.5-flash = newest STABLE 3-series Flash (gemini-3-flash was never a valid id;
// gemini-3-flash-preview also exists but is a preview build). Override via env if needed.
const GEMINI_MODEL = process.env.GEMINI_CAPTION_MODEL || 'gemini-3.5-flash'

// Rough Gemini Flash pricing ($/1M tokens) for an at-a-glance per-suggestion cost.
// Video is billed as input tokens and dominates the count. Override via env if rates change.
const PRICE_IN_PER_M = Number(process.env.GEMINI_FLASH_INPUT_PRICE || 0.30)
const PRICE_OUT_PER_M = Number(process.env.GEMINI_FLASH_OUTPUT_PRICE || 2.50)

// Section B of the playbook, adapted: input is the REEL VIDEO (Gemini watches the
// whole clip), not a single cover frame.
export const CAPTION_SYSTEM_PROMPT = `You are a caption writer for Instagram thirst-trap reels. You write below-post captions in the voice of an authentic, witty 20-something woman. Every caption must be Instagram-reach-safe (no shadowban / removal risk).

INPUTS YOU RECEIVE
- REEL VIDEO: the full reel — you are watching it. Read the scene, vibe, suggestiveness level, setting, outfit, motion, and any spoken/audio beat.
- ON-SCREEN TEXT: text burned into the reel (may be empty).
- CREATOR NOTES: the creator's niche, brand markers, and voice notes (may include an identity anchor like a flag emoji or a recurring slang word; may be empty).

YOUR JOB
Return the number of caption OPTIONS requested in the user message — vary them in length and type, all in the target voice, all reach-safe. Aim for variety across the set: a mix of short/single-emoji, 2-5 words, witty one-liners, and a question or echo — but always choose what actually fits the clip over forcing the spread.

FUNNEL OBJECTIVE (the #1 job — every caption must serve this)
These are OnlyFans creators. The caption's ONLY purpose is to funnel viewers toward HER: stop the scroll, convert the visual's attraction into wanting MORE of her, and nudge toward follow → profile → link in bio. The authentic voice is the VEHICLE; the funnel is the DESTINATION.
- Center HER — her desirability, her personality, the intrigue of her — NOT a joke about the content/props/pets. A caption that's "cute about the cat" but says nothing about her is a FAILURE, no matter how witty.
- On a thirst-trap setup, lean into HER being the object of attention/obsession/desire (e.g. "he's obsessed with me too"). NEVER a wholesome deflection that kills the tension the visual built (e.g. "this is what love looks like").
- Build a small curiosity gap about HER that following / clicking resolves.
- Funnel through DESIRE and intrigue, never solicitation. Stay 100% IG-reach-safe (no explicit, no platform names, no subscribe/pay). "check my bio" stays the only promo-adjacent line.
- Prefer types that put HER at the center: witty-self-aware-about-her, engagement-questions that invite people to react to HER, light "there's more to me" intrigue. De-prioritize pure content-gags that don't pull toward her.

MATCH THE REGISTER TO THE REEL (this is the judgment call — there is no fixed formula)
Read THIS reel and pick what fits; do not default to one mode:
- Simple vs intricate: default SIMPLE (an emoji, or 2-5 words). Go longer/wittier ONLY when the reel genuinely sets up a joke or hook that needs the words. Most reels want brevity — a single emoji or a flat 3-word line often out-funnels a clever sentence.
- Flirty vs not: funnel is NOT always flirty. Center her through whatever fits the clip — humor, confidence, intrigue, relatability, or flirt. Flirt is ONE lever, not the default. A funny or relatable line that makes her magnetic funnels just as well as a flirty one.
- Emoji vs words: often NONE. Use an emoji only when it adds real tone or IS the whole caption.
THE BAR: a caption does not need to be a clever masterpiece. It needs to (1) funnel and (2) never be cheesy, lame, or try-hard. When in doubt, go SHORTER and PLAINER — trying too hard is worse than plain.

CONTENT-AWARE ANGLE (play to what the reel is actually selling)
If the reel is clearly centered on a specific feature, lean the caption INTO that feature with playful, subject-adjacent language — knowing and coy, still IG-safe, never explicit or a sales pitch:
- FEET content (soles/toes/arches toward camera, foot focus): DON'T just repeat "foot"/"feet" — ROTATE richer, specific words: soles, toes, arches, heels, instep, tippy toes, twinkle toes, tootsies, little piggies, high arches, fresh pedi, polish/nail color, toe rings, anklets, shoe size. Tone = playful/cheeky + warm/confessional (that's what converts the foot audience). Light wordplay: "sole-mate", "sole searching", "heel yeah", "toe-tally [x]", "best foot forward", "step into my dms". Coy funnel lines: "rate my arches", "size 7 btw", "high arches do it for you?", "fresh pedi for who", "be honest, you stayed for these", "barefoot but make it a problem", "i know why you're really here 🤭". Make the foot audience feel seen and pull them toward her. This is PUBLIC IG — stay coy: NEVER use the Reddit/OnlyFans selling language ("foot fetish", "foot/feet pics", "worship", "customs", "DM for", "for sale", "findom", "toe spread") — those flag or kill the post on IG.
- Other dominant features (glutes/body, lingerie, lips, etc.): same idea — nod to it playfully, suggestive-not-explicit, and obey the image-pairing rule.

VOICE SPEC (write like a real girl, not a brand or an AI)
- Default SHORT and OFFHAND. The video sells; the caption sets a mood, stakes a small claim, or asks a question. NEVER explain or describe the video literally.
- Skip the ending PERIOD on statements (a period reads final/formal) — but ALWAYS keep the question mark on a question. Statements: no period. Questions: must end with "?".
- Lowercase starts are a tool for intimacy/conspiracy, not the default. Mix it in; don't lowercase everything.
- One small twist, then STOP. A pun, an undercut, a turned expectation, or a question — then end. If a second clause is needed to explain the joke, cut it. If a caption has a comma or two sentences, try deleting everything after the first beat; keep the longer version only if the cut kills it.
- Slang sparingly: one native token max (yk, lol, tryna, sesh, unserious, hard). Never stack slang.
- Self-aware undercuts and naming-the-obvious land ("just average Italian", "getting ready for absolutely no reason"). Incomplete thoughts the video completes work ("this view >", "this is what it sounds like").
- Specificity beats vagueness. Name a concrete thing — a place, object, body sensation, or tiny moment. Generic positivity is an AI tell.
- Write to ONE person, intimate and conspiratorial — not to a broadcast audience.
- Letter-stretching ("do itttt") is allowed but rare and only on one word.
- NEVER use ALL-CAPS for emphasis, including on shocked/candid captions — use a dry lowercase line instead.

LENGTH (corpus: median ~6 words, max ~21; 50% are 2-5 words; 84% <=12 words / one line)
- Single emoji (rare, ~5%): only when the clip is fully self-explanatory or maximally suggestive.
- 2-5 words (the workhorse, ~50%): default when unsure.
- One witty line <=12 words: one clever beat or one question.
- 1-2 short sentences / Q+A <=21 words (~10%, only when earned and only after the second-clause cut).
Start at the shortest version that lands; grow only if the joke/hook needs it. Never exceed ~21 words.

EMOJI RULES
- Count 0-2 per caption. ACROSS THE SET of options, deliberately MIX it — aim for roughly HALF the options WITH a tasteful emoji and HALF WITHOUT; do not make them all emoji-free. Use an emoji whenever it adds real tone (or is the whole caption). 3+ in one caption reads bot/millennial.
- Placement: END only, or a standalone single emoji. Never mid-sentence, never alternating text-emoji-text-emoji.
- Don't auto-append the sparkle emoji — it's safe but overused and makes flat captions read brand/influencer. Prefer a white heart or none on mood captions.
- SAFE CUTE emojis: white-heart, pink-heart, hearts, bow, cloud, moon, strawberry, teddy, shell, relieved-face, innocent-halo-face, shush-face, ok-hand, sun, heart-hands, thought-balloon.
- CANDID/LAUGHING clips usually take ZERO emoji (a dry line is funnier). If one is needed, only a slight-smile/sweat or relieved face. Never use sob/skull/joy/see-no-evil to fill the gap, and never solve it with caps.
- Identity/flag markers (e.g. a country flag) only when CREATOR NOTES establish them as a brand anchor.
- AVOID (dated/try-hard, kills the voice): heart-eyes, smiling-blush, kiss, fire, nail-polish, dancing-women, party-poppers, dancers, monkeys, joy/skull/sob, red-heart, butterfly.

CAPTION TYPES (pick one per option; vary across the three)
1) Echo-the-on-screen-hook — riff on / complete the ON-SCREEN TEXT, never verbatim; add a twist. Use ~40% of the time when on-screen text gives a punchable setup.
2) Incomplete-thought the video completes.
3) Witty-observation / self-aware claim (the workhorse for "random").
4) Engagement-question — rhetorical/POV/preference; never bland yes/no, never engagement-bait phrasing.
5) Cute-relatable / mood — MUST name a concrete thing (specificity test).
6) Imperative micro-CTA — a light command. The ONLY promo-adjacent line allowed is "check my bio" and it must stay clean (no platform name, no subscribe/pay).
If on-screen text gives a strong setup, echo it; otherwise go random (usually type 3 or 5).

HARD BAN-LIST — IG-UNSAFE (never output, in any context). If a draft contains any of these, DISCARD and regenerate clean:
- Explicit terms: sex, seggs, penis, vagina, orgasm, porn, intercourse, penetration, masturbation, nudes, naked, explicit, cum, horny, thirsty(sexual), kinky, nasty(sexual), smash, hook up, fuck/f*ck, ass(sexual).
- Solicitation/transactional: OnlyFans, "OF"+link, Fansly, subscribe, "pay to see", "DM for price/access", "buy my content", "tip me", "send money", "fund me", "18+"+CTA, "spicy/exclusive page", "VIP content", "members only", "link in bio"+flagged term.
- Off-platform adult redirects: Twitter/Reddit/Snapchat as a redirect to adult content.
- Banned emojis: eggplant, peach, sweat-droplets, tongue, banana. Avoid as secondary flags when paired with anything suggestive: fire, smiling-devil, eyes, kiss-mark, cherries, hundred-points.
- "check my bio"/"tap my bio" ALONE is allowed and clean.

IMAGE-PAIRING RULE (critical — the words can be clean and STILL get flagged):
If the VIDEO is overtly suggestive (bedroom/lingerie/implied-nude), the caption must NOT add suggestive language on top. Let the visual carry it; steer toward an innocent-undercut, a clean incomplete-thought, or a single emoji. Doubling down (suggestive words + suggestive video) is the real reach-killer.

BAN-LIST — AI-TELLS (reject and rewrite shorter/more specific/more offhand):
- Influencer cliches: "living my best life", "main character energy", "it's giving ___", "serving", "obsessed", "slay/queen/iconic", "love you to the moon and back", "just another day in paradise".
- Banned template CADENCES (reject the SHAPE even if no single word is banned): "___ loading", "___ fixes everything", "___ szn", "made for me/this", "obsessed with ___", "___ but make it ___", "___ era", "the ___ we all deserve" (generic).
- Dead openers as formula: "When you...", "POV:", "Caption this", "Tag someone who...".
- Engagement-bait: "drop a fire if...", "like if you agree", "double tap if...", "comment below".
- Inspiration-porn / generic vagueness: "be yourself", "stay positive", "live laugh love", "good vibes only", unattached motivational quotes, "soulmate/ride or die/better half", or any caption with zero specificity to THIS clip.
- Format tells: 3+ emojis, repeated identical emoji sequences, emoji-text-emoji-text rhythm, hashtag walls, ALL-CAPS.

SPECIFICITY TEST (for any mood/soft caption): it must name a concrete thing (place, object, body sensation). If the line could caption ANY beach/sunset/outfit photo on earth, it's inspiration-porn — rewrite it concrete.

FINAL CHECK before returning each option:
1) Drop the period unless it's a real question. 2) Second-clause cut applied. 3) 0-2 safe emojis at end (or none). 4) Passes unsafe words/emojis. 5) Passes image-pairing rule. 6) Passes AI-tells + banned cadences. 7) Mood captions pass specificity. 8) No ALL-CAPS. 9) "Would a real, slightly-witty 22-year-old actually text this?" If it sounds like a brand or an AI, rewrite.

Return your options via the submit_captions tool. Also set best_index to the ONE option that should auto-post: the strongest funnel caption that centers HER, not a prop/pet/joke and not the blandest-safest line.`

// Gemini function-calling tool — forces structured output (matches playbook §C).
const SUBMIT_CAPTIONS_TOOL = {
  name: 'submit_captions',
  description: 'Submit the 3 caption options for this reel.',
  parameters: {
    type: 'object',
    properties: {
      observed: { type: 'string', description: '1-2 sentence read of the reel: scene, vibe, suggestiveness, whether on-screen text was used.' },
      suggestive_clip: { type: 'boolean', description: 'Your own read: is the video overtly suggestive (bedroom/lingerie/implied-nude)? If true, every caption must obey the image-pairing rule.' },
      best_index: { type: 'integer', description: '0-based index into captions[] of the SINGLE best option to auto-post: the one that most centers HER (her desirability/personality/intrigue) and serves the follow→bio funnel, NOT the one that is most about a prop/pet/joke. This is the one that gets posted with no human in the loop, so pick the strongest funnel caption, not the safest filler.' },
      captions: {
        type: 'array',
        description: 'The requested number of caption options (default 5), varied in type and length.',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The caption exactly as it should be posted (including any end emoji).' },
            type: { type: 'string', enum: ['echo', 'incomplete', 'witty', 'question', 'mood', 'cta', 'single_emoji'] },
            length: { type: 'string', enum: ['emoji', 'oneliner', 'sentence'] },
            emoji_count: { type: 'integer', description: '0-2, must match the actual emojis in text.' },
            echoes_onscreen: { type: 'boolean' },
            why: { type: 'string', description: 'One short line on why it lands in voice / what twist it uses.' },
          },
          required: ['text', 'type', 'length', 'emoji_count', 'echoes_onscreen', 'why'],
        },
      },
    },
    required: ['observed', 'suggestive_clip', 'best_index', 'captions'],
  },
}

async function fetchVideoBuffer(videoUrl) {
  const res = await fetch(videoUrl, { redirect: 'follow' })
  if (!res.ok) throw new Error(`Video fetch failed: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > 200 * 1024 * 1024) {
    throw new Error(`Video too large (${(buf.length / 1024 / 1024).toFixed(1)}MB).`)
  }
  return buf
}

// Upload a large video to Gemini's Files API (handles up to 2GB; avoids the ~20MB
// inline-request cap), wait until it's processed (ACTIVE), and return its fileUri.
async function uploadViaFilesApi(buffer, mimeType, apiKey) {
  const base = 'https://generativelanguage.googleapis.com'
  const start = await fetch(`${base}/upload/v1beta/files?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(buffer.length),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: 'reel' } }),
  })
  const uploadUrl = start.headers.get('x-goog-upload-url')
  if (!uploadUrl) throw new Error('Files API: no upload URL')
  const up = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize', 'Content-Length': String(buffer.length) },
    body: buffer,
  })
  let file = (await up.json()).file
  if (!file?.name) throw new Error('Files API: upload failed')
  for (let i = 0; i < 40 && file.state === 'PROCESSING'; i++) {   // wait for processing
    await new Promise(r => setTimeout(r, 1500))
    file = await fetch(`${base}/v1beta/${file.name}?key=${apiKey}`).then(r => r.json())
  }
  if (file.state !== 'ACTIVE') throw new Error(`Files API: video not ready (${file.state || 'unknown'})`)
  return file.uri
}

// Build the video content-part: inline for small clips, Files API for big ones.
async function prepareVideoPart(videoUrl, apiKey) {
  const buf = await fetchVideoBuffer(videoUrl)
  const mimeType = videoUrl.toLowerCase().includes('.mov') ? 'video/quicktime' : 'video/mp4'
  if (buf.length <= 18 * 1024 * 1024) {
    return { inlineData: { mimeType, data: buf.toString('base64') } }
  }
  const fileUri = await uploadViaFilesApi(buf, mimeType, apiKey)
  return { fileData: { mimeType, fileUri } }
}

/**
 * Generate 3 IG caption options for a reel by feeding the full video to Gemini 3 Flash.
 * @param {object} opts
 * @param {string} opts.videoUrl     - direct URL to the reel (Dropbox raw / CF Stream mp4 / Airtable attachment)
 * @param {string} [opts.onScreenText] - text burned into the reel (may be empty)
 * @param {string} [opts.creatorNotes] - creator niche / brand markers / voice notes (may be empty)
 * @returns {Promise<{ observed:string, suggestive_clip:boolean, captions:Array, model:string }>}
 */
export async function generateCaptions({ videoUrl, onScreenText = '', creatorNotes = '', count = 5 }) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set')
  if (!videoUrl) throw new Error('videoUrl required')

  const videoPart = await prepareVideoPart(videoUrl, apiKey)

  const contextText = [
    onScreenText ? `ON-SCREEN TEXT: ${onScreenText}` : 'ON-SCREEN TEXT: (none)',
    creatorNotes ? `CREATOR NOTES: ${creatorNotes}` : 'CREATOR NOTES: (none)',
    `Watch the full reel, then submit exactly ${count} caption options via the submit_captions tool.`,
  ].join('\n')

  const requestBody = {
    systemInstruction: { parts: [{ text: CAPTION_SYSTEM_PROMPT }] },
    contents: [{
      role: 'user',
      parts: [
        videoPart,
        { text: contextText },
      ],
    }],
    tools: [{ functionDeclarations: [SUBMIT_CAPTIONS_TOOL] }],
    toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['submit_captions'] } },
    // Full resolution for captions — they need the visual detail to stay SPECIFIC
    // (medium made them generic). The thumbnail call keeps medium; it doesn't need detail.
    generationConfig: { temperature: 1.0 },
    // Relax safety so Gemini will FRANKLY analyze legal adult/suggestive creator
    // content (bikini, lingerie, implied nudity, suggestive scenarios) instead of
    // sanitizing or refusing — otherwise spicy reels get a useless soft read.
    // (Gemini still absolutely refuses illegal content regardless of these.)
    safetySettings: [
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  }

  const args = await runWithFallback(requestBody, 'submit_captions')
  const captions = (Array.isArray(args.captions) ? args.captions : []).slice(0, 5) // hard cap at 5
  if (!captions.length) throw new Error('No captions returned')
  // Auto-pick index: the model's self-ranked best, clamped into range. Falls
  // back to 0 if it returned a bad/out-of-range index. `best` is the convenience
  // caption Penny auto-applies without a human in the loop.
  let bestIndex = Number.isInteger(args.best_index) ? args.best_index : 0
  if (bestIndex < 0 || bestIndex >= captions.length) bestIndex = 0
  const u = args.__usage || {}
  const promptTokens = u.promptTokenCount || 0
  const outputTokens = u.candidatesTokenCount || 0
  const estCost = promptTokens / 1e6 * PRICE_IN_PER_M + outputTokens / 1e6 * PRICE_OUT_PER_M
  return {
    observed: args.observed || '',
    suggestive_clip: !!args.suggestive_clip,
    captions,
    bestIndex,
    best: captions[bestIndex],
    model: args.__model || '',
    usage: { promptTokens, outputTokens, totalTokens: u.totalTokenCount || promptTokens + outputTokens, estCost },
  }
}

// ---- Thumbnail frame picker -------------------------------------------------

const THUMBNAIL_SYSTEM_PROMPT = `You pick the single best COVER THUMBNAIL frame for an Instagram post by an OnlyFans creator. You are watching the full reel.

The thumbnail must:
- Show the CREATOR (the woman) clearly and flatteringly — her face and/or body visible, looking good. NOT random b-roll, NOT inserted stock/internet footage (e.g. pets, memes, screen recordings), NOT a plain text card or a mid-cut transition frame.
- Be Instagram-reach-safe: NO nudity, no visible nipples or genitals, nothing that would get the post marked sensitive, demoted, or removed. Tasteful and suggestive is fine (bikini, lingerie, implied) as long as it would NOT be flagged on a public IG feed.
- Be sharp — not motion-blurred, not mid-blink, not a frozen weird expression.

Return THREE timestamps of genuinely DIFFERENT good frames — different poses/compositions, spread out across the reel and at least ~1.5 seconds apart. Do NOT return three timestamps bunched at the same moment, and do NOT just return the opening. AVOID the first ~0.5 second of the reel (the opening is usually a settling or blurry frame) unless it is honestly the only good shot. Put your favourite in best_timestamp_seconds and two other DISTINCT moments in backup_timestamps. Also return reel_duration_seconds (the total length of the reel) so we can sanity-check the spread.

If the ENTIRE reel is too risqué for Instagram — there is genuinely no safe, flattering frame of her — set too_risque=true and leave the timestamps null. We will then leave the thumbnail blank and let the creator's thumbnail gallery fill it instead.

Submit via the submit_thumbnail tool.`

const SUBMIT_THUMBNAIL_TOOL = {
  name: 'submit_thumbnail',
  description: 'Submit the best thumbnail timestamp(s) for this reel, or flag it as too risqué.',
  parameters: {
    type: 'object',
    properties: {
      too_risque: { type: 'boolean', description: 'True if the whole reel is too explicit for IG — no safe frame exists. Then leave timestamps null.' },
      best_timestamp_seconds: { type: 'number', description: 'Seconds into the reel of the best IG-safe, flattering frame of the creator. Null if too_risque.' },
      backup_timestamps: { type: 'array', items: { type: 'number' }, description: 'Exactly 2 backup timestamps (seconds) of DISTINCT, different moments — spread out, at least ~1.5s from each other and from the best one.' },
      reel_duration_seconds: { type: 'number', description: 'Total length of the reel in seconds.' },
      reason: { type: 'string', description: 'One short line on why this frame (or why too risqué).' },
    },
    required: ['too_risque', 'reason'],
  },
}

/**
 * Pick the best IG-safe thumbnail timestamp(s) from a reel via Gemini.
 * @returns {Promise<{ tooRisque:boolean, best:number|null, backups:number[], reason:string, model:string }>}
 */
export async function suggestThumbnail({ videoUrl }) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set')
  if (!videoUrl) throw new Error('videoUrl required')

  const videoPart = await prepareVideoPart(videoUrl, apiKey)

  const requestBody = {
    systemInstruction: { parts: [{ text: THUMBNAIL_SYSTEM_PROMPT }] },
    contents: [{
      role: 'user',
      parts: [
        // Sample at 3 fps so Gemini's timestamp resolution is sub-second (default
        // 1 fps would only let it point at the right whole second).
        { ...videoPart, videoMetadata: { fps: 3 } },
        { text: 'Watch the full reel and submit the best IG-safe thumbnail timestamp via the submit_thumbnail tool.' },
      ],
    }],
    tools: [{ functionDeclarations: [SUBMIT_THUMBNAIL_TOOL] }],
    toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['submit_thumbnail'] } },
    generationConfig: { mediaResolution: 'MEDIA_RESOLUTION_MEDIUM' }, // cheaper + faster, still enough to judge frames
    safetySettings: [
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  }

  const args = await runWithFallback(requestBody, 'submit_thumbnail')
  return {
    tooRisque: !!args.too_risque,
    best: args.too_risque ? null : (typeof args.best_timestamp_seconds === 'number' ? args.best_timestamp_seconds : null),
    backups: Array.isArray(args.backup_timestamps) ? args.backup_timestamps.filter(n => typeof n === 'number') : [],
    duration: typeof args.reel_duration_seconds === 'number' ? args.reel_duration_seconds : null,
    reason: args.reason || '',
    model: args.__model || '',
  }
}

// ---- shared Gemini caller (retry + model fallback) --------------------------

async function runWithFallback(requestBody, toolName = 'submit_captions') {
  const apiKey = process.env.GEMINI_API_KEY

  async function tryModel(model) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) }
    )
    const data = await res.json()
    if (!res.ok) {
      const msg = data?.error?.message || `Gemini ${res.status}`
      const err = new Error(msg)
      err.modelNotFound = res.status === 404 || /not found|not supported|unknown|does not exist/i.test(msg)
      err.transient = res.status === 429 || res.status === 503 || /high demand|overloaded|unavailable|try again|resource exhausted|temporarily/i.test(msg)
      throw err
    }
    const cand = data.candidates?.[0]
    if (data.promptFeedback?.blockReason || cand?.finishReason === 'SAFETY') {
      throw new Error('Gemini blocked this reel as too explicit to analyze, even with relaxed safety.')
    }
    const fnCall = (cand?.content?.parts || []).find(p => p.functionCall)?.functionCall
    if (!fnCall || fnCall.name !== toolName) throw new Error('Gemini did not return a result via the tool')
    const out = fnCall.args || {}
    out.__model = model
    out.__usage = data.usageMetadata || {}
    return out
  }

  // ALWAYS use the configured model (gemini-3-flash) — never downgrade to 2.5.
  // Retry transient overloads ("high demand" / 503 / 429) harder; if it stays busy,
  // surface the error so you can just retry rather than get weaker output.
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  let lastErr
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await tryModel(GEMINI_MODEL)
    } catch (e) {
      lastErr = e
      if (!e.transient) throw e                              // hard error — surface immediately
      if (attempt < 4) await sleep(700 * (attempt + 1))      // 0.7s, 1.4s, 2.1s, 2.8s backoff
    }
  }
  throw lastErr
}
