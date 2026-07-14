import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireLiveChatAccess } from '@/lib/adminAuth'
import { guardAccount } from '@/lib/chatTeamScope'
import { quoteAirtableString } from '@/lib/airtableFormula'
import { buildVoiceCard } from '@/lib/voiceCard'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// SUGGEST MODE (draft-only, never auto-sends). Given a fan thread the operator
// is looking at in /admin/live-chat, draft the next message AS the creator —
// grounded in (a) her voice profile, (b) how she ACTUALLY texts this fan (the
// real outbound lines in the thread = free few-shot), and (c) the fan's deep
// dossier (buying formula / price band / preferences / NEVERs) when one exists.
// This is the same brain as the nightly grader, pointed forward: instead of
// "was that message right for this fan?", it answers "what IS the right message?"

const OPS_BASE = 'applLIT2t83plMqNx'
const FAN_ANALYSIS_TABLE = 'tblNMtOEg2AIzvLDK'
const AT = { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` }
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const strip = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

async function atAll(table, params = {}, pages = 2) {
  let out = []
  const p = new URLSearchParams(params)
  p.set('pageSize', '100')
  for (let i = 0; i < pages; i++) {
    const r = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(table)}?${p}`, { headers: AT, cache: 'no-store' })
    const j = await r.json()
    out = out.concat(j.records || [])
    if (!j.offset) break
    p.set('offset', j.offset)
  }
  return out
}

export async function POST(request) {
  try { await requireLiveChatAccess() } catch (e) { return e }
  try {
    const body = await request.json()
    const account = String(body.account || '')
    const fan = String(body.fan || '')          // username or name key from the URL
    const fanName = String(body.fanName || '')   // human display name if the UI has it
    const messages = Array.isArray(body.messages) ? body.messages : []
    if (!account || !fan) return NextResponse.json({ error: 'account and fan required' }, { status: 400 })
    try { await guardAccount(request, account) } catch (e) { return e }

    // ── Resolve the creator from the OF account id → voice profile ──
    const creators = await atAll('Palm Creators')
    const crec = creators.find((c) =>
      String(c.fields?.['OF API Account ID'] || '').split(',').map((s) => s.trim()).filter(Boolean).includes(account))
    const cf = crec?.fields || {}
    const aka = cf.AKA || cf.Creator || 'the creator'
    const creatorNames = [cf.AKA, cf.Creator].filter(Boolean)
    const voice = [
      cf['Profile Summary'] ? `PERSONALITY: ${cf['Profile Summary']}` : '',
      cf['Brand Voice Notes'] ? `VOICE: ${cf['Brand Voice Notes']}` : '',
      cf['Dos and Donts'] ? `DOS & DON'TS: ${cf['Dos and Donts']}` : '',
    ].filter(Boolean).join('\n')

    // ── Voice Card: her onboarding survey, verbatim — the concrete chatting
    // gold (pet names, signature phrases, emoji palette, never-say words, sample
    // replies) that the 1-3 sentence Brand Voice Notes summary throws away.
    // Keyed by the creator (HQ Record ID) so a VIP + Free page share one voice.
    const voiceCard = await buildVoiceCard(cf['HQ Record ID']).catch(() => null)

    // ── Resolve this fan's dossier (Manager Brief = the CHATTER CARD) ──
    // Username match is exact/unambiguous; name match is creator-scoped and
    // skips when it spans multiple usernames (the Chris/Bren duplicate trap).
    let dossier = null
    const tryQueries = []
    if (fan) tryQueries.push({ q: `{OF Username} = ${quoteAirtableString(fan)}`, byName: false })
    const nm = fanName || fan
    if (nm) tryQueries.push({ q: `{Fan Name} = ${quoteAirtableString(nm)}`, byName: true })
    for (const { q, byName } of tryQueries) {
      const recs = await atAll(FAN_ANALYSIS_TABLE, { filterByFormula: q, 'sort[0][field]': 'Analyzed Date', 'sort[0][direction]': 'desc' }, 1)
      const withCard = recs.filter((r) => r.fields['Manager Brief'])
      if (!withCard.length) continue
      const sameCreator = withCard.filter((r) => creatorNames.some((n) => String(r.fields['Creator'] || '').toLowerCase() === String(n).toLowerCase()))
      const pool = sameCreator.length ? sameCreator : withCard
      if (byName) {
        const usernames = new Set(pool.map((r) => String(r.fields['OF Username'] || '').toLowerCase()).filter(Boolean))
        if (usernames.size > 1) continue // ambiguous name → don't guess
      }
      dossier = pool[0].fields['Manager Brief']
      break
    }

    // ── Build context from whatever the operator has loaded in the thread ──
    // Suggest never pulls; it reads what's there (grab more from OF separately).
    // Cap at 120 to bound tokens.
    const windowMsgs = messages.slice(-120)
    const recent = windowMsgs.map((m) => {
      const who = m.dir === 'in' ? 'FAN' : 'CREATOR'
      const bought = (m.dir === 'sale' || m.dir === 'unlock') ? ` [bought${m.price ? ` $${m.price}` : ''}]` : ''
      return `${who}: ${strip(m.text)}${bought}`
    }).filter((l) => l.length > 8).join('\n')
    // Her real outbound to THIS fan = free, perfect few-shot for her voice.
    const herLines = windowMsgs.filter((m) => m.dir === 'out' && strip(m.text))
      .slice(-8).map((m) => `- ${strip(m.text).slice(0, 200)}`).join('\n')
    // ── Engagement spine: is he actually here, or ghosting? ──────────────────
    // Suggest was tone-deaf to silence — it answered the last fan line as if
    // fresh, even after weeks of unanswered chatter messages (it once implied a
    // session that never happened). Ground it in the real state instead.
    const nowMs = Date.now()
    const lastFan = [...windowMsgs].reverse().find((m) => m.dir === 'in' && strip(m.text))
    const lastFanAt = lastFan?.at ? new Date(lastFan.at).getTime() : null
    const daysSinceFan = lastFanAt ? Math.floor((nowMs - lastFanAt) / 86400000) : null
    let unanswered = 0 // creator messages sent since his last reply, still unanswered
    for (let i = windowMsgs.length - 1; i >= 0; i--) {
      const m = windowMsgs[i]
      if (m.dir === 'in' && strip(m.text)) break
      if (m.dir === 'out' && strip(m.text)) unanswered++
    }
    const ghosting = (daysSinceFan != null && daysSinceFan >= 5) || unanswered >= 2
    const tier = daysSinceFan == null ? 'no reply on record'
      : daysSinceFan <= 2 ? 'ACTIVE'
      : daysSinceFan <= 14 ? 'COOLING'
      : daysSinceFan <= 45 ? 'DORMANT' : 'COLD'
    const engagementBlock = lastFan
      ? `CURRENT ENGAGEMENT STATE — obey this over the vibe of any single old line:
- He last replied ${daysSinceFan != null ? `${daysSinceFan} day(s) ago` : 'a while ago'}${lastFanAt ? ` (${new Date(lastFanAt).toISOString().slice(0, 10)})` : ''}: "${strip(lastFan.text).slice(0, 140)}"
- Since then the chatter has sent ${unanswered} message(s) with NO reply from him.
- Status: ${tier}.${ghosting ? `
- He is IGNORING / has gone quiet. This is a RE-ENGAGEMENT after silence, NOT a fresh continuation. Do NOT write as if a warm exchange or session just happened, do NOT thank him for a good time, do NOT invent any recent contact. He has ALREADY gotten several "i miss you / don't leave me hanging" messages — do NOT pile on more neediness or guilt-trip him. Draft ONE short, breezy, genuinely no-pressure opener that makes it easy and appealing to reply (light curiosity or a change of energy). Never beg.` : ''}`
      : `He hasn't replied in the loaded thread — draft a warm, low-pressure re-open. Do not invent past contact.`

    const prompt = `You are drafting the NEXT message a chatter will send AS ${aka} to ONE fan on OnlyFans. Write in FIRST PERSON as her. This is a SUGGESTION a human will review before sending, so make it genuinely good.

${voiceCard ? `HER VOICE CARD (from her own onboarding survey — this is how SHE talks; use her exact pet names, phrases, and emojis, and NEVER use anything in the NEVER list):\n${voiceCard.text}\n\n` : ''}${voice ? `HER VOICE:\n${voice}\n\n` : ''}${herLines ? `HOW SHE ACTUALLY TEXTS THIS FAN (match this tone, length, and style closely):\n${herLines}\n\n` : ''}${dossier ? `THIS FAN'S PROFILE (from full-history analysis — obey it):\n${String(dossier).trim()}\n\n` : `(No deep profile on this fan yet — go off the thread and her voice.)\n\n`}RECENT THREAD (oldest to newest):
${recent || '(no prior messages)'}

${engagementBlock}

Write TWO alternative replies she could send next. Rules:
- Ground every reply in the CURRENT ENGAGEMENT STATE above. If he has gone quiet, the reply MUST fit a re-engagement after silence — never one that assumes a recent positive interaction or session.
- First person AS her. Casual real-girl texting: contractions, lowercase is fine, warm. NO em dashes or double hyphens, no semicolons. Short — one or two sentences.
- Sound like HER: use the pet names / signature phrases / emojis from her Voice Card, and obey its NEVER list to the letter (never use a banned word or raise an off-limits topic).
- Obey the fan profile if present: stay inside his PRICE band, only push what he actually buys, never do anything on his NEVER list, honor any stated boundary.
- A waiting deal or a thing he asked for is fair to nudge, but naturally, never a hard sell.
- Do NOT invent facts about her life or his that aren't in the thread or profile — especially do NOT fabricate a recent conversation, session, or "good time" that isn't in the thread.
Return STRICT JSON only, no prose:
{"suggestions":["reply one","reply two"],"note":"one short line: the REAL state (e.g. ghosting X days, re-engage) + what to avoid"}`

    const resp = await anthropic.messages.create({
      // Sonnet for now — draft replies are cheap + frequent; Evan will bump to
      // Opus if quality isn't good enough. ($3/$15 vs Opus $5/$25 per MTok.)
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = resp.content?.map((b) => b.text || '').join('') || '{}'
    const m = text.match(/\{[\s\S]*\}/)
    let parsed = { suggestions: [], note: '' }
    try { parsed = { suggestions: [], note: '', ...(m ? JSON.parse(m[0]) : {}) } } catch { /* leave empty */ }

    return NextResponse.json({
      creator: aka,
      suggestions: parsed.suggestions || [],
      note: parsed.note || '',
      usedProfile: !!dossier,
      usedVoice: !!voice,
      usedVoiceCard: !!voiceCard,
      voiceCardAnswers: voiceCard?.answerCount || 0,
      fewShot: !!herLines,
      usedCount: windowMsgs.length,
    })
  } catch (err) {
    console.error('[live-chat suggest]', err?.message || err)
    return NextResponse.json({ error: err?.message || 'suggest failed' }, { status: 500 })
  }
}
