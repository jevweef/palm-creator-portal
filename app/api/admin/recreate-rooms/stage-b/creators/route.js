import { NextResponse } from 'next/server'
import { requireAdminOrAiEditor, fetchAirtableRecords } from '@/lib/adminAuth'

// Lists every creator that has AI Super Clone reference photos on
// file (NOT TJP-gated — Stage B is creator-driven and any creator
// with refs can be composited). Returns front/back/face counts so
// the UI can show readiness.
export async function GET() {
  try {
    await requireAdminOrAiEditor()
    const recs = await fetchAirtableRecords('Palm Creators', {
      fields: ['AKA', 'Creator', 'AI Ref Inputs', 'AI Ref Front', 'AI Ref Back', 'AI Ref Face'],
    })
    const creators = recs
      .map(r => {
        const f = r.fields || {}
        // Prefer approved per-angle refs; fall back to the raw AI Ref
        // Inputs dump for creators not yet approved.
        let front = (f['AI Ref Front'] || []).length
        let back = (f['AI Ref Back'] || []).length
        let face = (f['AI Ref Face'] || []).length
        let approved = true
        if (front + back + face === 0) {
          approved = false
          const refs = f['AI Ref Inputs'] || []
          const count = (p) => refs.filter(a => a.filename?.startsWith(p)).length
          front = count('Front View input_')
          back = count('Back View input_')
          face = count('Close Up Face input_')
        }
        return {
          id: r.id,
          name: f.AKA || f.Creator || 'Unknown',
          front, back, face,
          approved,
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
