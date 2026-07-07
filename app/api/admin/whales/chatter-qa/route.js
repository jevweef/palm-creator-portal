import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'
import { ofApi, fetchChatHistory } from '@/lib/onlyfansApi'
import { stampWhaleRun } from '@/lib/whaleRuns'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Survey questions that define the creator's chat voice (see
// lib/onboarding/surveyQuestions.js — Personality & Voice + Chat Style).
const VOICE_KEYS = [
  'personality_3_words', 'chat_energy', 'fan_perception', 'signature_phrases',
  'texting_style', 'text_abbreviations', 'common_emojis', 'subscriber_terms',
  'representation', 'conversation_preference', 'disliked_in_conversations',
  'topics_to_avoid', 'traits_to_highlight', 'messages_to_redirect',
  'prohibited_words', 'prohibited_terminology', 'additional_personal_facts',
]

// POST — Chatter QA. Button-triggered. Scans recent messages OUR CHATTERS sent
// (as the creator) across her top conversations, judges them against the
// creator's voice profile (DNA fields + onboarding survey), and flags bad
// communication: broken English, doesn't-sound-like-a-20-something-US-girl,
// canned/overtly-sexual spam in 1:1 chat, off-voice/prohibited content.
// Timestamps are kept so flags can later be attributed to chatter shifts.
//
// Body: { creatorRecordId, days?=7, maxChats?=12 }
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorRecordId, days = 7, maxChats = 12 } = await request.json()
    if (!creatorRecordId) return NextResponse.json({ error: 'creatorRecordId required' }, { status: 400 })

    const creators = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(creatorRecordId)}`,
      fields: ['Creator', 'AKA', 'OF API Account ID', 'Brand Voice Notes', 'Profile Summary', 'Dos and Donts'],
    })
    const cf = creators[0]?.fields || {}
    const accountId = cf['OF API Account ID']
    if (!accountId) {
      return NextResponse.json({ error: `${cf.AKA || 'This creator'} isn't connected to the OnlyFans API yet` }, { status: 400 })
    }

    // ── Voice profile: DNA fields + survey answers ───────────────────────────
    let surveyBits = []
    try {
      const rows = await fetchAirtableRecords('Onboarding Survey Responses', {
        fields: ['Question Key', 'Question Text', 'Answer', 'Creator'],
      })
      surveyBits = rows
        .filter((r) => (r.fields?.Creator || []).includes(creatorRecordId))
        .filter((r) => VOICE_KEYS.includes(r.fields?.['Question Key']) && (r.fields?.Answer || '').trim())
        .map((r) => `- ${r.fields['Question Text'] || r.fields['Question Key']}: ${r.fields.Answer.trim()}`)
    } catch (e) {
      console.warn('[chatter-qa] survey read failed (continuing with DNA only):', e.message)
    }
    const voiceProfile = [
      cf['Profile Summary'] ? `PERSONALITY: ${cf['Profile Summary']}` : '',
      cf['Brand Voice Notes'] ? `VOICE: ${cf['Brand Voice Notes']}` : '',
      cf['Dos and Donts'] ? `DOS & DON'TS:\n${cf['Dos and Donts']}` : '',
      surveyBits.length ? `FROM HER OWN ONBOARDING SURVEY:\n${surveyBits.join('\n')}` : '',
    ].filter(Boolean).join('\n\n')

    // ── Collect recent creator-sent messages across top chats ───────────────
    const sinceIso = new Date(Date.now() - days * 86400000).toISOString()
    const chatsJson = await ofApi(`/${accountId}/chats?limit=20`)
    const chatList = (chatsJson?.data?.list || chatsJson?.data || chatsJson?.list || [])
    const fans = []
    for (const c of Array.isArray(chatList) ? chatList : []) {
      const fan = c?.fan || c?.withUser || {}
      if (fan?.id) fans.push({ id: String(fan.id), name: fan.name || fan.username || `fan ${fan.id}` })
      if (fans.length >= maxChats) break
    }

    const threads = []
    let creditsUsed = 0
    for (const fan of fans) {
      try {
        const { messages, credits } = await fetchChatHistory(accountId, fan.id, { sinceDate: sinceIso, maxPages: 3 })
        creditsUsed += credits || 0
        // Chatter-sent, personal (not mass-blast), has text, in window
        const sent = messages.filter((m) =>
          (m.isSentByMe === true || String(m?.fromUser?.id || '') !== fan.id) &&
          !m.isFromQueue &&
          (m.text || '').trim() &&
          m.createdAt >= sinceIso
        )
        if (sent.length) {
          threads.push({
            fan: fan.name,
            messages: sent.map((m) => ({
              at: m.createdAt,
              text: String(m.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500),
            })),
          })
        }
      } catch (e) {
        console.warn(`[chatter-qa] chat pull failed for fan ${fan.id}:`, e.message)
      }
    }
    const totalMsgs = threads.reduce((s, t) => s + t.messages.length, 0)
    if (!totalMsgs) {
      return NextResponse.json({ ok: true, creator: cf.AKA || cf.Creator, days, chatsScanned: fans.length, messagesReviewed: 0, findings: [], creditsUsed })
    }

    // ── Judge against the voice profile ──────────────────────────────────────
    const prompt = `You are QA-ing hired chatters who message fans AS the OnlyFans creator "${cf.AKA || cf.Creator}". Fans must never suspect they aren't talking to her — a natural-sounding 20-something American woman with the specific voice below.

${voiceProfile || '(No voice profile on file — judge against "natural 20-something US woman" only.)'}

Below are messages OUR CHATTERS sent in 1:1 conversations (mass promo blasts already excluded), grouped by fan. Flag ONLY genuinely bad messages — don't nitpick casual texting style (lowercase, abbreviations, emojis are normal). Flag:
- BROKEN_ENGLISH: grammar/phrasing a native US speaker wouldn't use ("kindly do the needful", wrong articles, ESL word order)
- NOT_NATURAL: robotic, scripted, or formal customer-service tone
- CANNED_SEXUAL: generic copy-paste sexy talk with zero connection to the conversation
- OFF_VOICE: contradicts her voice profile, prohibited words/topics, or breaks her persona/details
- RISKY: promises/meetups/platform-policy problems

Messages:
${JSON.stringify(threads, null, 1).slice(0, 60000)}

Respond with ONLY a JSON array (no prose). Each finding:
{"fan": "...", "at": "ISO timestamp", "message": "the exact message text", "issues": ["BROKEN_ENGLISH"], "severity": "low|medium|high", "why": "one short sentence", "better": "a natural rewrite in her voice"}
Empty array if nothing is genuinely bad.`

    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    })
    let findings = []
    try {
      const text = resp.content?.[0]?.text || '[]'
      const m = text.match(/\[[\s\S]*\]/)
      findings = JSON.parse(m ? m[0] : '[]')
    } catch { findings = [] }

    await stampWhaleRun(creatorRecordId, 'qa')
    return NextResponse.json({
      ok: true,
      creator: cf.AKA || cf.Creator,
      days,
      chatsScanned: fans.length,
      messagesReviewed: totalMsgs,
      hasVoiceProfile: !!voiceProfile,
      findings,
      creditsUsed,
    })
  } catch (err) {
    console.error('[whales/chatter-qa] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
