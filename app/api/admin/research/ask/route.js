// Ask-the-mentor Q&A over the OFM research corpus.
//
// Flow: retrieve the most relevant findings + transcript excerpts from the local
// knowledge base (no embeddings — term-overlap + consensus boost, same logic as
// scripts/research_ask.py), then ask Claude to answer AS PALM'S MENTOR: advisory,
// grounded only in the retrieved material, every claim cited to a source video +
// timestamp, comparing against how Palm operates. Admin-gated.
import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { requireAdmin } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ROOT = process.cwd()
const KBF = path.join(ROOT, 'research', 'knowledge', 'findings.json')
const TRANS = path.join(ROOT, 'research', 'transcripts')
const META = path.join(ROOT, 'research', 'meta')
const BASELINE = path.join(ROOT, 'docs', 'palm-operating-system.md')

const STOP = new Set(('a an the and or but of to in on for with your you their our we they it is are be ' +
  'this that how what why when do does can will should us i would like about more most than then so if ' +
  'not no get make have has at by from into over per ofm onlyfans only fans').split(' '))
const toks = s => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
  .filter(t => t.length > 2 && !STOP.has(t))

function readJson(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fb } }

function score(qset, text) {
  const tt = toks(text); if (!tt.length) return 0
  let s = 0; for (const t of tt) if (qset.has(t)) s++
  return s
}

function rankFindings(qset, kb, n) {
  const boost = { high: 6, medium: 3, low: 0 }
  return kb.findings
    .map(f => {
      const blob = [f.title, f.topic, f.department, f.palm_comparison?.vs_us,
        f.palm_comparison?.recommendation,
        ...(f.variants || []).map(v => `${v.claim} ${v.what_they_do}`)].join(' ')
      return { f, s: score(qset, blob) + (boost[f.consensus?.label] || 0) }
    })
    .filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, n).map(x => x.f)
}

function rankChunks(qset, n) {
  let files = []
  try { files = fs.readdirSync(TRANS).filter(f => f.endsWith('.md') && f !== 'README.md') } catch { return [] }
  const hits = []
  for (const fn of files) {
    const txt = fs.readFileSync(path.join(TRANS, fn), 'utf8')
    const chan = (txt.slice(0, 500).match(/channel:\s*"([^"]*)"/) || [])[1] || '?'
    const title = (txt.slice(0, 500).match(/title:\s*"([^"]*)"/) || [])[1] || fn
    for (const para of txt.split('\n\n')) {
      const m = para.trim().match(/^\[(\d+:\d{2}(?::\d{2})?)\]\((https:\/\/[^)]+)\)\s*([\s\S]*)/)
      if (!m) continue
      const s = score(qset, m[3])
      if (s >= 2) hits.push({ s, channel: chan, title, ts: m[1], url: m[2], text: m[3].replace(/\s+/g, ' ').trim().slice(0, 360) })
    }
  }
  return hits.sort((a, b) => b.s - a.s).slice(0, n)
}

export async function POST(req) {
  try { await requireAdmin() } catch (e) {
    if (e instanceof Response) return e
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { question } = await req.json().catch(() => ({}))
  if (!question || !question.trim()) return NextResponse.json({ error: 'Empty question' }, { status: 400 })

  const kb = readJson(KBF, { findings: [] })
  const qset = new Set(toks(question))
  const findings = rankFindings(qset, kb, 8)
  const chunks = rankChunks(qset, 6)
  const baseline = (() => { try { return fs.readFileSync(BASELINE, 'utf8').slice(0, 6000) } catch { return '' } })()

  if (!findings.length && !chunks.length) {
    return NextResponse.json({ answer: "I don't have research on that yet — nothing in the corpus matches. Try rephrasing, or add more source videos.", findings: [], chunks: [] })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  const context = [
    '## How Palm operates (the comparison lens)\n' + baseline,
    '## Relevant findings (consensus = how many independent creators agree)\n' +
      findings.map((f, i) => `[F${i + 1}] (${f.consensus?.label} consensus, ${f.consensus?.creators} creators: ${(f.creators || []).join(', ')}) ${f.department} — ${f.title}\n  What they do: ${(f.variants?.[0]?.what_they_do || '').slice(0, 300)}\n  Vs Palm: ${f.palm_comparison?.vs_us || ''}\n  Change: ${f.palm_comparison?.recommendation || ''}`).join('\n\n'),
    '## Supporting transcript excerpts (quote these with timestamps)\n' +
      chunks.map((c, i) => `[T${i + 1}] ${c.channel} "${c.title}" @ ${c.ts} — ${c.url}\n  "${c.text}"`).join('\n\n'),
  ].join('\n\n')

  // No key → return retrieval-only (Claude-in-session can still answer from this).
  if (!apiKey) {
    return NextResponse.json({ answer: null, retrievalOnly: true, context, findings, chunks })
  }

  const system = `You are Palm Management's OFM business mentor. Palm is an OnlyFans-management agency
for REAL creators (chatting is currently outsourced; in-house + AI chat are roadmap). Answer the
user's question using ONLY the provided findings, transcript excerpts, and Palm baseline. Be a
mentor, not a summarizer: give a direct recommendation, say WHY, compare to how Palm operates, and
flag where the advice is low-confidence or unverifiable (these are YouTube gurus). Cite sources
inline like [F2] or [T3] and prefer higher-consensus findings. If the context doesn't answer it,
say so plainly. Keep it tight and actionable.`

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system,
        messages: [{ role: 'user', content: `QUESTION: ${question}\n\n${context}` }],
      }),
    })
    if (!r.ok) {
      const body = await r.text()
      return NextResponse.json({ answer: null, retrievalOnly: true, context, findings, chunks, error: `LLM ${r.status}: ${body.slice(0, 200)}` })
    }
    const data = await r.json()
    const answer = (data.content || []).map(c => c.text || '').join('').trim()
    return NextResponse.json({ answer, findings, chunks })
  } catch (e) {
    return NextResponse.json({ answer: null, retrievalOnly: true, context, findings, chunks, error: String(e).slice(0, 200) })
  }
}
