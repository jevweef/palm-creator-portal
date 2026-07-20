import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { fetchHqRecord } from '@/lib/hqAirtable'
import { quoteAirtableString } from '@/lib/airtableFormula'
import { ATEAM_QUESTIONS } from '@/lib/onboarding/ateamSurveyMap'

export const dynamic = 'force-dynamic'

const SURVEY_TABLE = 'Onboarding Survey Responses'
const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'

// GET /api/admin/onboarding/ateam-export?hqId=recXXX[&format=csv]
// Builds the A-team CSV: the exact 62 CREATOR INTAKE FORM questions, in Typeform
// slide order, filled from this creator's onboarding survey answers. This is what
// we send the A-team so they don't survey our creators directly.
export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e instanceof Response ? e : NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { searchParams } = new URL(request.url)
  const hqId = searchParams.get('hqId')
  const format = searchParams.get('format') || 'csv'
  if (!hqId) return NextResponse.json({ error: 'hqId required' }, { status: 400 })

  try {
    const [rows, hq] = await Promise.all([
      fetchAirtableRecords(SURVEY_TABLE, {
        filterByFormula: `{HQ Creator ID} = ${quoteAirtableString(hqId)}`,
        fields: ['Question Key', 'Answer'],
      }),
      fetchHqRecord(HQ_CREATORS, hqId).catch(() => null),
    ])
    if (!rows.length) return NextResponse.json({ error: 'No survey answers found for this creator' }, { status: 404 })

    const ans = {}
    for (const r of rows) ans[r.fields['Question Key']] = r.fields['Answer'] || ''
    const legal = hq?.fields?.['Full Legal Name'] || hq?.fields?.['Legal Name'] || hq?.fields?.['Creator'] || hq?.fields?.['Name'] || ''

    const valueFor = (key) => {
      if (key === '__LEGAL__') return legal
      if (!key) return ''
      return ans[key] || ''
    }

    const rowsOut = ATEAM_QUESTIONS.map((q) => ({ n: q.n, question: q.question, answer: valueFor(q.key) }))

    if (format === 'json') {
      const missing = rowsOut.filter((r) => !r.answer).map((r) => r.n)
      return NextResponse.json({ hqId, legalName: legal, questions: rowsOut, missing })
    }

    const esc = (s) => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`
    const csv = ['#,Question,Answer', ...rowsOut.map((r) => `${r.n},${esc(r.question)},${esc(r.answer)}`)].join('\n')
    const safeName = (legal || hqId).replace(/[^\w-]+/g, '-')
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="Ateam-Survey-${safeName}.csv"`,
      },
    })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
