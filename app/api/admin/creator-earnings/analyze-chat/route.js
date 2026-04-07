import { auth } from '@clerk/nextjs/server'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// ── Airtable ───────────────────────────────────────────────────────────────

const OPS_BASE = 'applLIT2t83plMqNx'
const FAN_ANALYSIS_TABLE = 'tblNMtOEg2AIzvLDK'
const AIRTABLE_HEADERS = { Authorization: `Bearer ${process.env.AIRTABLE_PAT}`, 'Content-Type': 'application/json' }

// Field IDs
const F = {
  fanName: 'fldaRJeys4CsOYLkU',
  ofUsername: 'fldbPgIn9KTUO02ev',
  creator: 'fld8LSL8nUbYg686Z',
  lifetimeSpend: 'fldCcOeorfk2pTMvy',
  currentGap: 'fldNSGbGXpWkE20KX',
  medianGap: 'fldB395m0qd7XEUgO',
  lastPurchase: 'fldPN6pgCwEihy6Qx',
  analysisType: 'fldOGE29iDhxZ6893',
  fullAnalysis: 'fldxqTBznWX86bvMH',
  managerBrief: 'fldXcc6Yj7qcxh2vT',
  messageCount: 'fldst7ql724cUi7Pi',
  fanMessages: 'fldz7Z7rae0ler6O0',
  creatorMessages: 'fldO1fc8EqZvWegkf',
  status: 'fldaG3E41OfKKtK2g',
  analyzedDate: 'fldamFzJZ9VPLNIOm',
}

async function saveToAirtable(record) {
  try {
    await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${FAN_ANALYSIS_TABLE}`, {
      method: 'POST',
      headers: AIRTABLE_HEADERS,
      body: JSON.stringify({ records: [{ fields: record }], typecast: true }),
    })
  } catch (e) {
    console.error('Failed to save analysis to Airtable:', e)
  }
}

// ── Parse OF chat HTML ─────────────────────────────────────────────────────

function parseChatHtml(html) {
  const messages = []

  // Extract date dividers
  const datePositions = []
  const dateRe = /b-chat__messages__time.*?title="([^"]+)"/g
  let dm
  while ((dm = dateRe.exec(html))) {
    datePositions.push({ pos: dm.index, date: dm[1] })
  }

  // Extract each message block
  const msgRe = /class="b-chat__message\s([^"]*?)"/g
  let mm
  while ((mm = msgRe.exec(html))) {
    const pos = mm.index
    const classes = mm[1]
    const block = html.slice(pos, pos + 5000)

    const isFromMe = classes.includes('m-from-me')
    const hasMedia = classes.includes('m-has-media')
    const isTip = classes.includes('m-tip')
    const isPrice = classes.includes('m-price')

    // Text content
    let text = ''
    const textMatch = block.match(/class="b-chat__message__text[^"]*"[^>]*>(.*?)<\/div>/s)
    if (textMatch) {
      text = textMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      // Decode HTML entities
      text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
    }

    // Media count
    const mediaMatch = block.match(/switcher-media-content__val-total">(\d+)/)
    const mediaCount = mediaMatch ? mediaMatch[1] : ''

    // Price
    let price = ''
    if (isPrice) {
      const priceMatch = block.match(/\$\s*([\d,.]+)/)
      if (priceMatch) price = priceMatch[1]
    }

    // Find date
    let msgDate = ''
    for (let i = datePositions.length - 1; i >= 0; i--) {
      if (datePositions[i].pos < pos) {
        msgDate = datePositions[i].date
        break
      }
    }

    const sender = isFromMe ? 'CREATOR' : 'FAN'
    let line = `[${sender}]`
    if (text) line += ` ${text}`
    if (hasMedia) line += mediaCount ? ` [media x${mediaCount}]` : ' [media]'
    if (isPrice && price) line += ` [PPV $${price}]`
    if (isTip) line += ' [TIP]'

    if (text || hasMedia || isTip) {
      messages.push({ date: msgDate, sender, line })
    }
  }

  // Format with date headers
  let currentDate = ''
  const lines = []
  for (const msg of messages) {
    if (msg.date && msg.date !== currentDate) {
      currentDate = msg.date
      lines.push(`\n--- ${msg.date} ---`)
    }
    lines.push(msg.line)
  }

  return {
    conversation: lines.join('\n'),
    messageCount: messages.length,
    fanMessages: messages.filter(m => m.sender === 'FAN').length,
    creatorMessages: messages.filter(m => m.sender === 'CREATOR').length,
  }
}

// ── GET (load existing analysis from Airtable) ────────────────────────────

export async function GET(request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const fan = searchParams.get('fan')
  const creator = searchParams.get('creator')
  if (!fan) return Response.json({ error: 'Missing fan param' }, { status: 400 })

  try {
    // Fetch most recent analysis for this fan+creator from Airtable
    const params = new URLSearchParams()
    params.set('maxRecords', '1')
    params.set('sort[0][field]', 'Analyzed Date')
    params.set('sort[0][direction]', 'desc')
    params.set('filterByFormula', `AND({Fan Name} = "${fan.replace(/"/g, '\\"')}"${creator ? `, {Creator} = "${creator.replace(/"/g, '\\"')}"` : ''})`)

    const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${FAN_ANALYSIS_TABLE}?${params}`, {
      headers: AIRTABLE_HEADERS, cache: 'no-store',
    })
    const data = await res.json()
    const rec = data.records?.[0]
    if (!rec) return Response.json({})

    const f = rec.fields || {}
    return Response.json({
      analysis: f['Full Analysis'] || '',
      managerBrief: f['Manager Brief'] || '',
      analysisType: f['Analysis Type']?.name === 'Deep Dive' ? 'deep' : 'quick',
      messageCount: f['Message Count'] || 0,
      fanMessages: f['Fan Messages'] || 0,
      creatorMessages: f['Creator Messages'] || 0,
      saved: true,
      loadedFrom: 'airtable',
      analyzedAt: f['Analyzed Date'] || '',
    })
  } catch (err) {
    console.error('Load analysis error:', err)
    return Response.json({})
  }
}

// ── POST ───────────────────────────────────────────────────────────────────

export async function POST(request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const formData = await request.formData()
    const file = formData.get('file')
    const fanName = formData.get('fanName') || 'Unknown'
    const lifetime = parseFloat(formData.get('lifetime')) || 0
    const medianGap = parseInt(formData.get('medianGap')) || 0
    const currentGap = parseInt(formData.get('currentGap')) || 0
    const rolling30 = parseFloat(formData.get('rolling30')) || 0
    const monthlyAvg90 = parseFloat(formData.get('monthlyAvg90')) || 0
    const creatorName = formData.get('creatorName') || 'the creator'

    if (!file) return Response.json({ error: 'No file uploaded' }, { status: 400 })

    const html = await file.text()
    const parsed = parseChatHtml(html)

    if (parsed.messageCount === 0) {
      return Response.json({ error: 'No messages found in the HTML file' }, { status: 400 })
    }

    // Scale analysis depth based on lifetime spend
    const isHighValue = lifetime >= 1000
    const analysisType = isHighValue ? 'deep' : 'quick'

    // Spending timeline (passed from frontend)
    const spendingTimeline = formData.get('spendingTimeline') || ''

    const spendingContext = `SPENDING DATA FOR THIS FAN:
- Lifetime spend: $${lifetime.toLocaleString()}
- Normal purchase cadence: every ${medianGap} days
- Current gap: ${currentGap} days since last purchase
- Last 30 days: $${rolling30.toLocaleString()} (vs their normal ~$${monthlyAvg90.toLocaleString()}/month)
- Creator name: ${creatorName}
${spendingTimeline ? `\nSPENDING HISTORY (use these dates to correlate with conversation moments — when spending was high, what was happening in the chat?):\n${spendingTimeline}` : ''}`

    // ── Example of a great analysis (few-shot calibration) ─────────────
    const exampleAnalysis = `EXAMPLE OF THE DEPTH AND SPECIFICITY EXPECTED:

This is an actual analysis of a fan named "Chucky" who spent $8,655 lifetime. Use this as your benchmark for quality, depth, and the level of specific evidence required.

---

**Fan Type**: Relationship/connection seeker with a submissive side. NOT quick gratification — despite some short horny messages, the deeper pattern shows a fan who roleplayed back with full paragraphs, used emotional language ("I want you to dream of me," "Always" when asked if he missed her, "Thank you i needed that"), and spent biggest during genuine connection moments, not cold content drops.

**Timeline**: Active Nov 15 – Jan 14. Last real engagement Jan 14 (roleplay + $886 session). One small purchase Jan 31 ($344). Then 50 days of silence with $265 one-off in March.

**The Turning Point**: The Jan 14 roleplay session. It was going well — genuine back-and-forth, step-brother fantasy he was clearly into. He was writing multi-sentence responses building the scene. Then mid-scene, a massive block of pre-written text got pasted in: "I'd stay close, not loosening that hold on you yet — making sure you feel the weight of what just happened..." This exact same paragraph had been used word-for-word on Dec 13. His response shifted from enthusiastic multi-sentence engagement to a one-word "Sure." Then immediately: "Can you do $180?" He paid — but "Sure" and "Ok" are the responses of someone checking out emotionally while completing a transaction. The illusion broke.

**What Drove His Spending**:
- Reciprocal roleplay sessions where she matched his energy. On Dec 13 he spent $1,172 during a session where both sides were writing full paragraphs. On Jan 14 he spent $886 during the step-brother scenario.
- Feeling special and chosen. He responded to personalized attention, not mass content.
- The domme/sub dynamic. He explicitly said "Yes goddess tell me what to do" and "I would be yours to control." He spent when he felt commanded.

**What Went Wrong**:
1. The copy-paste script was reused verbatim from Dec 13 to Jan 14. A fan who writes his own roleplay content notices recycled scripts.
2. PPV ask mid-roleplay broke immersion. "Can you do $180?" during an intimate scene turns connection into transaction.
3. 150+ unanswered mass messages from Feb-Apr. "CONGRATS!!! I chose you to gift my $100 worth MYSTERY PRESENT," "$5 bundle because the economy is bad" — for a fan who valued feeling special, being on a mass blast list is the opposite of what he wanted.
4. No genuine check-in after silence. Not a single message referenced their past conversations or acknowledged his absence personally.
5. Stated preferences were never tracked: taboo scenarios, dominance, moaning/audio. All subsequent messages were generic body content.

**Action Item**: One shot at re-engagement. Must be genuinely personal, referencing something only he would know:
"Hey Chucky... I know it's been a while. I was just thinking about that night you couldn't sleep and we ended up in that whole scenario together 😏 I still think about it. No pressure at all, but I miss actually talking with you. Hope you're good 💕"
NO PPV, NO bundle, NO media attached. If he responds, slow down, match his energy, let him lead. Don't push a sale for at least 2-3 exchanges.

DO NOT: Send any more mass messages. Do not send content. Do not use scripts. One personal message, wait 48 hours, one more attempt, then archive.

**Recovery Odds**: Low. He's been gone 50+ days and the trust was broken by script-pasting and mass blasts. But his lifetime spend ($8,655) makes one genuine attempt worth it.

---

---

EXAMPLE 2: A fan named "Vito" who spent $1,027 in 2 weeks — NOTHING WENT WRONG, budget issue:

**Fan Type**: Relationship seeker / Romantic connection. Vito is a 49-year-old single man from Copenhagen who found the creator through her art on Instagram. He writes long personal messages, shares life details, asks genuine questions, sends good morning messages daily, and treats this like a real relationship. He signs off with "Best regards Vito," talks about his cat, his concerts, his friends. NOT quick gratification.

**Timeline**: Subbed Mar 20. First conversation Mar 21. Spent every day Mar 21-28 ($734 in 8 days), then spending slowed to $40-70 every 2-3 days. Still actively chatting daily as of last message.

**The Turning Point**: There IS no turning point — Vito is still fully engaged. His spending slowed because he ran out of money. He said it explicitly: "I cant afford at the moment," "Its alot of money!!" "I do not have a ton off money," "Sorry I have to wait until pay day." He negotiates every PPV — $35→$25, $200→$140, $100→$60. His bank card had issues on Mar 31. The first week was honeymoon splurge that was never sustainable for him.

**What Drove His Spending**: The sexting sessions where both sides participated. He writes his own roleplay content, builds scenarios (jazz music, wine, massage, shower scenes). He spent $275 on Mar 28 during a long mutual session.

**What Went Wrong**:
1. Creator called him "Shawn" twice (his profile name). He corrected it on Mar 21 ("Call me Vito") but it happened again on Mar 27: "fuck me like you own me Shawn!" For a relationship fan, getting the wrong name is a major immersion break.
2. Same sexting script "Do you want me to bend over like this so you can doggy fuck me..." appeared 7+ times across the conversation. He stopped responding enthusiastically to it.
3. Quote-back pattern: the creator frequently quotes his messages with no actual response, then pivots to a PPV ask.
4. Mass messages ("CONGRATS!!! i chose you to gift my $100 worth MYSTERY PRESENT") landing alongside personal conversation.

**Action Item**: Vito is NOT going cold — he's just broke. Stop pushing paid content. Send a personal message about her art: "Hey Vito 💚 I just finished a new painting and I thought of you — you're the only one who actually cares about my art here. How's Copenhagen? Hope your cat's behaving 😘" NO PPV, NO bundles until after his payday.

DO NOT: Send any more PPV bundles or mass messages. Use his name correctly (Vito, never Shawn).

**Recovery Odds**: High — he's still chatting daily, sending good morning messages, sharing personal details. This is a budget issue, not a relationship issue.

---

THIS is the level of depth, specificity, and evidence you must match. Note:
- Every claim is backed by a specific quote or date
- Fan type is determined by analyzing the FULL conversation pattern, not surface-level messages
- The Vito example shows that sometimes NOTHING went wrong — be honest when that's the case
- Specific details like wrong names, repeated scripts, and quote-back patterns are called out`

    const systemPrompt = isHighValue
      ? `You are a senior OnlyFans chat strategist. You analyze conversations between creators and fans, cross-reference with spending data, and produce detailed analyses that the chatting team uses to save at-risk fans.

${spendingContext}

${exampleAnalysis}

NOW ANALYZE THE CONVERSATION BELOW WITH THE SAME DEPTH.

YOUR PROCESS:
1. Read the ENTIRE conversation. Don't just skim — look at how the fan communicates across different sessions. Short horny messages alone don't make someone "quick gratification" — look for roleplay participation, emotional language, reciprocity, stated preferences.
2. Cross-reference spending dates with conversation moments. Dates annotated with [💰 $X spent] show WHEN money was spent. Find those dates and identify what was happening in the chat. What type of interaction triggered the big sessions?
3. Identify the EXACT turning point where engagement or spending shifted. Quote the specific messages.

SPECIFIC PATTERNS TO DETECT (check for ALL of these):
- **Repeated scripts**: Scan for the SAME text block appearing 2+ times in the conversation. If you find one, count how many times it appears and note it explicitly. This is a major red flag for relationship-type fans.
- **Wrong name**: Check if the creator ever calls the fan by the wrong name (e.g. using their profile username instead of their stated real name). Fans who share their real name and then get called by the wrong one feel the interaction is fake.
- **Quote-back pattern**: Creator quotes the fan's message (marked with ") but doesn't actually respond to it, then pivots to a PPV or sales message. Count how often this happens.
- **Tone shifts**: Fan goes from multi-sentence engaged responses to one-word answers ("Sure", "Ok", "Thanks"). This is the moment immersion broke.
- **PPV timing**: Sales asks during or immediately after intimate/roleplay moments.
- **Mass messages**: Generic messages clearly sent to all fans ("CONGRATS!!! I chose you...", "$5 bundle because...", "75% off my NEWEST...").
- **Unanswered streak**: Count consecutive creator messages with no fan response. This is CRITICAL — count the TOTAL number of creator messages sent after the fan's last response. If there are 10+ unanswered messages, state the exact count prominently (e.g. "The creator sent 150+ messages with zero replies over 2 months"). This number alone tells you how badly the re-engagement was handled.
- **Stated preferences ignored**: Fan explicitly says "I like X" and X is never referenced again. Track what they said and whether it was acted on.
- **Budget signals**: Fan explicitly mentioning money, negotiating prices, saying they can't afford something, bank issues, waiting for payday.

4. If nothing went wrong (fan is still chatting, just not spending), say that honestly. Check for budget signals in the conversation — direct quotes about money difficulties are strong evidence.

STRUCTURE YOUR ANALYSIS EXACTLY LIKE THE EXAMPLE ABOVE:

**Fan Type**: Identify from conversation evidence. Justify with specific quotes. Don't default to "quick gratification" just because some messages are short — look at the full pattern.

**Timeline**: Summarize the relationship arc. Active period, peak spending moments, when things changed, current state.

**The Turning Point**: The most critical section. Pinpoint exactly when and why things shifted. Quote specific messages. If you can identify a copy-pasted script or a moment where the fan's tone changed, call it out explicitly. Cross-reference with spending dates.

**What Drove Their Spending**: 2-3 bullet points with specific quotes and dates. What type of interaction made them spend? This is what the chatting team needs to recreate.

**What Went Wrong**: Numbered list, each point backed by evidence from the conversation. If nothing went wrong, explain the real reason (budget, natural cooling, etc.) with evidence.

**Personal Details to Leverage**: THIS SECTION IS CRITICAL. Scan the entire conversation and extract two categories of details:

LIFE DETAILS (these prove "I actually know you as a person"):
- Real name (vs username), age, location, timezone, job/work schedule
- Pets, hobbies, interests, music taste, sports, foods mentioned
- Relationship status, living situation, daily routines they described
- Specific situations they mentioned (couldn't sleep, going to a concert, election day, hungover, at a friend's house)
- Questions THEY asked that reveal what they care about (asked about her art school, asked if she's single, asked about her favorite painting style)

INTIMATE DETAILS (these prove "I remember what turns you on"):
- Specific fantasies or scenarios THEY initiated (not ones the creator pitched)
- Kinks or dynamics they expressed (domme/sub, roleplay themes, body preferences)
- Things they said they like during sessions (audio/moaning, specific acts, pace preferences)
- Pet names they used or responded to
- How they like to end sessions (aftercare, shower, casual conversation)

For EACH detail, write a specific example message showing how to bring it up naturally:
- "He said he couldn't sleep (Jan 14)" → "Hey... can't sleep again? Last time that happened things got pretty interesting between us 😏"
- "He lives in Copenhagen and has a cat" → "How's Copenhagen? Hope your cat isn't judging you for being on here 😘"
- "He initiated the step-brother fantasy" → "I keep thinking about that scenario you came up with... I have a different ending in mind this time 😈"
- "He said 'Yes goddess tell me what to do'" → "I've been thinking about taking control again... are you ready to listen? 😈"
- "He told her he loves hearing her moan" → "I recorded something with just my voice for you... no screen, just sound 🎧"

Provide at least 5 details (mix of life + intimate). The chatting team should be able to pick any of these and use them as openers. They should feel natural, not like a script.

**Action Item**: Specific re-engagement approach. Write 2-3 example messages the chatting team could send (not just one). Each should reference a different personal detail from the section above. Rank them by which one is most likely to get a response from this fan type. Include DO NOT instructions.

**Recovery Odds**: High / Medium / Low with honest reasoning.

Be a strategist, not a summarizer. Every claim needs evidence. Write like you've done this a hundred times and you know exactly what patterns kill fan relationships.`

      : `You are an OnlyFans chat strategist. Quick analysis of why a fan's spending dropped.

${spendingContext}

Read the conversation and identify:
1. Fan type — based on how they communicate, not just surface messages
2. Most likely reason spending dropped — with specific quotes as evidence
3. One specific action item for the chatting team

**Fan Type**: (With 1-sentence justification quoting their messages)

**What's Happening**: (3-5 sentences. Cross-reference spending dates with conversation. Quote specific messages. Be direct about whether this is a chatting problem, budget issue, or natural cooling.)

**Personal Details**: List 2-3 personal things the fan shared (name, location, hobbies, preferences, fantasies) with a quick example of how to reference each one in a message.

**Action Item**: (Specific re-engagement approach. 1-2 example messages that reference personal details from above. "DO NOT" instruction.)

**Recovery Odds**: (High / Medium / Low — 1 sentence why)

Quote the fan's actual words as evidence. Don't be generic.`

    // Annotate conversation with daily spend amounts at each date
    let conversation = parsed.conversation
    if (spendingTimeline) {
      // Parse "YYYY-MM: $X.XX" monthly data — but also accept daily "YYYY-MM-DD: $X.XX"
      const spendByDate = {}
      for (const line of spendingTimeline.split('\n')) {
        const match = line.match(/([\d-]+):\s*\$([\d,.]+)/)
        if (match) spendByDate[match[1]] = parseFloat(match[2].replace(',', ''))
      }
      // Insert spend annotations after date headers in conversation
      conversation = conversation.replace(/--- ([^-]+) ---/g, (full, dateStr) => {
        // Try to find spend for this date
        const totalForDate = Object.entries(spendByDate)
          .filter(([k]) => dateStr.includes(k) || k.includes(dateStr.trim()))
          .reduce((s, [, v]) => s + v, 0)
        if (totalForDate > 0) {
          return `${full}\n[💰 $${totalForDate.toFixed(2)} spent this day]`
        }
        return full
      })
    }

    // Don't truncate aggressively — gpt-4o has 128k context
    const maxChars = isHighValue ? 80000 : 20000
    if (conversation.length > maxChars) {
      const beginning = conversation.slice(0, Math.floor(maxChars * 0.25))
      const end = conversation.slice(-Math.floor(maxChars * 0.75))
      conversation = beginning + '\n\n[... earlier messages omitted ...]\n\n' + end
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Analyze this conversation between ${creatorName} (CREATOR) and ${fanName} (FAN):\n\n${conversation}` },
      ],
      temperature: 0.5,
      max_tokens: isHighValue ? 3000 : 1000,
    })

    const fullAnalysis = completion.choices[0]?.message?.content || 'Analysis failed'

    // Generate manager brief from the full analysis
    const briefCompletion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `You write concise chat manager briefs for an OnlyFans management agency. Take a full fan analysis and distill it into a brief that a chat manager can read in under a minute and act on immediately.

Format:
**${fanName}** (@${formData.get('fanUsername') || '?'}) — $${lifetime.toLocaleString()} lifetime | ${currentGap}d since last purchase

**Situation**: (1-2 sentences max — what's happening)
**Action**: (1-2 sentences — exactly what to do or not do)
**Key Insight**: (1 sentence — the most important thing to know about this fan)

Keep it tight. No filler. The chat manager has 50 of these to review.` },
        { role: 'user', content: fullAnalysis },
      ],
      temperature: 0.5,
      max_tokens: 300,
    })

    const managerBrief = briefCompletion.choices[0]?.message?.content || ''

    // Save to Airtable (async, don't block response)
    const lastPurchaseDate = formData.get('lastPurchaseDate') || ''
    saveToAirtable({
      [F.fanName]: fanName,
      [F.ofUsername]: formData.get('fanUsername') || '',
      [F.creator]: creatorName,
      [F.lifetimeSpend]: lifetime,
      [F.currentGap]: currentGap,
      [F.medianGap]: medianGap,
      [F.lastPurchase]: lastPurchaseDate || null,
      [F.analysisType]: isHighValue ? 'Deep Dive' : 'Quick Snapshot',
      [F.fullAnalysis]: fullAnalysis,
      [F.managerBrief]: managerBrief,
      [F.messageCount]: parsed.messageCount,
      [F.fanMessages]: parsed.fanMessages,
      [F.creatorMessages]: parsed.creatorMessages,
      [F.status]: 'New',
      [F.analyzedDate]: new Date().toISOString(),
    })

    return Response.json({
      analysis: fullAnalysis,
      managerBrief,
      analysisType,
      messageCount: parsed.messageCount,
      fanMessages: parsed.fanMessages,
      creatorMessages: parsed.creatorMessages,
      saved: true,
    })
  } catch (err) {
    console.error('Chat analysis error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
