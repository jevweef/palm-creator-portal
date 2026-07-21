import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireAdmin } from '@/lib/adminAuth'
import { buildVoiceCard } from '@/lib/voiceCard'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Live-chat SANDBOX. You play the fan; the AI plays the creator (her real voice
// card + persona). Same grounding the live-chat "Suggest" brain uses, but as a
// natural back-and-forth (single in-character reply per turn) so Evan can feel
// out how she chats across scenarios. Admin-only, no real fan data touched.

const OPS_BASE = 'applLIT2t83plMqNx'
const AT = { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` }
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function fetchCreators() {
  let out = []
  const p = new URLSearchParams({ pageSize: '100' })
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent('Palm Creators')}?${p}`, { headers: AT, cache: 'no-store' })
    const j = await r.json()
    out = out.concat(j.records || [])
    if (!j.offset) break
    p.set('offset', j.offset)
  }
  return out
}

// GET → list creators that have a persona to roleplay (voice/profile/voice card).
export async function GET() {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const creators = await fetchCreators()
    const list = creators
      .map((c) => {
        const f = c.fields || {}
        const hasPersona = !!(f['Profile Summary'] || f['Brand Voice Notes'] || f['Dos and Donts'] || f['HQ Record ID'])
        return hasPersona ? {
          id: c.id, name: f.AKA || f.Creator || 'Unknown',
          rich: !!(f['Profile Summary'] && f['Brand Voice Notes']),
        } : null
      })
      .filter(Boolean)
      .sort((a, b) => (b.rich - a.rich) || a.name.localeCompare(b.name))
    return NextResponse.json({ creators: list })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST { creatorId, messages:[{role:'fan'|'model', text}] } → the creator's next
// reply to the fan, in her voice.
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const { creatorId, messages } = await request.json()
    if (!creatorId) return NextResponse.json({ error: 'creatorId required' }, { status: 400 })
    const turns = Array.isArray(messages) ? messages.filter((m) => m && m.text && String(m.text).trim()) : []
    if (!turns.length) return NextResponse.json({ error: 'messages required' }, { status: 400 })

    const creators = await fetchCreators()
    const crec = creators.find((c) => c.id === creatorId)
    if (!crec) return NextResponse.json({ error: 'creator not found' }, { status: 404 })
    const cf = crec.fields || {}
    const aka = cf.AKA || cf.Creator || 'the creator'
    const voice = [
      cf['Profile Summary'] ? `PERSONALITY: ${cf['Profile Summary']}` : '',
      cf['Brand Voice Notes'] ? `VOICE: ${cf['Brand Voice Notes']}` : '',
      cf['Dos and Donts'] ? `DOS & DON'TS: ${cf['Dos and Donts']}` : '',
    ].filter(Boolean).join('\n')
    const voiceCard = await buildVoiceCard(cf['HQ Record ID']).catch(() => null)

    const system = `You ARE ${aka}, an OnlyFans creator, texting ONE fan in your DMs. Stay fully in character as her and reply in FIRST PERSON. This is a live back-and-forth — send only the NEXT message you'd text him, nothing else.

${voiceCard ? `YOUR VOICE CARD (from your own onboarding survey — this is exactly how YOU talk; use your pet names, signature phrases, and emojis, and NEVER use anything on your NEVER list):\n${voiceCard.text}\n\n` : ''}${voice ? `YOU:\n${voice}\n\n` : ''}HOW TO TEXT:
- Real-girl texting: casual, warm, contractions, lowercase is fine. No em dashes or semicolons. Usually one or two short sentences.
- Sound like YOU — use your own pet names / phrases / emojis; obey your NEVER list to the letter.
- Chat naturally and flirt; you can steer toward selling content/PPV when it feels natural, but never a hard sell or spammy. Match his energy.
- Never break character, never mention you are an AI, never describe what you're doing — just send the message.
- Do not invent real-life logistics (meetups, phone numbers, real location); keep it in the OF fantasy.`

    const apiMessages = turns.map((m) => ({
      role: m.role === 'model' ? 'assistant' : 'user',
      content: String(m.text).trim(),
    }))
    // Anthropic requires the first message to be from the user. The sandbox
    // always starts with the fan, so this holds.
    if (apiMessages[0]?.role !== 'user') apiMessages.unshift({ role: 'user', content: 'hey' })

    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system,
      messages: apiMessages,
    })
    const reply = (resp.content?.map((b) => b.text || '').join('') || '').trim()
    // A realistic "typing" delay the client can honor: a short read pause + time
    // scaled to reply length, lightly randomized, capped so it stays testable.
    const typingMs = Math.min(14000, 1400 + reply.length * 45 + Math.floor((reply.length % 7) * 250))

    return NextResponse.json({ reply, creator: aka, typingMs, usedVoiceCard: !!voiceCard })
  } catch (err) {
    console.error('[chat-sandbox]', err?.message || err)
    return NextResponse.json({ error: err?.message || 'sandbox failed' }, { status: 500 })
  }
}
