import { auth } from '@clerk/nextjs/server'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

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

    const systemPrompt = isHighValue
      ? `You are an expert OnlyFans chat analyst for a management agency. You analyze conversations between creators and fans to understand relationship dynamics, identify what went wrong when a fan stops spending, and provide actionable re-engagement strategies.

You're analyzing a conversation for a HIGH-VALUE fan who has spent $${lifetime.toLocaleString()} lifetime. This warrants a thorough analysis.

Context about this fan's spending behavior:
- Their normal purchase gap is ${medianGap} days, but they haven't purchased in ${currentGap} days (${(currentGap / medianGap).toFixed(1)}x overdue)
- Last 30 days: $${rolling30.toLocaleString()} (vs their normal ~$${monthlyAvg90.toLocaleString()}/month)
- The creator's name is ${creatorName}

Provide your analysis in this exact structure:

**Fan Type**: (1 line — e.g. "Relationship seeker", "Quick gratification", "Roleplay enthusiast", "Collector/PPV buyer")

**What Worked**: (2-3 bullet points — what moments drove the most engagement and spending)

**What Went Wrong**: (2-4 bullet points — specific moments or patterns that caused disengagement. Quote specific messages if relevant. Be direct.)

**Missed Signals**: (1-3 bullet points — things the fan said or did that indicated preferences that were never acted on)

**Re-engagement Strategy**: (A specific message to send — not generic, referencing something from their actual conversation. Also note what NOT to do.)

**Chatting Team Takeaway**: (2-3 bullet points — what to do differently going forward with this type of fan)

Be direct and specific. Reference actual conversation moments. Don't be generic.`

      : `You are an OnlyFans chat analyst for a management agency. You're doing a QUICK analysis of a fan who spent $${lifetime.toLocaleString()} and has gone cold.

Context:
- Normal purchase gap: ${medianGap} days, currently ${currentGap} days since last purchase
- Last 30 days: $${rolling30.toLocaleString()} (vs normal ~$${monthlyAvg90.toLocaleString()}/month)
- Creator: ${creatorName}

Provide a brief analysis:

**Fan Type**: (1 line)

**Likely Reason for Drop-off**: (1-2 sentences)

**Quick Re-engagement**: (One specific message to try, based on what you see in the conversation)

**Odds of Recovery**: (Low / Medium / High — with one sentence why)

Keep it short and actionable. 4-5 sentences total, not counting the message suggestion.`

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

    const analysis = completion.choices[0]?.message?.content || 'Analysis failed'

    return Response.json({
      analysis,
      analysisType,
      messageCount: parsed.messageCount,
      fanMessages: parsed.fanMessages,
      creatorMessages: parsed.creatorMessages,
    })
  } catch (err) {
    console.error('Chat analysis error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
