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

    const spendingContext = `Context about this fan's spending behavior:
- Lifetime spend: $${lifetime.toLocaleString()}
- Their normal purchase gap is ${medianGap} days, but they haven't purchased in ${currentGap} days
- Last 30 days spend: $${rolling30.toLocaleString()} (vs their normal ~$${monthlyAvg90.toLocaleString()}/month)
- The creator's name is ${creatorName}`

    const systemPrompt = isHighValue
      ? `You are an expert OnlyFans chat analyst for a management agency. You analyze conversations between creators and fans to understand the relationship, determine why spending has dropped, and provide a specific action plan for the chatting team.

${spendingContext}

This fan was flagged because their spending dropped below their normal pattern. Your job is to figure out WHY and give the chatting team something specific to try.

IMPORTANT: Be honest about the reason. Don't assume the chatting team screwed up — it could be any of these:
- Budget/financial — fan is still engaged and chatting but doesn't have money right now
- Chatting approach — scripts, mass messages, or broken immersion turned them off
- Ignored preferences — fan expressed interests that were never acted on
- Natural cycle — they got what they wanted and spending cooled naturally
- Oversaturation — too many PPV blasts without enough genuine conversation

Whatever the reason, there MUST be a specific action item for the chatting team to try. Even if the fan is just broke, there's always something to do (maintain the relationship, stop sending paid content, focus on conversation to keep them warm for when they can spend again).

Provide your analysis in this structure:

**Fan Type**: (1 line — e.g. "Relationship seeker", "Quick gratification", "Roleplay enthusiast", "Collector/PPV buyer", "Casual browser")

**Why They Were Flagged**: (2-3 sentences — honest read of why spending dropped. What's the most likely explanation based on the conversation?)

**What Worked**: (2-3 bullet points — what moments or patterns drove the most engagement and spending)

**What Could Be Better**: (1-4 bullet points — genuine issues if any. Could be chatting approach, content mismatch, or just "nothing wrong, fan seems budget-constrained")

**Action Item**: (THE most important section. A specific thing for the chatting team to try RIGHT NOW. Include an example message to send if applicable. Make it specific to this conversation — reference something the fan said or did. Also say what NOT to do.)

**Chatting Team Takeaway**: (1-3 bullet points — patterns to replicate or avoid with this type of fan)

Be direct, specific, and honest. Reference actual conversation moments.`

      : `You are an OnlyFans chat analyst for a management agency. Quick assessment of why a fan's spending dropped.

${spendingContext}

This fan was flagged because spending is below their normal pattern. Figure out the most likely reason and give the chatting team one specific thing to try.

Be honest — could be budget, could be the chatting approach, could be they're just done. But always provide an action item.

**Fan Type**: (1 line)

**Why Spending Dropped**: (2-3 sentences — honest read. Budget? Turned off? Natural cooling? Be direct.)

**Action Item**: (One specific thing for the chatting team to try. Include an example message if relevant. Say what NOT to do.)

**Odds of Recovery**: (Low / Medium / High — with one sentence why)

Keep it tight and actionable.`

    // Truncate conversation if too long (keep most recent + beginning for context)
    let conversation = parsed.conversation
    const maxChars = isHighValue ? 12000 : 5000
    if (conversation.length > maxChars) {
      const beginning = conversation.slice(0, Math.floor(maxChars * 0.3))
      const end = conversation.slice(-Math.floor(maxChars * 0.7))
      conversation = beginning + '\n\n[... earlier messages omitted ...]\n\n' + end
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Here is the full conversation between ${creatorName} (CREATOR) and ${fanName} (FAN):\n\n${conversation}` },
      ],
      temperature: 0.7,
      max_tokens: isHighValue ? 1500 : 600,
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
