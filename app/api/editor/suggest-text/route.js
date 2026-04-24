import { NextResponse } from 'next/server'
import { requireAdminOrEditor, fetchAirtableRecords } from '@/lib/adminAuth'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import ffmpegStatic from 'ffmpeg-static'
import { writeFile, readFile, unlink, stat } from 'fs/promises'
import { execFile } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function rawDropboxUrl(url) {
  if (!url) return ''
  const clean = url.replace(/[?&]dl=0/, '').replace(/[?&]raw=1/, '')
  return clean + (clean.includes('?') ? '&raw=1' : '?raw=1')
}

function runFfmpeg(args, outputPath) {
  return new Promise((resolve) => {
    execFile(ffmpegStatic, args, { timeout: 25000 }, async (err, _stdout, stderr) => {
      const s = await stat(outputPath).catch(() => null)
      resolve({ ok: !!s && s.size > 0, size: s?.size || 0, err, stderr: stderr || '' })
    })
  })
}

// Probe video duration in seconds using ffmpeg's metadata output
function probeDuration(inputPath) {
  return new Promise((resolve) => {
    execFile(ffmpegStatic, ['-i', inputPath], { timeout: 10000 }, (_err, _stdout, stderr) => {
      const m = (stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
      if (!m) return resolve(null)
      const [, h, mm, s] = m
      resolve(Number(h) * 3600 + Number(mm) * 60 + Number(s))
    })
  })
}

// Download a Dropbox video and extract N frames evenly spaced across the clip.
// Returns an array of JPEG buffers with their timestamps.
async function extractFramesFromVideo(videoUrl, frameCount = 5) {
  const id = Date.now()
  const inputPath = join(tmpdir(), `suggest_in_${id}.mp4`)
  try {
    const rawUrl = rawDropboxUrl(videoUrl)
    const dlRes = await fetch(rawUrl, { redirect: 'follow' })
    if (!dlRes.ok) throw new Error(`video download failed: ${dlRes.status}`)
    const ct = dlRes.headers.get('content-type') || ''
    const videoBuffer = Buffer.from(await dlRes.arrayBuffer())
    const head = videoBuffer.slice(0, 100).toString('utf8')
    if (ct.includes('text/html') || head.includes('<!DOCTYPE html') || head.includes('<html')) {
      throw new Error('Dropbox returned HTML instead of video — share link may not be public')
    }
    await writeFile(inputPath, videoBuffer)

    // Probe duration; fall back to 10s if unknown
    const duration = (await probeDuration(inputPath)) || 10

    // Evenly spaced timestamps — skip the very first and last 0.3s to avoid black frames
    const pad = Math.min(0.3, duration * 0.05)
    const usable = Math.max(0.1, duration - pad * 2)
    const timestamps = []
    for (let i = 0; i < frameCount; i++) {
      const t = pad + (usable * i) / Math.max(1, frameCount - 1)
      timestamps.push(Math.round(t * 100) / 100)
    }

    const frames = []
    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i]
      const outputPath = join(tmpdir(), `suggest_out_${id}_${i}.jpg`)
      try {
        // Output-seek is fastest and good enough here
        const args = ['-y', '-ss', String(ts), '-i', inputPath, '-frames:v', '1', '-update', '1', '-q:v', '2', outputPath]
        const r = await runFfmpeg(args, outputPath)
        if (r.ok) {
          frames.push({ timestamp: ts, buffer: await readFile(outputPath) })
        } else {
          // Try input-seek fallback
          const args2 = ['-y', '-i', inputPath, '-ss', String(ts), '-frames:v', '1', '-update', '1', '-q:v', '2', outputPath]
          const r2 = await runFfmpeg(args2, outputPath)
          if (r2.ok) frames.push({ timestamp: ts, buffer: await readFile(outputPath) })
        }
      } finally {
        await unlink(outputPath).catch(() => {})
      }
    }

    if (frames.length === 0) throw new Error('ffmpeg produced no frames')
    return { frames, duration }
  } finally {
    await unlink(inputPath).catch(() => {})
  }
}

const PALM_CREATORS_TABLE = 'tbls2so6pHGbU4Uhh'

const TONE_LEVELS = {
  subtle: {
    label: 'Subtle',
    heat: 1,
    desc: 'Flirty but very implicit. No sexual undertone. Could post on a professional account.',
    examples: [
      '"19 btw"',
      '"honestly, maybe the chapter you\'re most afraid of will be your favorite one"',
      '"can you guess my age?"',
    ],
  },
  flirty: {
    label: 'Flirty',
    heat: 2,
    desc: 'Clearly flirty — playful, cheeky, a little naughty. Innuendo only. No body parts, no acts.',
    examples: [
      '"Being just friends is boring #LetsMakeout"',
      '"ik what he wants.. I just act clueless"',
      '"When he gives me that look that says \'just wait until we\'re alone\' >>>"',
      '"Me: Nothing gives me butterflies / Guy turning my face towards him to kiss me*"',
    ],
  },
  suggestive: {
    label: 'Suggestive',
    heat: 3,
    desc: 'Bold sexual implication — obvious what she means. References body parts / acts via emoji substitute (🐱🍆🍑💦). Never literal explicit words.',
    examples: [
      '"Your hands have no idea how much I need them on me rn"',
      '"I need a big boy"',
      '"he had the AUDACITY to say \'I\'d hit that\'"',
      '"ik what he wants.. I just act clueless bc I love when he puts me in my place"',
      '"head empty, just thinking about what he does with that 🍆"',
    ],
  },
  spicy: {
    label: 'Spicy',
    heat: 4,
    desc: 'MAXIMUM HEAT for top-of-funnel. Unambiguously sexual. Reference sex acts, body parts, arousal — always via emoji substitute, never literal. Push as far as the platform allows. If it wouldn\'t get flagged on IG/TikTok, go harder.',
    examples: [
      '"this man 🍆 in me now he\'s bone smashing? whatever that means 😭"',
      '"he eats my 🐱 like it owes him money"',
      '"when he finds out how well i take 🍆"',
      '"i was built to be pinned down fr"',
      '"head game lethal on god 👅"',
      '"ride or 🍆 die"',
      '"he said wyd... crawling in his bed that\'s wyd 🫦"',
    ],
  },
}

// Gold examples curated from the top-performing approved reels per mode.
// Each: text = actual on-screen text, why = one-line note on the pattern that made it work.
// These replace dynamic Airtable retrieval — voice is stable + prompt caching works.
const MODE_BRIEFS = {
  'Scenario / Fantasy': {
    summary: 'Text places the viewer into a specific situation or fantasy. The visual alone is generic — the text creates the whole concept.',
    rules: [
      'Use POV framing or "when he/you/we…" setups',
      'Create a forbidden, flirty, or wish-fulfillment scenario the viewer is placed into',
      'Text should work even on a simple visual — the situation is what stops the scroll',
    ],
    goldExamples: [
      { text: '"need a big boy."', why: 'Gym/body check-in + flat declarative = size/preference joke. Horny in 3 words.' },
      { text: '"When you want to be restrained and edged til you cry but you gotta act cool and mysterious"', why: 'Composed visual + absurdly specific sexual desire = mismatch humor. Works because the fantasy is blunt but she\'s poised.' },
      { text: '"POV: Wife cancelled dinner but the girl next door was free"', why: 'Places viewer in a cheating fantasy. The girl on screen IS the "girl next door" being cast.' },
      { text: '"Ik what he wants.. I just act clueless bc I love when he puts me in my place"', why: 'Submissive confession-style line. Works as a skit (not lip sync) — her face sells the "acting clueless" beat.' },
      { text: '"When he likes another girl\'s post so I show him exactly why others like mine"', why: 'Toxic-girlfriend clapback. The clip IS the proof she\'s showing off.' },
      { text: '"Let me be the reason you forget your ex"', why: 'Direct-offer-to-viewer. Short, confident, flips to wish-fulfillment.' },
      { text: '"POV: men are visual"', why: 'Two-word lampshade. Turns a straight thirst trap into a male-gaze joke the viewer is in on.' },
    ],
  },

  'Controversy / Opinion': {
    summary: 'Text makes a bold claim or hot take that people argue about in the comments. The video is a pretty girl — the text is the engagement driver.',
    rules: [
      'Make a provocative claim, ranking, or opinion that invites disagreement',
      'Should work on any thirst-trap-style visual — visual is the credibility, text is the bait',
      'Short, declarative, confident. No hedging.',
    ],
    goldExamples: [
      { text: '"My ex said that anything more than a handful is just a waste"', why: 'Ex-clapback opinion-bait. Chest visibly disproves the claim — comment section argues.' },
      { text: '"Being just friends is boring #LetsMakeout"', why: 'Rejects a polite premise with horny punchline.' },
      { text: '"Me toxic? I\'m only ragebaiting you bc you look hot when you\'re mad"', why: 'Self-aware toxic flex. She admits to being the problem and makes it his fault for being hot.' },
      { text: '"Getting blocked or removed by a man is funny asf.. like awn did I make u mad princess?"', why: 'Petty clapback with dead-eyed smug delivery. "Princess" flips the script.' },
      { text: '"I could behave.. but where\'s the fun in that"', why: 'Bratty non-apology. Implies sexual mischief without naming it.' },
    ],
  },

  'Relationship / Conversation': {
    summary: 'Text styled as a conversation — quoted lines, him-vs-me dialogue, iMessage back-and-forth. The format itself is part of the concept.',
    rules: [
      'Use quoted dialogue format or "him: / me:" structure',
      'The comeback/second line should land something flirty, sharp, or unexpected',
      'Feel spontaneous and real, not scripted',
    ],
    goldExamples: [
      { text: '"Me: Nothing gives me butterflies / Guy turning my face towards him to kiss me*"', why: 'Self-setup + action line (the * is stage direction). Creates an imagined intimate moment.' },
      { text: '""You guys would make such a cute couple" / "Nah we are just friends""', why: 'Fake-quote social-scenario bait. Viewer reads it as obvious attraction being denied.' },
      { text: '""I like your fit" / Bet, take it off me then"', why: 'Compliment flipped into sexual comeback. Two lines max.' },
      { text: '"Babe can you come crack my back please / crack my back please no"', why: 'Domestic request that accidentally sounds dirty — the repeat delivery makes it absurd.' },
    ],
  },

  'Visual Callout': {
    summary: 'Text directly references or amplifies what\'s on screen. The visual works alone, but the text adds a flirty or provocative spin.',
    rules: [
      'Reference a specific element visible in THIS clip (body part, outfit, setting, prop, activity)',
      'Turn the literal visual into something suggestive or funny',
      'Short, punchy. No generic captions that could apply anywhere.',
    ],
    goldExamples: [
      { text: '"19 btw"', why: 'Pure age-bait. Two words, ties the body to a number.' },
      { text: '"19 🇺🇸 120lbs"', why: 'Stat-line format. Reads like a dating-app bio, weaponized.' },
      { text: '"Do you want sugar or"', why: 'Kitchen prop (sugar) → blatant "sugar" double entendre. Trails off on purpose.' },
      { text: '"What colour is the chair?"', why: 'Asks about the object nobody is looking at. Frames the viewer for staring at her instead.' },
      { text: '"The cutest little sausage dog 💕"', why: 'Caption draws attention to a pet while the low angle serves the body. Bait-and-switch.' },
      { text: '"Not sure why he insists on keeping the blanket all the way down here..."', why: 'Calls out the visible ass-exposure while pretending not to understand.' },
    ],
  },

  'Relatable / Lifestyle': {
    summary: 'Relatable moment, routine caption, lifestyle statement, or engagement question. Makes viewers nod, comment, or tag a friend.',
    rules: [
      'Casual, conversational, not performative',
      'Can be a direct question to the viewer (engagement farming)',
      'Feels like a real thought, not copy',
    ],
    goldExamples: [
      { text: '"Are you the voices? bc I can\'t get you out of my head (Down bad rizz)"', why: 'Self-deprecating-flirt rizz line. "(Down bad rizz)" is the meta-label that makes it work.' },
      { text: '"Tbh I don\'t think i\'m ever gonna get over this one"', why: 'Sad-baddie intimate face card line. Works on any lip-sync to breakup audio.' },
      { text: '"Can you guess my age?"', why: 'Engagement-farming direct question. Body answers while text asks.' },
      { text: '"Am I doing it right?"', why: 'Fake-incompetent sexual move, self-aware delivery. Works on any tease that\'s mid-move.' },
      { text: '"Am I chopped? Be honest"', why: 'Asks-for-compliments opinion bait. Invites every comment to be a "no way queen".' },
    ],
  },

  'Mood / Reflective': {
    summary: 'Reflective, philosophical, or emotional statement paired with a generic pretty-girl visual. The caption gives the reel substance while the body stops the scroll.',
    rules: [
      'Introspective, quote-like, emotionally resonant',
      'Feels like a private thought said out loud — not preachy, not affirmation-Pinterest',
      'Should work on a walking/posing/candid-feeling shot',
    ],
    goldExamples: [
      { text: '"honestly, maybe the chapter you\'re most afraid of will be your favorite one."', why: 'Soft reflective line dropped over a body-forward walk — the mix is the whole point.' },
    ],
  },
}

export async function POST(request) {
  try {
    await requireAdminOrEditor()
  } catch (res) {
    return res
  }

  try {
    const body = await request.json()
    const {
      thumbnailUrl,
      videoUrl,
      mode,
      creatorId,
      count = 5,
      cachedFrames,
      cachedDescription,
      tone = 'flirty',
      engine = 'openai', // 'openai' | 'claude'
    } = body

    if (!mode) {
      return NextResponse.json({ error: 'mode required' }, { status: 400 })
    }
    if (!thumbnailUrl && !videoUrl && !(cachedFrames && cachedFrames.length) && !cachedDescription) {
      return NextResponse.json({ error: 'thumbnailUrl, videoUrl, cachedFrames, or cachedDescription required' }, { status: 400 })
    }

    const brief = MODE_BRIEFS[mode]
    if (!brief) {
      return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 })
    }

    const toneBrief = TONE_LEVELS[tone] || TONE_LEVELS.flirty
    const hasCachedDescription = !!cachedDescription

    // Resolve the image source to feed OpenAI
    // 1. If caller provided thumbnailUrl (direct image URL or data URL), use it
    // 2. Otherwise extract a frame from the Dropbox video via their thumbnail API
    // Collect target frames (only when we don't already have a text description).
    // Priority: cachedDescription > cachedFrames > thumbnailUrl > videoUrl
    let targetFrames = [] // [{ timestamp, dataUrl }]
    let videoDuration = body.videoDuration || null
    if (!hasCachedDescription) {
      if (cachedFrames && cachedFrames.length) {
        targetFrames = cachedFrames
      } else if (thumbnailUrl) {
        targetFrames = [{ timestamp: 0, dataUrl: thumbnailUrl }]
      } else if (videoUrl) {
        try {
          const { frames, duration } = await extractFramesFromVideo(videoUrl, 3)
          videoDuration = duration
          targetFrames = frames.map(f => ({
            timestamp: f.timestamp,
            dataUrl: `data:image/jpeg;base64,${f.buffer.toString('base64')}`,
          }))
        } catch (e) {
          console.warn('[suggest-text] frame extract failed:', e.message)
          return NextResponse.json({
            error: `Could not extract frames from the video: ${e.message}`,
          }, { status: 400 })
        }
      }

      if (targetFrames.length === 0) {
        return NextResponse.json({ error: 'no frames available to analyze' }, { status: 400 })
      }
    }

    // Training examples are now baked into MODE_BRIEFS[mode].goldExamples —
    // no more Airtable fetch per call, no more thumbnail images. Text-only,
    // hand-curated examples that give the model stable voice signal.
    const goldExamples = brief.goldExamples || []

    // Optionally fetch creator DNA
    let creatorContext = ''
    if (creatorId) {
      try {
        const creatorRecs = await fetchAirtableRecords(PALM_CREATORS_TABLE, {
          filterByFormula: `RECORD_ID()='${creatorId}'`,
          fields: ['AKA', 'Creator Profile', 'Top Tags'],
          maxRecords: 1,
        })
        if (creatorRecs[0]) {
          const f = creatorRecs[0].fields
          const aka = f['AKA'] || 'the creator'
          const profile = (f['Creator Profile'] || '').slice(0, 1200)
          const topTags = (f['Top Tags'] || []).slice(0, 10).join(', ')
          creatorContext = `\n\nCreator: ${aka}\nTop tags: ${topTags}\nProfile summary: ${profile}`
        }
      } catch (e) {
        console.warn('[suggest-text] Failed to fetch creator DNA:', e.message)
      }
    }

    // Build the system prompt with gold examples baked in
    const goldExamplesBlock = goldExamples.length
      ? `\n\nGOLD EXAMPLES FOR "${mode}" (these are real reels that worked — match this voice):\n${goldExamples.map((ex, i) => `${i + 1}. ${ex.text}\n   → WHY IT WORKS: ${ex.why}`).join('\n\n')}`
      : ''

    const systemPrompt = `You are writing on-screen text captions for OnlyFans creators' Instagram/TikTok reels. Top-of-funnel public content: stop the scroll, create curiosity or attraction, funnel to follow/subscribe.

MODE: ${mode}
${brief.summary}

RULES FOR THIS MODE:
${brief.rules.map(r => `- ${r}`).join('\n')}
${goldExamplesBlock}

VOICE — THIS IS THE HARDEST PART. READ CAREFULLY.
The text must sound like a real 20-something internet girl actually wrote it — NOT like a marketing copywriter. Read it out loud: if it sounds like something a brand account would post, throw it out.

Real girls sound:
- Confident and a little bratty — "Me toxic? I'm only ragebaiting you bc you look hot when you're mad"
- Casual with lowercase and abbreviations — "ik what he wants.. I just act clueless bc I love when he puts me in my place"
- Specific and cheeky — "Getting blocked or removed by a man is funny asf.. like awn did I make u mad princess?"
- Playful, not polished — "Let me be the reason you forget your ex"

AI-sounding captions (NEVER write these):
- "When staying in becomes the main event" ← vague corporate-influencer speak
- "When you dress down but the mood's still extra" ← generic word salad
- "When you know his heart can't handle this outfit" ← corny, reads like Pinterest
- "When your gym playlist hits and so do you 💪🎵" ← emoji-stuffed, formulaic

TONE LEVEL: ${toneBrief.label.toUpperCase()} (heat ${toneBrief.heat}/4)
${toneBrief.desc}

EXAMPLES AT THIS TONE (match this heat level — don't go softer):
${toneBrief.examples.map(e => `  ${e}`).join('\n')}

${toneBrief.heat >= 3 ? 'IMPORTANT: The user explicitly picked heat level ' + toneBrief.heat + '. Sanitized "safe" suggestions are a FAILURE at this tone. Be as bold as the example captions above. Emoji substitutes for explicit words are expected and encouraged.' : ''}

EMOJI RULES (strict):
- MAXIMUM ONE emoji per caption. Zero is usually better.
- NEVER decorate with emoji (no 💪🎵🔥✨💖 at the end of sentences for vibes).
- Only use an emoji when it REPLACES an explicit word the caption needs to imply:
    • 🐱 replaces "pussy"
    • 🍆 replaces "dick" / "cock"
    • 🍑 replaces "ass"
    • 💦 replaces "cum" / "wet"
    • 🫦 replaces "lips" / "mouth" in a sexual sense
    • 👅 replaces "tongue" in a sexual sense
- If the caption doesn't need to imply an explicit act/body-part, use NO emoji.

BANNED WORDS & PHRASES (never use):
- "vibe" / "vibes" / "energy" / "mood" as a standalone descriptor
- "main event" / "main character" / "the moment"
- "slay" / "queen" / "iconic" / "icon"
- "obsessed with myself" / "obsessed"
- "serving" / "giving" as flex adjective
- "eating" as flex (in the "she's eating" sense)
- "it's giving ___"
- Literal explicit words (pussy, dick, cock, cum, fuck, etc.) — use emoji substitute instead per rules above

Hard rules:
- No "When you ___" openers unless they land something unexpected. Avoid if they're just generic flex.
- Use lowercase, typos, abbreviations (u, ur, bc, asf, tbh, ngl, ik, idk) when it fits voice
- SPECIFICITY > VAGUENESS. "When he cancels plans but you look this cute" = generic. "Texting him 'u up?' at 11pm knowing he'll say yes" = specific.
- If the caption could work on 50 random reels, scrap it. It must be tied to THIS clip.

You will be shown: the target clip — ${hasCachedDescription ? 'as a text description from a prior analysis' : 'as multiple frames across the video'}${creatorContext ? ' — plus the creator\'s profile + DNA' : ''}.

Your job: generate ${count} distinct on-screen text suggestions for THIS specific clip. Match the gold examples' voice above, not generic influencer-speak.

CRITICAL — READ THE CLIP CAREFULLY BEFORE SUGGESTING:
Before writing any caption, describe the target clip in your head:
  - SETTING: where is she? (bedroom, bathroom, kitchen, car, outdoors, studio, mirror selfie) — look at walls, furniture, background, NOT just her clothes
  - OUTFIT: what is she wearing? (bikini, lingerie, activewear, dress, casual)
  - POSE / ACTION: what is she actually doing? (standing, posing, walking, dancing, sitting, filming herself)
  - ANGLE: selfie, mirror, tripod, someone else filming?
  - VIBE: what energy is she putting out? (sultry, cute, confident, candid, playful)

Do NOT assume setting from clothing. Activewear in a bedroom is NOT a gym.
Do NOT open with "POV:" unless the text genuinely places the viewer into a specific scenario.
Avoid emoji stacks (💪🎵🔥) unless one emoji meaningfully adds to the text.
Short and unexpected beats long and safe.

Output a JSON object with:
  - "observed": SHORT one-sentence summary of what the clip shows (shown to the user as "Saw: ...")
  - "clipDescription": DETAILED 3-5 sentence description of the clip covering setting/room details, outfit, pose and motion across frames, camera angle, expression/vibe, and any notable specific visual details. This will be cached and used to generate more captions without re-analyzing the video — be thorough enough that a writer could generate good captions from this description alone.
  - "suggestions": array of ${count} objects, each with:
      - "text": the on-screen text (1-3 short lines, exactly as it should appear)
      - "reasoning": one sentence on why this works for THIS specific clip

Do not copy the training example texts. Generate fresh ideas tailored to the target clip's visual.`

    const userContent = []

    // (Gold training examples are now in the system prompt — no per-call inject needed)

    // Target clip — use cached description (text-only, cheap) when available,
    // otherwise send multiple frames for OpenAI to actually analyze
    if (hasCachedDescription) {
      userContent.push({
        type: 'text',
        text: `\n---\nTARGET CLIP DESCRIPTION (from prior analysis):\n${cachedDescription}\n${videoDuration ? `Clip duration: ~${videoDuration.toFixed(1)}s.\n` : ''}${creatorContext}\n\nGenerate captions based on this description. The visuals have already been analyzed — trust the description above.`,
      })
    } else {
      userContent.push({
        type: 'text',
        text: `\n---\nNow here is the TARGET CLIP that needs ${count} text suggestions.${videoDuration ? ` Clip is ~${videoDuration.toFixed(1)}s long.` : ''} ${targetFrames.length} frames evenly spaced across the clip:${creatorContext}`,
      })
      targetFrames.forEach((f, i) => {
        userContent.push({
          type: 'text',
          text: `Frame ${i + 1} @ ${f.timestamp.toFixed(2)}s:`,
        })
        userContent.push({ type: 'image_url', image_url: { url: f.dataUrl, detail: 'high' } })
      })
    }

    userContent.push({
      type: 'text',
      text: hasCachedDescription
        ? `\nGenerate ${count} on-screen text suggestions for this clip based on the description above. Return JSON only.`
        : `\nRead the full sequence of frames to understand what the clip actually shows (motion, setting, outfit, pose). Generate ${count} on-screen text suggestions for the clip. Return JSON only.`,
    })

    // 4. Call the chosen engine (OpenAI or Claude)
    let raw = '{}'
    let usage = null
    let modelUsed = ''

    if (engine === 'claude') {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      modelUsed = 'claude-sonnet-4-6'
      // Convert OpenAI-shaped userContent to Anthropic-shaped content blocks
      const claudeContent = userContent.map(block => {
        if (block.type === 'text') return { type: 'text', text: block.text }
        if (block.type === 'image_url') {
          const url = block.image_url.url
          if (url.startsWith('data:')) {
            // data:image/jpeg;base64,XXXX
            const m = url.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/)
            if (m) {
              return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }
            }
          }
          return { type: 'image', source: { type: 'url', url } }
        }
        return block
      })

      const claudeResponse = await anthropic.messages.create({
        model: modelUsed,
        max_tokens: 2000,
        temperature: 1.0,
        system: systemPrompt + '\n\nIMPORTANT: Respond with ONLY a valid JSON object matching the schema above. No prose before or after.',
        messages: [{ role: 'user', content: claudeContent }],
      })
      const textBlock = claudeResponse.content.find(b => b.type === 'text')
      raw = textBlock?.text || '{}'
      // Claude sometimes wraps in ```json ... ``` — strip that
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
      usage = {
        input_tokens: claudeResponse.usage?.input_tokens,
        output_tokens: claudeResponse.usage?.output_tokens,
      }
    } else {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      modelUsed = 'gpt-4o'
      const completion = await openai.chat.completions.create({
        model: modelUsed,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 1.05,
      })
      raw = completion.choices[0]?.message?.content || '{}'
      usage = completion.usage
    }

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return NextResponse.json({ error: 'Failed to parse AI response', raw }, { status: 500 })
    }

    const suggestions = parsed.suggestions
      || parsed.captions
      || parsed.output?.suggestions
      || parsed.result?.suggestions
      || []

    return NextResponse.json({
      mode,
      tone,
      engine,
      model: modelUsed,
      observed: parsed.observed || null,
      clipDescription: parsed.clipDescription || cachedDescription || null,
      suggestions,
      trainingExampleCount: goldExamples.length,
      analyzedFrames: hasCachedDescription ? undefined : targetFrames,
      videoDuration,
      usedCache: hasCachedDescription,
      usage,
      rawResponse: suggestions.length === 0 ? parsed : undefined,
    })
  } catch (err) {
    console.error('[suggest-text] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
