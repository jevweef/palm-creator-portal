import { auth } from '@clerk/nextjs/server'
import OpenAI from 'openai'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, downloadFromDropbox, createDropboxFolder } from '@/lib/dropbox'

export const maxDuration = 120

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// ── Airtable ───────────────────────────────────────────────────────────────

const OPS_BASE = 'applLIT2t83plMqNx'
const FAN_ANALYSIS_TABLE = 'tblNMtOEg2AIzvLDK'
const FAN_TRACKER_TABLE = 'Fan Tracker'
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
  firstMessageDate: 'fldaP9TQxW3fHNSqK',
  lastMessageDate: 'fldzAk7mEsPzZzDf0',
}

async function fetchPriorContext(fanName, creatorName, { rolling30 = 0, monthlyAvg90 = 0, currentGap = 0, medianGap = 0 } = {}) {
  try {
    // Get most recent previous analysis
    const analysisParams = new URLSearchParams()
    analysisParams.set('maxRecords', '1')
    analysisParams.set('sort[0][field]', 'Analyzed Date')
    analysisParams.set('sort[0][direction]', 'desc')
    analysisParams.set('filterByFormula', `AND({Fan Name} = "${fanName.replace(/"/g, '\\"')}"${creatorName ? `, {Creator} = "${creatorName.replace(/"/g, '\\"')}"` : ''})`)
    const analysisRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${FAN_ANALYSIS_TABLE}?${analysisParams}`, {
      headers: AIRTABLE_HEADERS, cache: 'no-store',
    })
    const analysisData = await analysisRes.json()
    const prevAnalysis = analysisData.records?.[0]?.fields || null

    // Get fan tracker record for alert history
    const trackerParams = new URLSearchParams()
    trackerParams.set('maxRecords', '1')
    trackerParams.set('filterByFormula', `{Fan Name} = "${fanName.replace(/"/g, '\\"')}"`)
    const trackerRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(FAN_TRACKER_TABLE)}?${trackerParams}`, {
      headers: AIRTABLE_HEADERS, cache: 'no-store',
    })
    const trackerData = await trackerRes.json()
    const tracker = trackerData.records?.[0]?.fields || null

    if (!prevAnalysis && !tracker) return null

    let context = '\n\nPRIOR CONTEXT FOR THIS FAN (this is NOT the first time we are analyzing them):\n'

    if (prevAnalysis) {
      const prevDate = prevAnalysis['Analyzed Date']
        ? new Date(prevAnalysis['Analyzed Date']).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : 'unknown date'
      context += `\nPrevious analysis was run on ${prevDate}.`
      if (prevAnalysis['Manager Brief']) {
        context += `\nPrevious manager brief:\n${prevAnalysis['Manager Brief']}\n`
      }
      if (prevAnalysis['Full Analysis']) {
        // Include a truncated version of the previous full analysis
        const prev = prevAnalysis['Full Analysis']
        context += `\nPrevious full analysis (summary):\n${prev.length > 2000 ? prev.slice(0, 2000) + '...' : prev}\n`
      }
    }

    if (tracker) {
      const alertCount = tracker['Alert Count'] || 0
      const timesGoneCold = tracker['Times Gone Cold'] || 0
      const lastAlertDate = tracker['Last Alert Sent']
        ? new Date(tracker['Last Alert Sent']).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : null
      const effectiveness = tracker['Effectiveness'] || ''
      const preAlert = tracker['Pre-Alert Spend 30d'] || 0
      const postAlert = tracker['Post-Alert Spend 30d'] || 0

      context += `\nFan Tracker data:`
      context += `\n- Times gone cold: ${timesGoneCold}`
      context += `\n- Total alerts sent to chat manager: ${alertCount}`
      if (lastAlertDate) context += `\n- Last alert sent: ${lastAlertDate}`
      if (effectiveness) context += `\n- Effectiveness of last intervention: ${effectiveness}`
      if (preAlert > 0) context += `\n- Spending before last alert (30d): $${preAlert.toLocaleString()}`
      if (postAlert > 0) context += `\n- Spending after last alert (30d): $${postAlert.toLocaleString()}`

      // Parse alert history for timeline
      let alertHistory = []
      try { alertHistory = JSON.parse(tracker['Alert History'] || '[]') } catch {}
      if (alertHistory.length > 0) {
        context += `\n\nAlert history timeline:`
        for (const h of alertHistory) {
          const date = new Date(h.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          context += `\n  - ${date}: ${h.urgency} alert (${h.currentGap}d gap, $${Math.round(h.rolling30)} last 30d, $${Math.round(h.lifetime)} lifetime)`
        }
      }

      // Determine if the fan is currently active/hot or still cold
      const isCurrentlyHot = rolling30 > 0 && (monthlyAvg90 <= 0 || rolling30 >= monthlyAvg90 * 0.5) && currentGap < (medianGap > 0 ? medianGap * 2 : 30)
      const isReengaged = rolling30 > 0 && preAlert === 0

      context += `\n\nIMPORTANT: This fan has been flagged ${timesGoneCold} time(s) before. This is a FOLLOW-UP analysis.`

      if (isCurrentlyHot || isReengaged) {
        context += ` The fan appears to have RE-ENGAGED — they are currently spending ($${Math.round(rolling30).toLocaleString()} in the last 30 days). Your analysis MUST:`
        context += `\n- Recognize this is a SUCCESS — the fan came back. Do NOT frame this as "going cold" or needing recovery`
        context += `\n- Identify what WORKED to bring them back — compare the new chat messages to the previous approach`
        context += `\n- Evaluate whether the previous action items were followed and which ones drove the re-engagement`
        context += `\n- Highlight what's keeping them engaged NOW so the team can maintain it`
        context += `\n- Warn about specific risks that could cause them to go cold AGAIN (based on their history)`
        context += `\n- Action items should focus on MAINTAINING momentum, not recovery`
        context += `\n- Recovery Odds should be replaced with RETENTION outlook (High/Medium/Low chance they stay engaged)`
      } else {
        context += ` Your analysis MUST:`
        context += `\n- Start by acknowledging this is a re-analysis, not a first look`
        context += `\n- Evaluate whether the previous action items were followed in the NEW chat messages`
        context += `\n- Compare spending BEFORE vs AFTER the alert was sent to the chat manager`
        context += `\n- If the fan re-engaged after the intervention, identify what worked and why`
        context += `\n- If the fan did NOT re-engage, assess whether the action items were even attempted`
        context += `\n- Identify if this is a PATTERN (recurring going-cold cycle) vs a one-time issue`
        context += `\n- If previous action items didn't work or weren't tried, suggest a DIFFERENT approach`
        context += `\n- Be honest about recovery odds given the history`
      }
      context += `\n- The conversation now includes BOTH old messages (from prior analysis) and NEW messages. Look for changes in tone, engagement, or spending patterns after the alert date.`
    }

    // Return both the context string and whether fan is currently hot
    const isCurrentlyHot_val = typeof isCurrentlyHot !== 'undefined' ? isCurrentlyHot : false
    const isReengaged_val = typeof isReengaged !== 'undefined' ? isReengaged : false
    return { text: context, isHot: isCurrentlyHot_val || isReengaged_val }
  } catch (err) {
    console.error('Failed to fetch prior context:', err)
    return null
  }
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

  // Extract date dividers (strip dummy "12:00 am" that OF adds to all date headers)
  const datePositions = []
  const dateRe = /b-chat__messages__time.*?title="([^"]+)"/g
  let dm
  while ((dm = dateRe.exec(html))) {
    const rawDate = dm[1].replace(/,?\s*12:00\s*am$/i, '').trim()
    datePositions.push({ pos: dm.index, date: rawDate })
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

    // Find date from nearest preceding date divider
    let msgDate = ''
    for (let i = datePositions.length - 1; i >= 0; i--) {
      if (datePositions[i].pos < pos) {
        msgDate = datePositions[i].date
        break
      }
    }

    // Extract actual message time (e.g. "9:21 pm") from b-chat__message__time span
    let msgTime = ''
    const timeMatch = block.match(/b-chat__message__time[^>]*>[\s\S]*?<span[^>]*>\s*([\d]{1,2}:[\d]{2}\s*[ap]m)\s*<\/span/i)
    if (timeMatch) msgTime = timeMatch[1].trim()

    const sender = isFromMe ? 'CREATOR' : 'FAN'
    let line = `[${sender}]`
    if (text) line += ` ${text}`
    if (hasMedia) line += mediaCount ? ` [media x${mediaCount}]` : ' [media]'
    if (isPrice && price) line += ` [PPV $${price}]`
    if (isTip) line += ' [TIP]'

    if (text || hasMedia || isTip) {
      messages.push({ date: msgDate, time: msgTime, sender, line })
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

  // Extract first and last message dates with actual times
  const firstMsg = messages.length > 0 ? messages[0] : null
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null
  const firstDate = firstMsg ? (firstMsg.time ? `${firstMsg.date}, ${firstMsg.time}` : firstMsg.date) : ''
  const lastDate = lastMsg ? (lastMsg.time ? `${lastMsg.date}, ${lastMsg.time}` : lastMsg.date) : ''

  return {
    conversation: lines.join('\n'),
    messages, // raw array for dedup in Dropbox append
    messageCount: messages.length,
    fanMessages: messages.filter(m => m.sender === 'FAN').length,
    creatorMessages: messages.filter(m => m.sender === 'CREATOR').length,
    firstMessageDate: firstDate,
    lastMessageDate: lastDate,
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
    const saveOnly = formData.get('saveTranscriptOnly') === 'true'
    const useTranscript = formData.get('useTranscript') === 'true'
    const fanName = formData.get('fanName') || 'Unknown'
    const lifetime = parseFloat(formData.get('lifetime')) || 0
    const medianGap = parseInt(formData.get('medianGap')) || 0
    const currentGap = parseInt(formData.get('currentGap')) || 0
    const rolling30 = parseFloat(formData.get('rolling30')) || 0
    const monthlyAvg90 = parseFloat(formData.get('monthlyAvg90')) || 0
    const creatorName = formData.get('creatorName') || 'the creator'

    let parsed
    if (useTranscript) {
      // Re-analyze from saved Dropbox transcript (no HTML upload needed)
      const fanUsername = formData.get('fanUsername') || ''
      const transcript = await loadChatHistory(creatorName, fanName, fanUsername)
      if (!transcript) return Response.json({ error: 'No saved transcript found in Dropbox. Upload a chat HTML first.' }, { status: 400 })
      // Build a minimal parsed object from the transcript text
      const lines = transcript.split('\n')
      const messages = []
      let currentDate = ''
      for (const line of lines) {
        const dateMatch = line.match(/^--- (.+?) ---$/)
        if (dateMatch) { currentDate = dateMatch[1]; continue }
        const senderMatch = line.match(/^\[(CREATOR|FAN)\]/)
        if (senderMatch) {
          messages.push({ date: currentDate, time: '', sender: senderMatch[1], line })
        }
      }
      parsed = {
        conversation: transcript,
        messages,
        messageCount: messages.length,
        fanMessages: messages.filter(m => m.sender === 'FAN').length,
        creatorMessages: messages.filter(m => m.sender === 'CREATOR').length,
        firstMessageDate: messages[0]?.date || '',
        lastMessageDate: messages[messages.length - 1]?.date || '',
      }
    } else {
      if (!file) return Response.json({ error: 'No file uploaded' }, { status: 400 })
      const html = await file.text()
      parsed = parseChatHtml(html)
    }

    if (parsed.messageCount === 0) {
      return Response.json({ error: 'No messages found' }, { status: 400 })
    }

    // Save transcript to Dropbox only (no AI analysis)
    if (saveOnly) {
      const fanUsername = formData.get('fanUsername') || ''
      const creatorRecordId = formData.get('creatorRecordId') || ''
      try {
        await saveChatToDropbox({
          parsedConversation: parsed.conversation,
          parsedMessages: parsed.messages,
          fullAnalysis: null,
          managerBrief: null,
          creatorName,
          fanName,
          fanUsername,
          firstMessageDate: parsed.firstMessageDate,
          lastMessageDate: parsed.lastMessageDate,
        })
      } catch (err) {
        console.error('[Chat Analysis] Dropbox save failed:', err)
        return Response.json({ error: 'Failed to save to Dropbox: ' + err.message }, { status: 500 })
      }
      return Response.json({
        success: true,
        saved: true,
        messageCount: parsed.messageCount,
        firstMessageDate: parsed.firstMessageDate || '',
        lastMessageDate: parsed.lastMessageDate || '',
      })
    }

    // Scale analysis depth based on lifetime spend
    const isHighValue = lifetime >= 1000
    const analysisType = isHighValue ? 'deep' : 'quick'

    // Spending timeline (passed from frontend) — filter to chat date range
    const rawSpendingTimeline = formData.get('spendingTimeline') || ''
    const chatLastDate = parsed.lastMessageDate ? parsed.lastMessageDate.replace(/,?\s*\d{1,2}:\d{2}\s*[ap]m$/i, '').trim() : ''

    // Parse the last message date for comparison (e.g. "Apr 6" or "Apr 6, 2025")
    let chatEndDate = null
    if (chatLastDate) {
      const d = new Date(chatLastDate + (chatLastDate.match(/\d{4}/) ? '' : `, ${new Date().getFullYear()}`))
      if (!isNaN(d)) chatEndDate = d
    }

    // Filter spending timeline to only include dates within the chat window
    let spendingTimeline = rawSpendingTimeline
    let cappedRolling30 = rolling30
    let cappedCurrentGap = currentGap
    let cappedLifetime = lifetime
    if (chatEndDate && rawSpendingTimeline) {
      const lines = rawSpendingTimeline.split('\n')
      const filtered = []
      let totalInWindow = 0
      let lastSpendDate = null
      const thirtyBefore = new Date(chatEndDate - 30 * 86400000)
      let rolling30InWindow = 0
      for (const line of lines) {
        const match = line.match(/([\d-]+):\s*\$([\d,.]+)/)
        if (!match) continue
        const lineDate = new Date(match[1] + 'T00:00:00')
        if (lineDate <= chatEndDate) {
          filtered.push(line)
          const amount = parseFloat(match[2].replace(',', ''))
          totalInWindow += amount
          lastSpendDate = lineDate
          if (lineDate >= thirtyBefore) rolling30InWindow += amount
        }
      }
      spendingTimeline = filtered.join('\n')
      cappedLifetime = totalInWindow || lifetime
      cappedRolling30 = rolling30InWindow
      if (lastSpendDate) {
        cappedCurrentGap = Math.floor((chatEndDate - lastSpendDate) / 86400000)
      }
    }

    const chatWindowNote = chatEndDate
      ? `\n- IMPORTANT: This spending data is scoped to the chat window ending ${chatLastDate}. Do NOT reference spending or activity after this date.`
      : ''

    const spendingContext = `SPENDING DATA FOR THIS FAN:
- Lifetime spend (through chat window): $${cappedLifetime.toLocaleString()}
- Normal purchase cadence: every ${medianGap} days
- Gap since last purchase (at end of chat): ${cappedCurrentGap} days
- Last 30 days of chat window: $${cappedRolling30.toLocaleString()} (vs their normal ~$${monthlyAvg90.toLocaleString()}/month)
- Creator name: ${creatorName}${chatWindowNote}
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

    const maxChars = isHighValue ? 80000 : 20000

    // Fetch prior analysis context (if fan has been analyzed before)
    const priorResult = await fetchPriorContext(fanName, creatorName, { rolling30, monthlyAvg90, currentGap, medianGap })
    const priorContext = priorResult?.text || null
    const fanIsHot = priorResult?.isHot || false

    // If fan is currently hot/re-engaged, swap Recovery Odds → Retention Outlook in the template
    let finalPrompt = systemPrompt
    if (fanIsHot && isHighValue) {
      finalPrompt = finalPrompt.replace(
        '**Recovery Odds**: High / Medium / Low with honest reasoning.',
        `**Retention Outlook**: High / Medium / Low — this fan is CURRENTLY ACTIVE and spending. Do NOT frame this as recovery. Assess the likelihood they STAY engaged based on conversation quality, spending momentum, and whether the patterns that caused previous cold spells have been addressed. If they're hot, say so plainly.`
      )
      finalPrompt = finalPrompt.replace(
        'Specific re-engagement approach. Write 2-3 example messages',
        'Specific approach to MAINTAIN this fan\'s engagement and maximize spending. Write 2-3 example messages'
      )
      finalPrompt = finalPrompt.replace(
        '**What Went Wrong**: Numbered list, each point backed by evidence from the conversation. If nothing went wrong, explain the real reason (budget, natural cooling, etc.) with evidence.',
        '**What Went Wrong (Previously)**: If there was a prior cold spell, briefly note what caused it. Then focus on what CHANGED — what\'s different now that brought them back. If the chatting team fixed the issue, credit them specifically.'
      )
      finalPrompt = finalPrompt.replace(
        '**The Turning Point**: The most critical section. Pinpoint exactly when and why things shifted. Quote specific messages. If you can identify a copy-pasted script or a moment where the fan\'s tone changed, call it out explicitly. Cross-reference with spending dates.',
        '**The Turning Point**: Pinpoint when things shifted POSITIVELY. What brought this fan back? Quote specific messages that show re-engagement. Cross-reference with spending dates. If there was a prior cold spell, briefly note when it ended and what triggered the return.'
      )
    } else if (fanIsHot && !isHighValue) {
      finalPrompt = finalPrompt.replace(
        '**Recovery Odds**: (High / Medium / Low — 1 sentence why)',
        '**Retention Outlook**: (High / Medium / Low — this fan is active. Assess likelihood they stay engaged, not recovery odds.)'
      )
      finalPrompt = finalPrompt.replace(
        'Most likely reason spending dropped',
        'Current engagement status and any risks'
      )
    }
    const systemWithContext = priorContext
      ? finalPrompt + priorContext
      : finalPrompt

    // Load accumulated chat history from Dropbox and merge with new upload
    const fanUsername = formData.get('fanUsername') || ''
    let fullConversation = conversation
    if (priorContext) {
      try {
        const existingTranscript = await loadChatHistory(creatorName, fanName, fanUsername)
        if (existingTranscript) {
          // Dedup: find last date in existing transcript, only include new messages after that
          const dateHeaders = [...existingTranscript.matchAll(/--- (.+?) ---/g)]
          const lastExistingDate = dateHeaders.length > 0 ? dateHeaders[dateHeaders.length - 1][1] : ''

          if (lastExistingDate) {
            // Find where new messages start in the uploaded conversation
            const newDateHeaders = [...conversation.matchAll(/--- (.+?) ---/g)]
            let newStartIdx = -1
            for (const m of newDateHeaders) {
              // Find first date in new upload that's AFTER the last existing date
              if (m[1] > lastExistingDate) {
                newStartIdx = m.index
                break
              }
            }

            if (newStartIdx > 0) {
              const newMessages = conversation.slice(newStartIdx)
              fullConversation = existingTranscript + '\n\n--- NEW MESSAGES SINCE LAST ANALYSIS ---\n' + newMessages
            } else {
              // All messages in the new upload overlap with existing — use the new upload as-is
              // (may include more recent context even for overlapping dates)
              fullConversation = existingTranscript + '\n\n--- UPDATED UPLOAD (may include overlapping dates) ---\n' + conversation
            }
          } else {
            fullConversation = existingTranscript + '\n\n' + conversation
          }
        }
      } catch (err) {
        console.error('[Chat Analysis] Failed to load chat history, using uploaded HTML only:', err)
      }
    }

    // Re-apply truncation to the merged conversation
    if (fullConversation.length > maxChars) {
      const beginning = fullConversation.slice(0, Math.floor(maxChars * 0.25))
      const end = fullConversation.slice(-Math.floor(maxChars * 0.75))
      fullConversation = beginning + '\n\n[... earlier messages omitted ...]\n\n' + end
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemWithContext },
        { role: 'user', content: `Analyze this conversation between ${creatorName} (CREATOR) and ${fanName} (FAN):\n\n${fullConversation}` },
      ],
      temperature: 0.5,
      max_tokens: isHighValue ? 3000 : 1000,
    })

    const fullAnalysis = completion.choices[0]?.message?.content || 'Analysis failed'

    // Run manager brief, Dropbox save, and fan tracker upsert in parallel
    const creatorRecordId = formData.get('creatorRecordId') || ''
    const lastPurchaseDate = formData.get('lastPurchaseDate') || ''

    // Run manager brief + fan tracker in parallel
    const [briefResult] = await Promise.all([
      openai.chat.completions.create({
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
      }).catch(err => { console.error('[Chat Analysis] Brief generation failed:', err); return null }),

      creatorRecordId
        ? upsertFanTracker({ fanName, fanUsername, creatorRecordId, lifetime }).catch(err => console.error('[Chat Analysis] Fan tracker upsert failed:', err))
        : Promise.resolve(),
    ])

    const managerBrief = briefResult?.choices?.[0]?.message?.content || ''

    // Dropbox save + Airtable save in parallel (both need managerBrief)
    await Promise.all([
      saveChatToDropbox({
        parsedConversation: parsed.conversation, parsedMessages: parsed.messages,
        fullAnalysis, managerBrief, creatorName, fanName, fanUsername,
        firstMessageDate: parsed.firstMessageDate, lastMessageDate: parsed.lastMessageDate,
      }).catch(err => console.error('[Chat Analysis] Dropbox save failed:', err)),

      saveToAirtable({
      [F.fanName]: fanName,
      [F.ofUsername]: fanUsername,
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
      [F.firstMessageDate]: parsed.firstMessageDate || '',
      [F.lastMessageDate]: parsed.lastMessageDate || '',
    }),
    ])

    return Response.json({
      analysis: fullAnalysis,
      managerBrief,
      analysisType,
      messageCount: parsed.messageCount,
      fanMessages: parsed.fanMessages,
      creatorMessages: parsed.creatorMessages,
      firstMessageDate: parsed.firstMessageDate || '',
      lastMessageDate: parsed.lastMessageDate || '',
      saved: true,
    })
  } catch (err) {
    console.error('Chat analysis error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// ── Fan Tracker upsert ────────────────────────────────────────────────────

async function upsertFanTracker({ fanName, fanUsername, creatorRecordId, lifetime }) {
  const now = new Date().toISOString()

  // Find existing record — match by username first, fall back to fan name
  let formula
  if (fanUsername) {
    formula = `{OF Username} = "${fanUsername}"`
  } else {
    formula = `{Fan Name} = "${fanName.replace(/"/g, '\\"')}"`
  }

  const params = new URLSearchParams()
  params.set('maxRecords', '1')
  params.set('filterByFormula', formula)
  const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(FAN_TRACKER_TABLE)}?${params}`, {
    headers: AIRTABLE_HEADERS, cache: 'no-store',
  })
  const data = await res.json()
  if (data.error) {
    console.error('[Fan Tracker] Airtable lookup error:', data.error)
  }
  const existing = data.records?.[0]

  if (existing) {
    // Update lifetime spend if higher
    const updates = {}
    if (lifetime > (existing.fields['Lifetime Spend'] || 0)) {
      updates['Lifetime Spend'] = lifetime
    }
    if (Object.keys(updates).length > 0) {
      await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(FAN_TRACKER_TABLE)}/${existing.id}`, {
        method: 'PATCH',
        headers: AIRTABLE_HEADERS,
        body: JSON.stringify({ fields: updates }),
      })
    }
  } else {
    // Create new tracker record
    const createRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(FAN_TRACKER_TABLE)}`, {
      method: 'POST',
      headers: AIRTABLE_HEADERS,
      body: JSON.stringify({
        fields: {
          'Fan Name': fanName,
          'OF Username': fanUsername || '',
          'Creator': [creatorRecordId],
          'Status': 'Going Cold',
          'First Flagged': now,
          'Lifetime Spend': lifetime || 0,
          'Times Gone Cold': 1,
        },
      }),
    })
    const createData = await createRes.json()
    if (createData.error) {
      console.error('[Fan Tracker] Airtable create error:', createData.error)
    }
  }
}

// ── Dropbox chat log storage ──────────────────────────────────────────────

function getChatBasePath(creatorName, fanName, fanUsername) {
  const safeFan = (fanUsername || fanName).replace(/[^a-zA-Z0-9_-]/g, '_')
  const safeCreator = creatorName.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `/Palm Ops/Chat Logs/${safeCreator}/${safeFan}`
}

// Load the master transcript from Dropbox (returns empty string if none exists)
async function loadChatHistory(creatorName, fanName, fanUsername) {
  try {
    const token = await getDropboxAccessToken()
    const rootNs = await getDropboxRootNamespaceId(token)
    const basePath = getChatBasePath(creatorName, fanName, fanUsername)

    const buf = await downloadFromDropbox(token, rootNs, `${basePath}/transcript.txt`)
    if (!buf) return ''
    return buf.toString('utf8')
  } catch (err) {
    console.error('[Chat History] Load failed:', err)
    return ''
  }
}

// Save parsed chat transcript to Dropbox, appending only new messages
async function saveChatToDropbox({ parsedConversation, parsedMessages, fullAnalysis, managerBrief, creatorName, fanName, fanUsername, firstMessageDate, lastMessageDate }) {
  const token = await getDropboxAccessToken()
  const rootNs = await getDropboxRootNamespaceId(token)
  const basePath = getChatBasePath(creatorName, fanName, fanUsername)
  const runDate = new Date().toISOString().split('T')[0]

  // Build clean date-range string from chat window for filenames
  // Input formats: "Nov 15", "Apr 6, 11:33 pm", "January 15, 2026" etc.
  const cleanDateForFilename = (dateStr) => {
    if (!dateStr) return null
    // Strip time portion (everything after the day number + optional year)
    const dateOnly = dateStr.replace(/,?\s*\d{1,2}:\d{2}\s*(am|pm)?\s*$/i, '').trim()
    // Replace spaces/commas with hyphens, remove other special chars
    return dateOnly.replace(/[,]/g, '').replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '') || null
  }
  const chatStart = cleanDateForFilename(firstMessageDate) || runDate
  const chatEnd = cleanDateForFilename(lastMessageDate) || runDate

  // Create folder structure: /Palm Ops/Chat Logs/{creator}/{fan}
  const safeCreator = basePath.split('/')[3] // e.g. "Laurel_Driskill"
  await createDropboxFolder(token, rootNs, `/Palm Ops/Chat Logs`)
  await createDropboxFolder(token, rootNs, `/Palm Ops/Chat Logs/${safeCreator}`)
  await createDropboxFolder(token, rootNs, basePath)

  // Download existing master transcript (if it fails, treat as first upload)
  let existingTranscript = ''
  try {
    const existingBuf = await downloadFromDropbox(token, rootNs, `${basePath}/transcript.txt`)
    existingTranscript = existingBuf ? existingBuf.toString('utf8') : ''
  } catch (err) {
    console.log('[Chat Save] No existing transcript (first upload or download failed):', err.message)
  }

  // Find the last date in the existing transcript to know where to start appending
  let newTranscript
  if (existingTranscript) {
    // Extract the last date header from existing transcript
    const dateHeaders = [...existingTranscript.matchAll(/--- (.+?) ---/g)]
    const lastExistingDate = dateHeaders.length > 0 ? dateHeaders[dateHeaders.length - 1][1] : ''

    if (lastExistingDate) {
      // Find messages in the new upload that come AFTER the last existing date
      // parsedMessages have { date, sender, line } — find first message past the cutoff
      let foundCutoff = false
      let appendIdx = parsedMessages.length // default: nothing to append
      for (let i = 0; i < parsedMessages.length; i++) {
        const msgDate = parsedMessages[i].date
        if (!foundCutoff) {
          // Skip messages until we pass the last existing date
          if (msgDate === lastExistingDate) {
            foundCutoff = true
          }
        } else if (msgDate !== lastExistingDate) {
          // First message on a NEW date after the cutoff
          appendIdx = i
          break
        }
      }

      if (appendIdx < parsedMessages.length) {
        // Format only the new messages
        let currentDate = ''
        const newLines = []
        for (let i = appendIdx; i < parsedMessages.length; i++) {
          const msg = parsedMessages[i]
          if (msg.date && msg.date !== currentDate) {
            currentDate = msg.date
            newLines.push(`\n--- ${msg.date} ---`)
          }
          newLines.push(msg.line)
        }
        newTranscript = existingTranscript + '\n' + newLines.join('\n')
      } else {
        // No new messages beyond existing — keep as is
        newTranscript = existingTranscript
      }
    } else {
      // Couldn't parse dates from existing — replace entirely
      newTranscript = parsedConversation
    }
  } else {
    // No existing transcript — save the full conversation
    newTranscript = parsedConversation
  }

  // Save a snapshot of THIS upload's raw transcript (never overwritten — preserves each upload)
  const snapshotName = `transcript-${chatStart}_to_${chatEnd}.txt`
  await uploadToDropbox(token, rootNs, `${basePath}/${snapshotName}`, Buffer.from(parsedConversation, 'utf8'))

  // Upload master transcript (cumulative — appends new messages)
  await uploadToDropbox(token, rootNs, `${basePath}/transcript.txt`, Buffer.from(newTranscript, 'utf8'), { overwrite: true })

  // Upload analysis snapshot keyed by chat window dates — skip if no analysis (transcript-only save)
  if (fullAnalysis) {
    const analysisJson = JSON.stringify({
      date: new Date().toISOString(),
      chatWindow: { firstMessageDate, lastMessageDate },
      fanName,
      fanUsername,
      creator: creatorName,
      fullAnalysis,
      managerBrief,
    }, null, 2)
    await uploadToDropbox(token, rootNs, `${basePath}/analysis-${chatStart}_to_${chatEnd}.json`, Buffer.from(analysisJson, 'utf8'))
  }

  // Update Fan Tracker with Dropbox path and chat upload date
  try {
    const trackerParams = new URLSearchParams()
    trackerParams.set('maxRecords', '1')
    trackerParams.set('filterByFormula', `{Fan Name} = "${fanName.replace(/"/g, '\\"')}"`)
    const trackerRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(FAN_TRACKER_TABLE)}?${trackerParams}`, {
      headers: AIRTABLE_HEADERS, cache: 'no-store',
    })
    const trackerData = await trackerRes.json()
    const tracker = trackerData.records?.[0]
    if (tracker) {
      await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(FAN_TRACKER_TABLE)}/${tracker.id}`, {
        method: 'PATCH',
        headers: AIRTABLE_HEADERS,
        body: JSON.stringify({
          fields: {
            'Dropbox Chat Path': basePath,
            'Last Chat Upload': new Date().toISOString(),
          },
        }),
      })
    }
  } catch (err) {
    console.error('[Chat Analysis] Fan tracker update failed:', err)
  }
}
