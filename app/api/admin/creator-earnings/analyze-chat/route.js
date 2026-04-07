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

THIS is the level of depth, specificity, and evidence you must match. Note how every claim is backed by a specific quote or date. Note how the fan type was determined by analyzing the FULL conversation pattern, not just surface-level messages.`

    const systemPrompt = isHighValue
      ? `You are a senior OnlyFans chat strategist. You analyze conversations between creators and fans, cross-reference with spending data, and produce detailed analyses that the chatting team uses to save at-risk fans.

${spendingContext}

${exampleAnalysis}

NOW ANALYZE THE CONVERSATION BELOW WITH THE SAME DEPTH.

YOUR PROCESS:
1. Read the ENTIRE conversation. Don't just skim — look at how the fan communicates across different sessions. Short horny messages alone don't make someone "quick gratification" — look for roleplay participation, emotional language, reciprocity, stated preferences.
2. Cross-reference spending dates with conversation moments. The spending data shows WHEN money was spent. Find those dates in the conversation and identify what was happening. What type of interaction triggered the big sessions?
3. Identify the EXACT turning point where engagement or spending shifted. Quote the specific messages. Look for:
   - Copy-pasted text blocks (especially if the same text appears twice in the conversation)
   - Sudden tone shifts (fan goes from paragraphs to one-word answers)
   - PPV asks during intimate/roleplay moments
   - Mass messages (generic, could be sent to any fan)
   - Fan preferences stated but never acted on later
4. If nothing went wrong (fan is still chatting, just not spending), say that honestly and explain what's most likely happening.

STRUCTURE YOUR ANALYSIS EXACTLY LIKE THE EXAMPLE ABOVE:

**Fan Type**: Identify from conversation evidence. Justify with specific quotes. Don't default to "quick gratification" just because some messages are short — look at the full pattern.

**Timeline**: Summarize the relationship arc. Active period, peak spending moments, when things changed, current state.

**The Turning Point**: The most critical section. Pinpoint exactly when and why things shifted. Quote specific messages. If you can identify a copy-pasted script or a moment where the fan's tone changed, call it out explicitly. Cross-reference with spending dates.

**What Drove Their Spending**: 2-3 bullet points with specific quotes and dates. What type of interaction made them spend? This is what the chatting team needs to recreate.

**What Went Wrong**: Numbered list, each point backed by evidence from the conversation. If nothing went wrong, explain the real reason (budget, natural cooling, etc.) with evidence.

**Action Item**: Specific re-engagement approach. Write an actual example message. Explain why it works for this fan type. Include DO NOT instructions.

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

**Action Item**: (Specific re-engagement approach. Example message if applicable. "DO NOT" instruction.)

**Recovery Odds**: (High / Medium / Low — 1 sentence why)

Quote the fan's actual words as evidence. Don't be generic.`

    // Send the full conversation — gpt-4o has 128k context, don't truncate aggressively
    let conversation = parsed.conversation
    const maxChars = isHighValue ? 60000 : 15000
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
