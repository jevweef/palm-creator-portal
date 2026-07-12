import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireAdmin } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'

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
  try { await requireAdmin() } catch (e) { return e }
  try {
    const body = await request.json()
    const account = String(body.account || '')
    const fan = String(body.fan || '')          // username or name key from the URL
    const fanName = String(body.fanName || '')   // human display name if the UI has it
    const messages = Array.isArray(body.messages) ? body.messages : []
    if (!account || !fan) return NextResponse.json({ error: 'account and fan required' }, { status: 400 })

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
    const lastFan = [...windowMsgs].reverse().find((m) => m.dir === 'in' && strip(m.text))

    const prompt = `You are drafting the NEXT message a chatter will send AS ${aka} to ONE fan on OnlyFans. Write in FIRST PERSON as her. This is a SUGGESTION a human will review before sending, so make it genuinely good.

${voice ? `HER VOICE:\n${voice}\n\n` : ''}${herLines ? `HOW SHE ACTUALLY TEXTS THIS FAN (match this tone, length, and style closely):\n${herLines}\n\n` : ''}${dossier ? `THIS FAN'S PROFILE (from full-history analysis — obey it):\n${String(dossier).trim()}\n\n` : `(No deep profile on this fan yet — go off the thread and her voice.)\n\n`}RECENT THREAD (oldest to newest):
${recent || '(no prior messages)'}

${lastFan ? `The fan's latest message to answer: "${strip(lastFan.text)}"` : 'The fan has gone quiet — draft a warm, low-pressure re-open.'}

Write TWO alternative replies she could send next. Rules:
- First person AS her. Casual real-girl texting: contractions, lowercase is fine, warm. NO em dashes or double hyphens, no semicolons. Short — one or two sentences.
- Obey the fan profile if present: stay inside his PRICE band, only push what he actually buys, never do anything on his NEVER list, honor any stated boundary.
- A waiting deal or a thing he asked for is fair to nudge, but naturally, never a hard sell.
- Do NOT invent facts about her life or his that aren't in the thread or profile.
Return STRICT JSON only, no prose:
{"suggestions":["reply one","reply two"],"note":"one short line: what he wants right now / what to avoid"}`

    const resp = await anthropic.messages.create({
      model: 'claude-opus-4-8',
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
      fewShot: !!herLines,
      usedCount: windowMsgs.length,
    })
  } catch (err) {
    console.error('[live-chat suggest]', err?.message || err)
    return NextResponse.json({ error: err?.message || 'suggest failed' }, { status: 500 })
  }
}
