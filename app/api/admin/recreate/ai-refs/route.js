import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'

export const dynamic = 'force-dynamic'

// GET ?creatorId= — the creator's approved AI reference images (identity
// anchors for reference-to-video). Feeds the Text-to-Video workflow.
export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const creatorId = new URL(request.url).searchParams.get('creatorId')
    if (!creatorId) return NextResponse.json({ error: 'creatorId required' }, { status: 400 })
    const records = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(creatorId)}`,
      fields: ['AKA', 'Creator', 'AI Ref Front', 'AI Ref Face', 'AI Ref Back', 'AI Ref Inputs'],
      maxRecords: 1,
    })
    const f = records[0]?.fields || {}
    // REAL photos only (AI Ref Inputs) — never the AI-generated outputs
    // (Evan, 2026-07-23). Mirrors the animate route's selection exactly:
    // 3 face + 3 front + 1 back, topped up to Grok's 7-image cap.
    const inputs = f['AI Ref Inputs'] || []
    const by = (p, label) => inputs
      .filter((a) => (a.filename || '').startsWith(p))
      .map((a) => ({ label, url: a.url, thumb: a.thumbnails?.large?.url || a.url }))
    const face = by('Close Up Face input_', 'Face'), front = by('Front View input_', 'Front'), back = by('Back View input_', 'Back')
    const refs = [...face.slice(0, 3), ...front.slice(0, 3), ...back.slice(0, 1)]
    for (const pool of [face.slice(3), front.slice(3), back.slice(1)]) {
      for (const r of pool) { if (refs.length >= 7) break; refs.push(r) }
    }
    return NextResponse.json({ aka: f['AKA'] || f['Creator'] || '', refs: refs.slice(0, 7) })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
