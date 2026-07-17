import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { fetchHqRecord } from '@/lib/hqAirtable'
import { SURVEY_QUESTIONS } from '@/lib/onboarding/surveyQuestions'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'

export const dynamic = 'force-dynamic'

const execFileP = promisify(execFile)
// LOCAL-ONLY delivery engine: renders the PDF (chromium) + texts it to the Palm
// Chatting group via iMessage/AppleScript. Lives in ~/.claude-pw-tools. Only the
// SEND step needs the office Mac — preview is built straight from Airtable below.
const SCRIPT = '/Users/jevanleith/.claude-pw-tools/send-survey-to-chat.mjs'
const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'
const SURVEY_TABLE = 'Onboarding Survey Responses' // Ops base

function parseResult(stdout) {
  const line = String(stdout || '').split('\n').reverse().find((l) => l.startsWith('__RESULT__'))
  if (!line) return null
  try { return JSON.parse(line.slice('__RESULT__'.length)) } catch { return null }
}

// Build the answered-Q&A brief straight from Airtable — no Mac, works anywhere
// (this is what the Preview modal renders). Mirrors the local generator's data
// build: HQ creator identity on top, then survey answers in our canonical order.
async function buildPreview(hqId) {
  const creator = await fetchHqRecord(HQ_CREATORS, hqId)
  const cf = creator.fields || {}
  const name = cf['Creator'] || ''
  const aka = cf['AKA'] || ''
  const team = cf['Chat Team'] || '(team unassigned)'

  const responses = await fetchAirtableRecords(SURVEY_TABLE, {
    filterByFormula: `{HQ Creator ID} = "${hqId}"`,
  })
  const respByKey = {}
  for (const r of responses) {
    const k = r.fields?.['Question Key']
    if (k) respByKey[k] = {
      answer: r.fields?.['Answer'] || '',
      text: r.fields?.['Question Text'] || k,
      section: r.fields?.['Section'] || 'Other',
    }
  }
  // Canonical order = the order questions appear in our portal survey definition.
  const orderIndex = Object.fromEntries(SURVEY_QUESTIONS.map((q, i) => [q.key, i]))
  const surveyRows = Object.entries(respByKey)
    .map(([k, v]) => ({ section: v.section, label: v.text, answer: String(v.answer || '').trim(), ord: orderIndex[k] ?? 9999 }))
    .sort((a, b) => a.ord - b.ord)

  const rows = [
    { section: 'Identity', label: 'Full name', answer: String(name || '').trim() },
    { section: 'Identity', label: 'Stage name / AKA', answer: String(aka || '').trim() },
    ...surveyRows,
  ]
  const answered = rows.filter((r) => r.answer)
  const skipped = rows.filter((r) => !r.answer)

  return {
    items: answered.map((r) => ({ section: r.section, label: r.label, answer: r.answer })),
    answered: answered.length,
    total: rows.length,
    skipped: skipped.map((r) => r.label),
    creator: name,
    team,
  }
}

// POST /api/admin/onboarding/survey-send
// Body: { hqId, mode: 'preview' | 'send' }
//   preview → build the answered Q&A from Airtable + return it for the modal (any host)
//   send    → build the PDF + text it to the Palm Chatting iMessage group (office Mac only)
export async function POST(request) {
  try {
    await requireAdmin()
    const { hqId, mode } = await request.json()
    if (!hqId || !/^rec[A-Za-z0-9]{14}$/.test(hqId)) {
      return NextResponse.json({ error: 'valid hqId required' }, { status: 400 })
    }

    // PREVIEW — server-side from Airtable, works on the live site.
    if (mode !== 'send') {
      const preview = await buildPreview(hqId)
      if (!preview.items.length) {
        return NextResponse.json({ error: 'No survey answers found yet for this creator.' }, { status: 400 })
      }
      return NextResponse.json({ success: true, ...preview })
    }

    // SEND — only the delivery (chromium PDF + iMessage to Palm Chatting) needs the Mac.
    if (!existsSync(SCRIPT)) {
      return NextResponse.json({ error: 'Sending to the chat team runs from the office Mac (it texts the PDF to the Palm Chatting group). Preview works anywhere — run Send from localhost for now.' }, { status: 400 })
    }
    const scriptArgs = [SCRIPT, '--hqId', hqId, '--json', '--send']
    let stdout
    try {
      ({ stdout } = await execFileP(process.execPath, scriptArgs, { timeout: 60000, maxBuffer: 4 * 1024 * 1024 }))
    } catch (e) {
      const detail = (e.stderr || e.message || '').toString().slice(0, 400)
      return NextResponse.json({ error: `Generator failed (this only runs on the Mac dev server): ${detail}` }, { status: 500 })
    }

    const result = parseResult(stdout)
    if (!result) return NextResponse.json({ error: 'No result from generator' }, { status: 500 })
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[onboarding/survey-send] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
