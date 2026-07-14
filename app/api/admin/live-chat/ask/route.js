import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireLiveChatAccess } from '@/lib/adminAuth'
import { guardAccount } from '@/lib/chatTeamScope'
import { resolveFanAnalysis } from '../brief/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ASK-ABOUT-THIS-FAN. The operator has a fan open in /admin/live-chat and asks
// Opus a question about him ("what does he like?", "why did he go quiet?",
// "what should I NOT bring up?"). Grounded in the fan's full-history analysis +
// the recent thread. Read-only advice — never sends anything. Answers ONLY from
// the provided material; says so when it doesn't know rather than inventing.

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const strip = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

export async function POST(request) {
  try { await requireLiveChatAccess() } catch (e) { return e }
  try {
    const body = await request.json()
    const account = String(body.account || '')
    const fan = String(body.fan || '')
    const fanName = String(body.fanName || '')
    const question = String(body.question || '').trim()
    const messages = Array.isArray(body.messages) ? body.messages : []
    if (!fan || !question) return NextResponse.json({ error: 'fan and question required' }, { status: 400 })
    try { await guardAccount(request, account) } catch (e) { return e }

    const f = await resolveFanAnalysis({ account, fan, fanName })

    const analysisBlock = f
      ? `FAN ANALYSIS (from full chat + transaction history — this is the source of truth about him):\n${String(f['Full Analysis'] || f['Manager Brief'] || '').trim()}`
      : '(No deep analysis on this fan yet — answer only from the recent thread below, and say clearly that there is no full profile yet.)'

    const recent = messages.slice(-80).map((m) => {
      const who = m.dir === 'in' ? 'FAN' : 'CREATOR'
      const bought = (m.dir === 'sale' || m.dir === 'unlock') ? ` [bought${m.price ? ` $${m.price}` : ''}]` : ''
      return `${who}: ${strip(m.text)}${bought}`
    }).filter((l) => l.length > 8).join('\n')

    const prompt = `You are helping a chat manager understand ONE OnlyFans fan so they can chat him well. Answer their question directly and concisely, grounded ONLY in the material below. If the answer isn't in the analysis or the thread, say so plainly — do NOT invent facts, dates, dollar amounts, or preferences.

${analysisBlock}

RECENT THREAD (oldest to newest):
${recent || '(no recent messages loaded)'}

CHAT MANAGER'S QUESTION: ${question}

Answer in a few sentences, plain language, specific and practical. If relevant, cite the evidence ("on Jun 20 he said..."). No preamble.`

    const resp = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 700,
      messages: [{ role: 'user', content: prompt }],
    })
    const answer = resp.content?.map((b) => b.text || '').join('').trim() || '(no answer)'
    return NextResponse.json({ answer, usedAnalysis: !!f })
  } catch (err) {
    console.error('[live-chat ask]', err?.message || err)
    return NextResponse.json({ error: err?.message || 'ask failed' }, { status: 500 })
  }
}
