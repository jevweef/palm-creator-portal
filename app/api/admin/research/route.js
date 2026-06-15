// Research API — serves the OFM knowledge base to the Research tab.
//
// Reads the merged corpus (research/knowledge/findings.json), the department
// taxonomy (research/knowledge/taxonomy.json), per-video credibility stats
// (research/meta/*.json), and any daily briefs (research/digests/daily/*.json),
// joins findings to video stats by video_id, and returns it all. File-backed
// (no Airtable yet) — ships with the deploy. Admin-gated like every admin API.
import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { requireAdmin } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

const ROOT = process.cwd()
const KB = path.join(ROOT, 'research', 'knowledge')
const META = path.join(ROOT, 'research', 'meta')
const DAILY = path.join(ROOT, 'research', 'digests', 'daily')

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fallback }
}

function loadDir(dir) {
  try {
    return fs.readdirSync(dir).filter(f => f.endsWith('.json'))
      .map(f => readJson(path.join(dir, f), null)).filter(Boolean)
  } catch { return [] }
}

export async function GET() {
  try { await requireAdmin() } catch (e) {
    if (e instanceof Response) return e
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const kb = readJson(path.join(KB, 'findings.json'), { findings: [] })
  const taxonomy = readJson(path.join(KB, 'taxonomy.json'), { departments: [] })

  // The mentor report — the headline advisory ("here's what to fix and why").
  let mentorReport = ''
  try { mentorReport = fs.readFileSync(path.join(ROOT, 'docs', 'palm-mentor-report.md'), 'utf8') } catch {}

  const stats = {}
  for (const arr of loadDir(META)) {
    if (Array.isArray(arr)) for (const v of arr) { if (v && v.id) stats[v.id] = v }
  }

  const daily = loadDir(DAILY).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))

  // Count distinct transcribed creators for a corpus-size signal.
  const creators = new Set()
  for (const f of kb.findings || []) for (const c of f.creators || []) creators.add(c)

  return NextResponse.json({
    findings: kb.findings || [],
    taxonomy: taxonomy.departments || [],
    stats,
    daily,
    mentorReport,
    corpus: { findings: (kb.findings || []).length, creators: creators.size },
  })
}
