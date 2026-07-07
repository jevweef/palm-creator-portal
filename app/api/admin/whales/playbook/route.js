import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

// GET — the Whale Win-Back Playbook, synthesized from the OFM research corpus
// (research/knowledge/whale-playbook.md). Rendered on the whale-hunting page
// and injected (condensed) into the whale-analysis prompt so chatter briefs
// prescribe research-backed plays.
export async function GET() {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const p = path.join(process.cwd(), 'research', 'knowledge', 'whale-playbook.md')
    const markdown = fs.readFileSync(p, 'utf8')
    return NextResponse.json({ markdown })
  } catch {
    return NextResponse.json({ markdown: null })
  }
}
