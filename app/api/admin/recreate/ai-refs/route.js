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
    const refs = []
    for (const [field, label] of [['AI Ref Front', 'Front'], ['AI Ref Face', 'Face'], ['AI Ref Back', 'Back']]) {
      const att = f[field]?.[0]
      if (att?.url) refs.push({ label, url: att.url, thumb: att.thumbnails?.large?.url || att.url })
    }
    const faceInputs = (f['AI Ref Inputs'] || []).filter((att) => /^Close Up Face input_/i.test(att.filename || ''))
    for (const att of faceInputs) {
      if (refs.length >= 7) break
      if (att.url) refs.push({ label: 'Face input', url: att.url, thumb: att.thumbnails?.large?.url || att.url })
    }
    return NextResponse.json({ aka: f['AKA'] || f['Creator'] || '', refs })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
