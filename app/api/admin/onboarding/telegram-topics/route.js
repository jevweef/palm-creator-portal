import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'
import { fetchHqRecord } from '@/lib/hqAirtable'
import { createSmmTopic, isSmmGroupConfigured } from '@/lib/telegramTopics'
import { quoteAirtableString } from '@/lib/airtableFormula'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'
const OPS_PALM_CREATORS = 'Palm Creators'

// POST { hqId } — create the creator's missing Telegram delivery topics in the
// SMM master group and write their thread ids to ops Palm Creators. These
// three fields (Telegram IG/FB/AI Topic ID) gate ALL Post-Prep / Penny / Grid
// Planner delivery and nothing else provisions them — this is the one-click
// that kills the portal's most silent per-creator blocker.
//
// Idempotent: a field that already has an id is left alone. AI topic is only
// created when TJP is enabled (AI content flows exist for the creator).
const CHANNELS = [
  { field: 'Telegram IG Topic ID', suffix: 'IG' },
  { field: 'Telegram FB Topic ID', suffix: 'FB' },
  { field: 'Telegram AI Topic ID', suffix: 'AI', tjpOnly: true },
]

export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { hqId } = await request.json()
    if (!hqId) return NextResponse.json({ error: 'hqId required' }, { status: 400 })
    if (!isSmmGroupConfigured()) {
      return NextResponse.json({ error: 'Telegram SMM group not configured (TELEGRAM_SMM_GROUP_CHAT_ID / TELEGRAM_BOT_TOKEN)' }, { status: 500 })
    }

    const creator = await fetchHqRecord(HQ_CREATORS, hqId)
    const cf = creator.fields || {}
    const aka = cf['AKA'] || cf['Creator'] || ''
    if (!aka) return NextResponse.json({ error: 'Creator has no AKA/name yet — save Basic info first' }, { status: 400 })

    const ops = await findOpsCreator(hqId, cf['Creator'], aka)
    if (!ops) return NextResponse.json({ error: 'No ops Palm Creators record for this creator' }, { status: 404 })
    const of_ = ops.fields || {}

    const created = {}
    const skipped = []
    for (const ch of CHANNELS) {
      if (ch.tjpOnly && of_['TJP Enabled'] !== true) { skipped.push(`${ch.suffix} (AI not enabled)`); continue }
      if (String(of_[ch.field] || '').trim()) { skipped.push(`${ch.suffix} (already set)`); continue }
      // Topic name mirrors the per-handle convention: AKA-first so the SMM
      // group's topic list groups by creator.
      const threadId = await createSmmTopic(`${aka} — ${ch.suffix}`)
      if (threadId == null) return NextResponse.json({ error: 'SMM group not configured' }, { status: 500 })
      created[ch.field] = String(threadId)
    }

    if (Object.keys(created).length) {
      await patchAirtableRecord(OPS_PALM_CREATORS, ops.id, created)
    }
    return NextResponse.json({ ok: true, created, skipped })
  } catch (err) {
    console.error('[onboarding/telegram-topics] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

async function findOpsCreator(hqId, name, aka) {
  try {
    const byLink = await fetchAirtableRecords(OPS_PALM_CREATORS, {
      filterByFormula: `{HQ Record ID}='${hqId}'`,
      maxRecords: 1,
    })
    if (byLink[0]) return byLink[0]
  } catch { /* fall through */ }
  const clauses = []
  if (name) clauses.push(`{Creator}=${quoteAirtableString(name)}`)
  if (aka) clauses.push(`{AKA}=${quoteAirtableString(aka)}`)
  if (!clauses.length) return null
  try {
    const byName = await fetchAirtableRecords(OPS_PALM_CREATORS, {
      filterByFormula: `OR(${clauses.join(',')})`,
      maxRecords: 1,
    })
    return byName[0] || null
  } catch { return null }
}
