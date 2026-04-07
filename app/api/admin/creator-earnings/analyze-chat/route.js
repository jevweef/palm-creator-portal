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

    // Spending timeline (passed from frontend as JSON)
    const spendingTimeline = formData.get('spendingTimeline') || ''

    const spendingContext = `SPENDING DATA FOR THIS FAN:
- Lifetime spend: $${lifetime.toLocaleString()}
- Normal purchase cadence: every ${medianGap} days
- Current gap: ${currentGap} days since last purchase
- Last 30 days: $${rolling30.toLocaleString()} (vs their normal ~$${monthlyAvg90.toLocaleString()}/month)
- Creator name: ${creatorName}
${spendingTimeline ? `\nDAILY SPENDING HISTORY (correlate these dates with conversation moments):\n${spendingTimeline}` : ''}`

    const fanArchetypes = `FAN ARCHETYPES (pick the one that fits best based on their MESSAGES, not just their spending):
- Relationship seeker: writes long messages, wants reciprocity, uses emotional language, wants to feel special and chosen, buys during genuine connection moments
- Roleplay enthusiast: creates scenarios, writes in-character, responds to narrative, spends big during immersive sessions, kills the mood when scripts break immersion
- Quick gratification: short messages, "send more", responds to visual content, buys impulsively, doesn't need conversation
- Collector/PPV buyer: unlocks bundles consistently, rarely chats, motivated by exclusivity and quantity
- Domme/sub dynamic: power exchange language ("goddess", "tell me what to do"), spends when feeling controlled/commanded
- Casual browser: light engagement, small tips, no deep investment, comes and goes`

    const systemPrompt = isHighValue
      ? `You are a senior OnlyFans chat strategist analyzing why a high-value fan's spending has dropped. You work for a creator management agency and your analysis will be used by the chatting team to decide what to do next.

${spendingContext}

${fanArchetypes}

YOUR APPROACH:
1. Read the conversation carefully and identify the fan's archetype based on HOW they communicate, not just what they buy.
2. Cross-reference the spending dates with conversation moments. When did big spending sessions happen? What was the conversation like around those dates? When did spending stop? What changed in the conversation at that point?
3. Look for RED FLAGS in the chatting approach:
   - Copy-pasted or AI-generated text blocks (sudden shift from conversational to formal/verbose paragraphs)
   - The same message or paragraph appearing multiple times in the conversation
   - Tone shifts: fan goes from multi-sentence engaged responses to one-word answers ("Sure", "Ok", "Thanks")
   - Mass messages that are clearly sent to all fans (generic, not referencing anything specific to this fan)
   - PPV or content pushes immediately after or during intimate/roleplay moments
   - Fan stating preferences that are never acknowledged or acted on in future messages
4. Be HONEST about the reason. Possibilities include:
   - The chatting approach broke immersion or felt transactional
   - Fan preferences were stated but ignored
   - Mass message fatigue (too many generic blasts, fan stopped feeling special)
   - Budget/financial constraints (fan is still engaged but not spending)
   - Natural cooling (they got what they wanted)
   - Content oversaturation (too many bundles, not enough conversation)

PROVIDE YOUR ANALYSIS:

**Fan Type**: Pick from the archetypes above. Justify in 1 sentence based on specific messages they sent.

**The Turning Point**: THIS IS CRITICAL. Identify the specific moment or pattern where things shifted. Quote the exact messages if possible. Correlate with spending data — when was their last big session, and what happened in the conversation around that time? If there's no clear turning point and the fan is just cooling naturally or broke, say that.

**What Drove Their Spending**: 2-3 bullet points with SPECIFIC examples. Quote their messages. What type of interaction made them open their wallet? Was it during roleplay? After personal conversation? Impulse PPV buys? This tells us what to recreate.

**What Went Wrong (or Didn't)**: Be honest. If the chatting team messed up, say exactly how with quotes. If nothing went wrong and it's budget or natural cooling, say that clearly. Don't manufacture problems. 2-4 bullet points.

**Action Item for Chatting Team**: THE most important section. A specific thing to try RIGHT NOW.
- If re-engageable: write an actual example message they should send, referencing something specific from this fan's conversation history. Explain WHY this message works for this fan type.
- If budget-constrained: explain how to maintain the relationship without pushing sales
- If likely lost: say so honestly and explain why, so the team doesn't waste time
- Always include "DO NOT:" — what to avoid with this specific fan

**Recovery Odds**: High / Medium / Low — with 1-2 sentences explaining why.

Write like a human strategist, not an AI. Be direct. Quote specific messages as evidence. Every claim should be backed by something from the conversation.`

      : `You are an OnlyFans chat strategist for a management agency. Quick assessment of why a fan's spending dropped.

${spendingContext}

${fanArchetypes}

Read the conversation, identify the fan type from the archetypes above, and figure out the most likely reason spending dropped. Quote specific messages as evidence when possible.

**Fan Type**: (Pick from archetypes, 1 sentence justification)

**What's Happening**: (3-4 sentences. Be specific — quote a message or two. Cross-reference with spending dates if provided. Is this a chatting problem, a budget problem, or natural cooling?)

**Action Item**: (Specific thing for the chatting team to try. Include an example message if re-engagement is worth trying. Include a "DO NOT" instruction. Reference something specific from the conversation.)

**Recovery Odds**: (High / Medium / Low — 1 sentence why)

Be direct and evidence-based. Quote the fan's actual words.`

    // Truncate conversation if too long (keep most recent + beginning for context)
    let conversation = parsed.conversation
    const maxChars = isHighValue ? 20000 : 8000
    if (conversation.length > maxChars) {
      const beginning = conversation.slice(0, Math.floor(maxChars * 0.3))
      const end = conversation.slice(-Math.floor(maxChars * 0.7))
      conversation = beginning + '\n\n[... earlier messages omitted ...]\n\n' + end
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Here is the full conversation between ${creatorName} (CREATOR) and ${fanName} (FAN):\n\n${conversation}` },
      ],
      temperature: 0.6,
      max_tokens: isHighValue ? 2500 : 800,
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
