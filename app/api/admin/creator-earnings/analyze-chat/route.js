import { auth } from '@clerk/nextjs/server'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, downloadFromDropbox, createDropboxFolder } from '@/lib/dropbox'

export const maxDuration = 120

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) // still used for the lightweight manager-brief summary

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

async function saveToAirtable(record, { fanUsername, fanName, creatorName } = {}) {
  // Upsert: find existing analysis for this (fan, creator) and PATCH it, else POST new.
  // Prevents duplicate records and prevents a failed retry from hiding a prior success.
  try {
    let existingId = null
    if (fanUsername || fanName) {
      const terms = []
      if (fanUsername) terms.push(`{OF Username} = "${fanUsername.replace(/"/g, '\\"')}"`)
      else if (fanName) terms.push(`{Fan Name} = "${fanName.replace(/"/g, '\\"')}"`)
      if (creatorName) terms.push(`FIND("${creatorName.replace(/"/g, '\\"')}", {Creator})`)
      const formula = terms.length > 1 ? `AND(${terms.join(', ')})` : terms[0]
      const params = new URLSearchParams()
      params.set('maxRecords', '1')
      params.set('filterByFormula', formula)
      const lookupRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${FAN_ANALYSIS_TABLE}?${params}`, {
        headers: AIRTABLE_HEADERS, cache: 'no-store',
      })
      const lookupData = await lookupRes.json()
      existingId = lookupData.records?.[0]?.id || null
    }

    const url = existingId
      ? `https://api.airtable.com/v0/${OPS_BASE}/${FAN_ANALYSIS_TABLE}/${existingId}`
      : `https://api.airtable.com/v0/${OPS_BASE}/${FAN_ANALYSIS_TABLE}`
    const method = existingId ? 'PATCH' : 'POST'
    const body = existingId
      ? JSON.stringify({ fields: record, typecast: true })
      : JSON.stringify({ records: [{ fields: record }], typecast: true })

    const res = await fetch(url, { method, headers: AIRTABLE_HEADERS, body })
    if (!res.ok) {
      // Surface the actual Airtable error — silent 422s were hiding successful analyses
      const errText = await res.text().catch(() => '')
      console.error(`[Airtable Save] ${method} failed ${res.status}: ${errText.slice(0, 500)}`)
      throw new Error(`Airtable save failed (${res.status}): ${errText.slice(0, 200)}`)
    }
    console.log(`[Airtable Save] ${method} ok — ${existingId || 'new record'} — ${fanName || fanUsername}`)
  } catch (e) {
    console.error('[Airtable Save] Exception:', e?.message || e)
    throw e // let the caller decide whether to surface
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
    // creatorAka is the name chatters know her by ("Sunny", "Taby") — used in the
    // prompt text and output so briefs reference the stage name, not the legal name.
    // creatorName (full legal name) is still used for Airtable Creator field saves,
    // Dropbox path consistency, and prior-analysis lookups.
    const creatorAka = formData.get('creatorAka') || creatorName
    // accountName + accountKey — present only when the fan is subscribed to multiple accounts
    // and the user explicitly chose which account's chat this upload represents.
    const accountName = formData.get('accountName') || ''
    const accountKey = getAccountKey(accountName) // null for single-account fans

    let parsed
    if (useTranscript) {
      // Re-analyze from saved Dropbox transcript (no HTML upload needed)
      const fanUsername = formData.get('fanUsername') || ''
      // Re-analyze path: no accountKey → loads combined multi-account transcript when present
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
      // Prefer client-side parsed payload (keeps us under the 4.5MB body limit)
      const parsedConversation = formData.get('parsedConversation')
      if (parsedConversation) {
        let clientMessages = []
        try { clientMessages = JSON.parse(formData.get('parsedMessages') || '[]') } catch {}
        parsed = {
          conversation: parsedConversation,
          messages: clientMessages,
          messageCount: clientMessages.length,
          fanMessages: parseInt(formData.get('parsedFanMsgs')) || clientMessages.filter(m => m.sender === 'FAN').length,
          creatorMessages: parseInt(formData.get('parsedCreatorMsgs')) || clientMessages.filter(m => m.sender === 'CREATOR').length,
          firstMessageDate: formData.get('parsedFirstDate') || '',
          lastMessageDate: formData.get('parsedLastDate') || '',
        }
      } else {
        if (!file) return Response.json({ error: 'No file uploaded' }, { status: 400 })
        const html = await file.text()
        parsed = parseChatHtml(html)
      }
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
          accountKey,
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
- Creator name (refer to her as this in the brief): ${creatorAka}${chatWindowNote}
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
      ? `You are a whale-hunting analyst for an OnlyFans management agency. Your output is a brief that a chat manager will hand to a chatter so they can send the right next message to one specific fan.

YOUR AUDIENCE: a chat manager, who passes the brief to a chatter. Write at an 8th-grade reading level. No jargon. No business-school framing. No archetype labels or internal classification language in the final output. The chatter must be able to scan and use this in under 60 seconds.

CREATOR NAME: The SPENDING DATA block in the user message gives you her stage/AKA name (e.g. "Sunny", "Taby") — that's what chatters and fans know her as. Use that name throughout the brief. Never use a legal/full name even if you see one elsewhere. If no AKA is given, just say "the creator."

YOUR PROCESS (internal reasoning — do NOT include in the output):

STEP 1: Classify this fan internally (affects tone + depth of your output, not shown to reader).
  - FAN TYPE: one of — relational_whale, fetish_specialist, transactional_regular, light_budget_loyalist, literary_emotional, romantic_admirer, spam_tolerant_submissive, surface_casual
  - STATE: one of — healthy, uptrend, cool_off, price_stuck, content_starved, burnout_recovery, binge_wave, long_silent
  - TIER: small_ticket / mid / whale / patron (based on lifetime + cadence + behavior)
  - GOAL: re_engage / maintain / upgrade / monitor / low_priority

STEP 2: Diagnose neutrally. The three possible causes of whatever happened are:
  (a) Chatter-side actions (when supported by evidence, quote the specific mistake + date)
  (b) Fan-side factors (explicit budget signals, life events, stated loss of interest, saturation)
  (c) Ambient / unclear — sometimes the honest answer is "we don't know why he went quiet"
  Cite dates and direct quotes. Vibes labels like "mass messages" or "personal circumstances" are NOT enough — you must name the specific evidence.

STEP 3: Check for these specific patterns and surface them as evidence when present:
  - STATED BUDGET: Did the fan say a specific dollar amount he could afford ("I can do $X", "max is $Y", "I'm broke")? Did the creator price above that ceiling in the 30 days after? If so, compute the ratio (ask ÷ ceiling) and cite the dates.
  - UNFULFILLED PROMISES: Did the creator promise a specific thing ("I'll make you a custom", "I'll send you X", "maybe one day") and never follow through? Track them.
  - CHATTER HANDOVER: Did a new chatter ask a question the previous one should already know (name, nickname, hometown, recent purchase)? That's a handover failure. Flag the date.
  - LIFE EVENTS: Death, funeral, illness, job loss, breakup. If mentioned, did the creator-side acknowledge with empathy before pivoting to content? If not, name the specific failure.
  - STATED LOVE-LANGUAGE: Did the fan use direct instructions ("treat me like X", "I'd rather X than Y", "don't do X")? Did the creator comply within 14 days? If not, quote both.
  - CONTENT-TYPE MISMATCH: Is the creator-side content the fan engages with different from what they've been sending lately (e.g. romantic → hardcore, banter → mass PPV)?
  - LIFETIME VS RECENT PATTERN: Quote-backs (creator pasting fan's words back without adding new content) and recycled scripts (same paragraph used 2+ times).
  - DISPLAY-NAME METADATA: If the fan's display name contains operator notes ("Read pin//VIP...", "for sale $300", status emojis), extract them as pending-deal context.

STEP 3.5: MINE INLINE PURCHASE MARKERS. The chat HTML contains inline payment markers like "$10 paid", "Tipped $X", "Purchased ... for $X" attached to specific messages. Treat these as QUALITATIVE buy-trigger evidence — what he actually pays for and what message preceded the payment — NOT as totals.
  - Note the CONTENT TYPE he pays for (pool sets, voice notes, customs, specific kinks, PPV topics) with one-line quote/date evidence
  - Note the MESSAGE TONE/HOOK that preceded each payment (morning check-in, flirty tease, direct ask, voice note, etc.) — "what works" patterns
  - Note what he IGNORED — expensive PPVs he didn't open, pitches that died
  - Include 1-2 concrete "proven buy trigger" observations in WHAT HE BUYS. Be specific: "He opened a $25 PPV after the pool-set preview on Apr 2 — waterproof/poolside angles convert."
  - Chat-observed purchases older than the spending context block are fine to use for qualitative patterns. They remain valid insight about who he is.

STEP 4: Build the dossier. Tag every personal detail as:
  - TIMELESS (always safe to reference): name, pets, job, ongoing hobbies, hometown, stated kinks, family situation, core values
  - TIME-SENSITIVE (stale after ~3 weeks): specific trips, "how was your weekend," upcoming events he mentioned, current-events reactions
  In the output, stale time-sensitive details get CONVERTED to timeless facts. Example: "He was in Asheville last November" → "He loves Asheville, dreams of moving there."

STEP 5: Identify SLEEPING THREADS — unfinished deals (pitched but not closed with fan showing soft interest), unacknowledged moments (life events passed by, apologies not delivered), unanswered signals.

STEP 6: Prescribe ONE concrete next move. Include a ready-to-send sample message. Include what to do if he replies, and what to do if he doesn't.

HARD RULES:
  1. NEVER tell the team to give up on a fan. No "write off," "mark as lost," "move on." If odds are low, say so and prescribe patience — the door stays open.
  2. Don't reference anything time-sensitive unless it's still fresh (within ~3 weeks of "today" in the chat). Stale hooks become timeless facts.
  3. Every claim needs evidence — a quote or a date. No vibes.
  4. Sample messages must be copy-paste ready. Do not write "reference his past messages" — pull the actual phrase.
  5. No jargon in the OUTPUT. Translate internal concepts:
     - "quote-back pattern" → "pasting his own messages back at him"
     - "archetype" / "fan type" → don't mention, just write advice appropriate to the type
     - "cadence" → "pacing"
     - "stated budget" → "he said he could afford $X"
  6. "Personal circumstances" / "natural cooling" are not diagnoses. Either name a specific signal or say "we don't know why."
  7. The chatter should never have to scroll back through chat history. If a moment matters, quote it here.
  8. No em-dashes, no corporate voice. Write like a friend telling another friend what's going on.
  9. ALL dollar totals, lifetime numbers, rolling-30-day figures, and trend math come from the SPENDING DATA block above — that is the single source of truth. NEVER cite aggregate dollar amounts from inline chat purchase markers (e.g. don't say "he spent ~$400 in 2023"). Inline markers are qualitative buy-trigger evidence only — name content types and hooks, not totals.
  10. MULTI-THREAD AWARENESS: If the conversation is split into sections with headers like "=== FREE OF THREAD ===" and "=== VIP OF THREAD ===", this fan is subscribed to two separate OF pages run by the same creator. Each thread is its own chat — do NOT assume context, nicknames, or inside jokes from one thread carry over to the other. Analyze behavior PER THREAD (what does he pay for on each page? how does he talk differently on each?) and surface the distinction in your output when it's meaningful ("he buys PPVs on VIP but only banters on Free"). When sample messages / next moves are prescribed, specify which account they're for.

OUTPUT FORMAT (produce exactly these sections in this order, with these exact headings).

HARD LENGTH CEILING: 1000 words for the most complex patron-tier fan. 400-600 words for a simpler fan. If you hit 1000 words, stop — cut the least important bullet or shorten sentences. Do NOT pad simple fans. Specificity over length. No filler, no restatement across sections.

FAN: [Display name] ([username])  •  [creator]  •  $[lifetime] total  •  [N] days since he last replied

QUICK READ
[1-2 sentences. The situation and what's at stake. Don't rehash evidence — that's the next section.]

WHAT HAPPENED
[3-6 sentences. Name the specific dated moment(s) that caused the current situation with quoted evidence. If a chatter action triggered it, say what. If a fan-side factor, cite the quote. If genuinely unclear, say so. Do not speculate past the evidence.]

WHO HE IS
[4-7 bulleted timeless facts. One short line each. Name/nickname, location, job, pets, ongoing hobbies, stated values. Each line should still be true 6 months from now — skip stale specifics.]

WHAT HE BUYS & HOW TO WRITE TO HIM
Content he responds to:
  - [specific thing + short quote evidence]
  - [specific thing]
  - [specific thing]
Avoid:
  - [specific thing + evidence]
  - [specific thing]
How to write: [2-3 sentences on tone, reply length, key do's and don'ts. Plain language, no lectures.]

SLEEPING THREADS
[Numbered. Only real, dated, specific threads — unfinished deals with dollar amounts, unacknowledged life events, explicit preferences not honored. If there aren't any, write "None surfaced." Don't pad. Each: one line for what it is + one line for why it matters.]

NEXT MOVE
[1-2 sentences of guidance. Then a sample message in a quote block, copy-paste ready:]

> "[Ready-to-send message. References specific timeless facts from the dossier. No sell. No content. No pricing.]"

[1-2 sentences for what to do if he replies. 1 sentence for what to do if he doesn't. Never "give up" — low odds means prescribe patience, not abandonment.]`

      : `You are a whale-hunting analyst for an OnlyFans agency. Your output is a short brief a chat manager will hand to a chatter. Write plainly, no jargon.

${spendingContext}

Read the conversation and produce a short brief in this exact format:

FAN: [Display name] ([username])  •  [creator]  •  $[lifetime] total  •  [N] days since he last replied

QUICK READ
[2-3 sentences. What's going on in plain words.]

WHAT HAPPENED
[2-4 sentences of neutral diagnosis — chatter-side action, fan-side factor (budget, life event), or genuinely unclear. Cite a dated quote if there is one. If we don't know, say so.]

WHO HE IS
[2-4 bulleted timeless facts only — name, location, job, hobbies, pets. Skip stale specifics.]

WHAT HE BUYS
Content he responds to:
  - [with quote evidence]
Avoid:
  - [what has killed conversations before]

NEXT MOVE
[One short paragraph of plain guidance. Then a sample message in a quote block that's ready to send:]

> "[Ready-to-send message using timeless facts from above. No sell, no pricing, no content.]"

[Then: what to do if he replies, what to do if he doesn't. Never tell the team to give up — if odds look low, prescribe patience instead.]

HARD RULES:
- Never write "mark as lost," "write off," "move on," "cold list" — doors stay open.
- Every claim needs a quote or date as evidence. No vibes labels.
- Sample messages must be copy-paste ready. Pull actual phrases from the chat.
- If the fan is a $50 one-off with no rapport, output 3 sentences total with guidance to "keep it light, no investment" rather than a full brief.
- Inline chat payment markers ("$10 paid", "Tipped $X", "Purchased ... for $X") are QUALITATIVE buy-trigger evidence — use them to name content types and hooks that convert, NOT to cite dollar totals. All totals come from the SPENDING DATA block above.`

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

    // Determine if fan is currently active — check spending data directly, don't require tracker record
    // Thresholds intentionally strict so fans who only have subscription-tier activity ($8/mo auto-renew)
    // don't get flagged as hot. Rolling30 needs to reflect meaningful purchases.
    const fanIsHot = (priorResult?.isHot) || (
      rolling30 >= 40 && // floor — subscription-only activity won't clear this
      monthlyAvg90 > 0 &&
      rolling30 >= monthlyAvg90 * 0.5 &&
      currentGap < (medianGap > 0 ? medianGap * 2 : 30)
    )

    // If fan is currently hot/spending, tell the model to frame output as maintenance, not recovery.
    let finalPrompt = systemPrompt
    if (fanIsHot) {
      finalPrompt += `\n\nCURRENT STATE NOTE: Spending data shows this fan is ACTIVE and spending right now. Your internal classification STATE should be "healthy" or "uptrend," not "cool_off." Frame the brief around keeping him engaged and protecting the momentum, not around re-engagement. The "WHAT HAPPENED" section should describe what's going RIGHT (what brought him back or what's keeping him hot). NEXT MOVE should prescribe how to ride the wave without breaking it.`
    }
    // systemWithContext stays stable across fans for prompt caching.
    // Per-fan context (priorContext) moves to the user message.
    const systemWithContext = finalPrompt

    // Load accumulated chat history from Dropbox and merge with new upload.
    // For multi-account fans (accountKey present), the merge is scoped to THIS account's
    // transcript only — then the OTHER account's transcript is appended separately with a
    // thread header so Claude can reason across both pages without conflating them.
    const fanUsername = formData.get('fanUsername') || ''

    // Helper: dedup-merge a new-upload conversation against an existing transcript for the same thread
    const mergeThread = (existing, incoming) => {
      if (!existing) return incoming
      const dateHeaders = [...existing.matchAll(/--- (.+?) ---/g)]
      const lastExistingDate = dateHeaders.length > 0 ? dateHeaders[dateHeaders.length - 1][1] : ''
      if (!lastExistingDate) return existing + '\n\n' + incoming
      const newDateHeaders = [...incoming.matchAll(/--- (.+?) ---/g)]
      let newStartIdx = -1
      for (const m of newDateHeaders) {
        if (m[1] > lastExistingDate) { newStartIdx = m.index; break }
      }
      if (newStartIdx > 0) {
        return existing + '\n\n--- NEW MESSAGES SINCE LAST ANALYSIS ---\n' + incoming.slice(newStartIdx)
      }
      return existing + '\n\n--- UPDATED UPLOAD (may include overlapping dates) ---\n' + incoming
    }

    let fullConversation = conversation
    if (priorContext) {
      try {
        if (accountKey) {
          // Multi-account upload: merge new conversation into THIS account's history,
          // then append OTHER account-keyed transcripts as separate labeled threads.
          const thisAccountHistory = await loadChatHistory(creatorName, fanName, fanUsername, accountKey)
          const thisThreadMerged = mergeThread(thisAccountHistory, conversation)
          const thisLabel = getThreadLabel(accountKey)
          const parts = [`=== ${thisLabel} ===\n${thisThreadMerged}`]

          // Find and include other account threads (free/vip only, to start)
          const otherKeys = ['free', 'vip'].filter(k => k !== accountKey)
          for (const otherKey of otherKeys) {
            const otherText = await loadChatHistory(creatorName, fanName, fanUsername, otherKey)
            if (otherText && otherText.trim()) {
              parts.push(`=== ${getThreadLabel(otherKey)} ===\n${otherText}`)
            }
          }
          fullConversation = parts.join('\n\n')
        } else {
          // Single-account upload (or legacy fan): existing behavior.
          const existingTranscript = await loadChatHistory(creatorName, fanName, fanUsername)
          if (existingTranscript) {
            fullConversation = mergeThread(existingTranscript, conversation)
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

    // Main whale-hunting analysis — Claude Sonnet 4.6.
    // Streaming + finalMessage() so long outputs don't hit HTTP timeouts.
    // Prompt caching on the system prompt saves cost on repeat calls.
    // Thinking OFF for now — with thinking on, a chunk of max_tokens gets spent
    // before text output starts, and we can silently end up with zero text blocks.
    // Revisit once we've validated the base output quality.
    // Hard ceiling: ~1000 words for patrons (~1500 tokens), 400-600 for simpler
    // fans. max_tokens gives a small buffer above the prompt ceiling; the model
    // is instructed to stop at 1000 words. Billed per actual token generated.
    const claudeMaxTokens = isHighValue ? 2000 : 1000
    let fullAnalysis = 'Analysis failed'
    let claudeUsage = null
    let claudeStopReason = null
    try {
      // Per-fan volatile content goes in the user message; the system prompt
      // stays byte-stable across fans so prompt caching actually hits.
      const userContent = [
        spendingContext,
        priorContext || '',
        '---',
        `Analyze this conversation between ${creatorAka} (CREATOR) and ${fanName} (FAN):`,
        '',
        fullConversation,
      ].filter(Boolean).join('\n\n')
      const stream = anthropic.messages.stream({
        model: 'claude-sonnet-4-6',
        max_tokens: claudeMaxTokens,
        system: [
          { type: 'text', text: systemWithContext, cache_control: { type: 'ephemeral' } },
        ],
        messages: [
          { role: 'user', content: userContent },
        ],
      })
      const claudeMessage = await stream.finalMessage()
      claudeUsage = claudeMessage.usage
      claudeStopReason = claudeMessage.stop_reason
      const textBlock = claudeMessage.content.find(b => b.type === 'text')
      if (textBlock?.text) {
        fullAnalysis = textBlock.text
      } else {
        console.error('[Whale Analysis] Claude returned no text block. stop_reason:', claudeStopReason, 'content blocks:', claudeMessage.content.map(b => b.type))
        fullAnalysis = `Analysis failed — model stopped before producing output (reason: ${claudeStopReason}). Try again or contact support.`
      }
    } catch (err) {
      console.error('[Whale Analysis] Claude call threw:', err?.status, err?.message, err?.error)
      fullAnalysis = `Analysis failed — ${err?.message || 'unknown error'}. Check Vercel logs for details.`
    }

    // Cost + usage logging for real-time visibility (Anthropic Console lags ~15min-2hr)
    if (claudeUsage) {
      const input = claudeUsage.input_tokens || 0
      const output = claudeUsage.output_tokens || 0
      const cacheRead = claudeUsage.cache_read_input_tokens || 0
      const cacheCreate = claudeUsage.cache_creation_input_tokens || 0
      // Sonnet 4.6 pricing per million tokens
      const cost = (input * 3 + output * 15 + cacheRead * 0.3 + cacheCreate * 3.75) / 1_000_000
      console.log(`[Whale Analysis] ${fanName} • ${creatorAka} | stop_reason=${claudeStopReason} | in=${input} out=${output} cacheR=${cacheRead} cacheW=${cacheCreate} | $${cost.toFixed(4)}`)
    }

    // Run manager brief, Dropbox save, and fan tracker upsert in parallel
    const creatorRecordId = formData.get('creatorRecordId') || ''
    const lastPurchaseDate = formData.get('lastPurchaseDate') || ''

    // Run manager brief + fan tracker in parallel
    const [briefResult] = await Promise.all([
      openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `You write chat manager briefs for an OnlyFans agency. Distill the full fan analysis into a scannable brief, around 150-175 words total. Plain language, no jargon.

Format:

**${fanName}** (@${formData.get('fanUsername') || '?'}) — $${lifetime.toLocaleString()} lifetime | ${currentGap}d since last purchase

**Situation**
(2-3 sentences. What's going on with specific dated evidence. Call out whether this is a cool-off, budget issue, burnout, or uptrend. If there's a sleeping deal or unfulfilled promise worth knowing about, mention it here in one phrase.)

**Action**
(2-3 sentences. The specific next move. Include what NOT to do. If a short sample reopener fits, quote it inline.)

**Key Insight**
(1-2 sentences. The single thing a chatter should internalize — the "why" behind the action.)

Rules:
- Use the creator's AKA (stage name), never a legal/full name
- Cite specific dates, dollar amounts, or quoted phrases from the full analysis
- No padding, no generic relationship-advice language
- Never tell the team to give up. Low odds = prescribe patience, not abandonment.
- Target ~150-175 words. Do not pad. Do not cut evidence to hit the number.` },
          { role: 'user', content: fullAnalysis },
        ],
        temperature: 0.5,
        max_tokens: 400,
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
        accountKey,
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
    }, { fanUsername, fanName, creatorName }).catch(err => console.error('[Chat Analysis] Airtable save failed:', err)),
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
          // Manual analysis → "Analyzed" status. "Going Cold" is reserved for
          // fans flagged by the auto-detection algorithm (goingColdAlerts).
          'Status': 'Analyzed',
          'First Flagged': now,
          'Lifetime Spend': lifetime || 0,
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

// Normalize an OF account name ("Sunny - Free OF", "Taby - VIP OF") into a short
// filename-safe key so multi-account fans can keep separate threads on Dropbox.
// Returns null for single-account fans or when no account is known.
function getAccountKey(accountName) {
  if (!accountName) return null
  if (/free/i.test(accountName)) return 'free'
  if (/vip/i.test(accountName)) return 'vip'
  const slug = accountName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)
  return slug || null
}

// Human-readable thread label used in combined multi-account transcripts fed to Claude.
function getThreadLabel(accountKey) {
  if (accountKey === 'free') return 'FREE OF THREAD'
  if (accountKey === 'vip') return 'VIP OF THREAD'
  if (!accountKey) return null
  return `${accountKey.toUpperCase()} THREAD`
}

// Filename for the master transcript for a given account key.
// null/undefined key returns the legacy single-account filename for backward compat.
function getTranscriptFilename(accountKey) {
  return accountKey ? `transcript-${accountKey}.txt` : 'transcript.txt'
}

// Load master transcript(s) from Dropbox.
// - When accountKey is passed, loads ONLY that account's transcript (used for per-account dedup on save).
// - When accountKey is null/undefined, prefers account-keyed transcripts (free+vip etc., combined with
//   thread headers so Claude can see both sides of a multi-account fan). Falls back to the legacy
//   single-account transcript.txt when no keyed transcripts exist.
async function loadChatHistory(creatorName, fanName, fanUsername, accountKey = null) {
  try {
    const token = await getDropboxAccessToken()
    const rootNs = await getDropboxRootNamespaceId(token)
    const basePath = getChatBasePath(creatorName, fanName, fanUsername)

    // Specific account requested
    if (accountKey) {
      const fullPath = `${basePath}/${getTranscriptFilename(accountKey)}`
      try {
        const buf = await downloadFromDropbox(token, rootNs, fullPath)
        return buf ? buf.toString('utf8') : ''
      } catch { return '' }
    }

    // No key — try account-keyed transcripts first (multi-account case)
    const keyedFiles = ['transcript-free.txt', 'transcript-vip.txt']
    const segments = []
    for (const filename of keyedFiles) {
      try {
        const buf = await downloadFromDropbox(token, rootNs, `${basePath}/${filename}`)
        if (buf) {
          const text = buf.toString('utf8')
          if (text.trim()) {
            const key = filename.replace(/transcript-|\.txt/g, '')
            const label = getThreadLabel(key)
            segments.push(`\n=== ${label} ===\n${text}`)
          }
        }
      } catch {}
    }
    if (segments.length > 0) return segments.join('\n').trim()

    // Fall back to legacy single-account transcript
    try {
      const buf = await downloadFromDropbox(token, rootNs, `${basePath}/transcript.txt`)
      return buf ? buf.toString('utf8') : ''
    } catch { return '' }
  } catch (err) {
    console.error('[Chat History] Load failed:', err.message || err)
    return ''
  }
}

// Save parsed chat transcript to Dropbox, appending only new messages.
// When accountKey is provided (multi-account fan), the master transcript is scoped to
// that account (e.g. transcript-free.txt). The per-upload snapshot and analysis JSON
// are also account-tagged so both accounts can coexist in the same folder.
async function saveChatToDropbox({ parsedConversation, parsedMessages, fullAnalysis, managerBrief, creatorName, fanName, fanUsername, firstMessageDate, lastMessageDate, accountKey }) {
  const token = await getDropboxAccessToken()
  const rootNs = await getDropboxRootNamespaceId(token)
  const basePath = getChatBasePath(creatorName, fanName, fanUsername)
  const runDate = new Date().toISOString().split('T')[0]
  const transcriptFilename = getTranscriptFilename(accountKey)
  const accountTag = accountKey ? `-${accountKey}` : ''

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

  // Download existing master transcript for THIS account key (if it fails, treat as first upload)
  let existingTranscript = ''
  try {
    const existingBuf = await downloadFromDropbox(token, rootNs, `${basePath}/${transcriptFilename}`)
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

  // Save a snapshot of THIS upload's raw transcript (never overwritten — preserves each upload).
  // Tagged with accountKey when present so free/vip snapshots don't collide.
  const snapshotName = `transcript${accountTag}-${chatStart}_to_${chatEnd}.txt`
  await uploadToDropbox(token, rootNs, `${basePath}/${snapshotName}`, Buffer.from(parsedConversation, 'utf8'))

  // Upload master transcript (cumulative — appends new messages; per-account when keyed)
  await uploadToDropbox(token, rootNs, `${basePath}/${transcriptFilename}`, Buffer.from(newTranscript, 'utf8'), { overwrite: true })

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
    await uploadToDropbox(token, rootNs, `${basePath}/analysis${accountTag}-${chatStart}_to_${chatEnd}.json`, Buffer.from(analysisJson, 'utf8'))
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
