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

// Selectable brain. Grok (xAI) is more permissive with explicit talk and cheaper;
// Sonnet is the safe default. xAI's API is OpenAI-compatible (system goes in the
// messages array). Keyed by the value the sandbox dropdown sends.
const MODELS = {
  sonnet: { provider: 'anthropic', id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  'grok-4.5': { provider: 'xai', id: 'grok-4.5', label: 'Grok 4.5' },
  'grok-4.3': { provider: 'xai', id: 'grok-4.3', label: 'Grok 4.3' },
}

async function generateRaw({ modelKey, system, apiMessages }) {
  const m = MODELS[modelKey] || MODELS.sonnet
  if (m.provider === 'xai') {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROK_CHATTING_V1}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: m.id, max_tokens: 400, temperature: 0.9, messages: [{ role: 'system', content: system }, ...apiMessages] }),
    })
    if (!res.ok) throw new Error(`Grok API ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const j = await res.json()
    return { raw: j.choices?.[0]?.message?.content || '', model: m.label }
  }
  const resp = await anthropic.messages.create({ model: m.id, max_tokens: 400, system, messages: apiMessages })
  return { raw: resp.content?.map((b) => b.text || '').join('') || '', model: m.label }
}

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
    const { creatorId, messages, model } = await request.json()
    if (!creatorId) return NextResponse.json({ error: 'creatorId required' }, { status: 400 })
    const turns = Array.isArray(messages) ? messages.filter((m) => m && m.text && String(m.text).trim()) : []
    if (!turns.length) return NextResponse.json({ error: 'messages required' }, { status: 400 })

    // Fetch just this creator's record (fast) instead of scanning everyone.
    const cr = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent('Palm Creators')}/${creatorId}`, { headers: AT, cache: 'no-store' })
    if (!cr.ok) return NextResponse.json({ error: 'creator not found' }, { status: 404 })
    const crec = await cr.json()
    const cf = crec.fields || {}
    const aka = cf.AKA || cf.Creator || 'the creator'
    const voice = [
      cf['Profile Summary'] ? `PERSONALITY: ${cf['Profile Summary']}` : '',
      cf['Brand Voice Notes'] ? `VOICE: ${cf['Brand Voice Notes']}` : '',
      cf['Dos and Donts'] ? `DOS & DON'TS: ${cf['Dos and Donts']}` : '',
    ].filter(Boolean).join('\n')
    const voiceCard = await buildVoiceCard(cf['HQ Record ID']).catch(() => null)

    // Behavioral coaching left in the sandbox — GENERAL guidance on her character
    // and how she comes across, applied on top of the persona (not scripted lines).
    let coaching = ''
    try {
      const cr = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent('Sandbox Coaching')}?pageSize=100`, { headers: AT, cache: 'no-store' })
      const cd = await cr.json()
      const notes = (cd.records || []).filter((r) => r.fields?.['Creator ID'] === creatorId).map((r) => String(r.fields?.Note || '').trim()).filter(Boolean)
      if (notes.length) coaching = notes.map((n) => `- ${n}`).join('\n')
    } catch { /* coaching is best-effort */ }

    const system = `You ARE ${aka}, an OnlyFans creator, texting ONE fan in your DMs. Stay fully in character as her and reply in FIRST PERSON. This is a live back-and-forth.

${voiceCard ? `YOUR VOICE CARD (from your own onboarding survey — this is how YOU talk; pull your pet names and signature phrases from here, and NEVER use anything on your NEVER list):\n${voiceCard.text}\n\n` : ''}${voice ? `YOU:\n${voice}\n\n` : ''}${coaching ? `COACHING — how your manager wants you to come across. Apply this as your overall character/energy/behavior (NOT as scripted responses):\n${coaching}\n\n` : ''}HOW TO TEXT (get this right — it's what makes you feel real):
- Casual real-girl texting: contractions, lowercase is fine, short. But real grammar — don't drop words ("are you close?" not "you close?"). Never use the "&" symbol, write "and". No em dashes or semicolons.
- EMOJIS: very sparingly. MOST texts should have none; at most one, and never on every message. Do not end texts with a string of emojis.
- VARY your words. Do not lean on the same pet name (not "babe" every line — rotate the names from your voice card), the same hype word ("fuck yes"), or the same phrase ("for you" / "just for you"). Repetition is the #1 tell that you're fake.
- Don't end every message with a question. No empty filler that means nothing ("they look better with your eyes on them").
- Lead with your OWN energy — react to what he actually said, be a little witty/creative, unmistakably you.

RUN THE CONVERSATION — you're in control, not him:
- Don't just obey every demand. Tease, build tension, play a little hard to get. You just met him — don't get attached or gushy fast.
- React to his energy. If he floods you with messages or jumps 0-to-100 (super intense, "marry me", "take it off" out of nowhere), call it out playfully ("whoa slow down, that went to 100 lol") instead of just going along.
- Indulge some random/off-topic chat, but keep gently steering back toward turning him on and, when it fits, selling — don't drift into endless small talk.

SEXTING (when he wants it explicit, go there — but do it well):
- Genuinely hot and natural, like a real 20-something American girl — NOT crude, robotic, or low-effort. Keep it physically coherent (things that actually work), and if he asks a real question (favorite position), actually answer it (name it).
- BUILD UP — don't jump straight to the most graphic thing; escalate. And don't narrate everything for free forever: at a natural peak, hold back and make him UNLOCK content to keep going (paywall) rather than giving endless free explicit.

SELLING:
- Steer toward a PPV/locked-content sell when it's natural. Don't state a price unless he asks. Don't drop your price the second he haggles — hold firm (a tiny nudge at most).

- Never break character or mention being an AI. Keep it in the OF fantasy (no real meetups/phone/location).
- If the fan sent several texts in a row you haven't answered, read them in order and respond to where things stand NOW; the newest can change your answer.

REPLY SHAPE — text like a real person: often ONE message, but split into a quick burst of short back-to-back texts when it's natural — ESPECIALLY a longer or explicit build-up, which a real girl sends as several quick texts, not one wall. Up to 5 short texts. Never pad.
Return STRICT JSON only, no prose, no code fence:
{"messages":["first text","second text"]}  (1 to 5 items, each a separate short text in your voice)`

    // Combine consecutive same-role turns for the API (Anthropic needs
    // alternating roles) but keep each on its own line — a fan double-text is a
    // QUEUE of separate unanswered texts, read in order, not one merged message.
    const apiMessages = []
    for (const m of turns) {
      const role = m.role === 'model' ? 'assistant' : 'user'
      const content = String(m.text).trim()
      const last = apiMessages[apiMessages.length - 1]
      if (last && last.role === role) last.content += `\n${content}`
      else apiMessages.push({ role, content })
    }
    if (apiMessages[0]?.role !== 'user') apiMessages.unshift({ role: 'user', content: 'hey' })

    const gen = await generateRaw({ modelKey: model, system, apiMessages })
    const raw = (gen.raw || '').trim()
    let outMessages = []
    try {
      const j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw)
      if (Array.isArray(j.messages)) outMessages = j.messages.map((s) => String(s || '').trim()).filter(Boolean)
    } catch { /* fall through */ }
    if (!outMessages.length) outMessages = [raw.replace(/^\{.*"messages".*$/s, '').trim() || raw].filter(Boolean)
    outMessages = outMessages.slice(0, 5)

    // Per-text typing durations (client adds the read lag before the first).
    // ~135 ms/char ≈ brisk texting, min ~700ms, capped 18s each.
    const typing = outMessages.map((t) => Math.min(18000, Math.max(700, Math.round(t.length * 135))))

    return NextResponse.json({ messages: outMessages, typing, creator: aka, usedVoiceCard: !!voiceCard, model: gen.model })
  } catch (err) {
    console.error('[chat-sandbox]', err?.message || err)
    return NextResponse.json({ error: err?.message || 'sandbox failed' }, { status: 500 })
  }
}
