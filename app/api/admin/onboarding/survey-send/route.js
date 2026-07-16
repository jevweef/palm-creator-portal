import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'

export const dynamic = 'force-dynamic'

const execFileP = promisify(execFile)
// LOCAL-ONLY engine: renders the PDF (chromium) + delivers via iMessage. Lives in
// ~/.claude-pw-tools (has playwright). Only works when the dev server runs on the Mac.
const SCRIPT = '/Users/jevanleith/.claude-pw-tools/send-survey-to-chat.mjs'

function parseResult(stdout) {
  const line = String(stdout || '').split('\n').reverse().find((l) => l.startsWith('__RESULT__'))
  if (!line) return null
  try { return JSON.parse(line.slice('__RESULT__'.length)) } catch { return null }
}

// POST /api/admin/onboarding/survey-send
// Body: { hqId, mode: 'preview' | 'send' }
//   preview → build the PDF + CSV and open them on the Mac (review before sending)
//   send    → build + deliver to the Palm Chatting iMessage group + stamp Airtable
export async function POST(request) {
  try {
    await requireAdmin()
    const { hqId, mode } = await request.json()
    if (!hqId || !/^rec[A-Za-z0-9]{14}$/.test(hqId)) {
      return NextResponse.json({ error: 'valid hqId required' }, { status: 400 })
    }
    // The generator (chromium PDF + iMessage) only exists on the office Mac dev
    // server. On the live site the script isn't present — return a clear message
    // instead of a scary "generator failed" error.
    if (!existsSync(SCRIPT)) {
      return NextResponse.json({ error: 'Survey send/preview only runs from the office Mac (localhost). It builds the PDF and texts it to the Palm Chatting group there.' }, { status: 400 })
    }

    const send = mode === 'send'
    const scriptArgs = [SCRIPT, '--hqId', hqId, '--json', ...(send ? ['--send'] : [])]

    let stdout
    try {
      ({ stdout } = await execFileP(process.execPath, scriptArgs, { timeout: 60000, maxBuffer: 4 * 1024 * 1024 }))
    } catch (e) {
      const detail = (e.stderr || e.message || '').toString().slice(0, 400)
      return NextResponse.json({ error: `Generator failed (this only runs on the Mac dev server): ${detail}` }, { status: 500 })
    }

    const result = parseResult(stdout)
    if (!result) return NextResponse.json({ error: 'No result from generator' }, { status: 500 })

    // Preview no longer opens the files in Numbers/Acrobat — the client renders
    // `result.items` (the answered Q&A) in an in-app modal instead.
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[onboarding/survey-send] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
