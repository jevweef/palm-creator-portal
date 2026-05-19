import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'

// Lists every creator that has AI Super Clone reference photos on
// file (NOT TJP-gated — Stage B is creator-driven and any creator
// with refs can be composited). Returns front/back/face counts so
// the UI can show readiness.
export async function GET() {
  try {
    await requireAdmin()
    const recs = await fetchAirtableRecords('Palm Creators', {
      fields: ['AKA', 'Creator', 'AI Ref Inputs'],
    })
    const creators = recs
      .map(r => {
        const f = r.fields || {}
        const refs = f['AI Ref Inputs'] || []
        const count = (p) => refs.filter(a => a.filename?.startsWith(p)).length
        const front = count('Front View input_')
        const back = count('Back View input_')
        const face = count('Close Up Face input_')
        return {
          id: r.id,
          name: f.AKA || f.Creator || 'Unknown',
          front, back, face,
          total: front + back + face,
        }
      })
      .filter(c => c.total > 0)
      .sort((a, b) => a.name.localeCompare(b.name))
    return NextResponse.json({ creators })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
