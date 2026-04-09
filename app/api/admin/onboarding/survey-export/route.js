import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

const SURVEY_TABLE = 'Onboarding Survey Responses'

/**
 * GET /api/admin/onboarding/survey-export?hqId=recXXX&format=csv
 * Exports a creator's survey answers grouped by section.
 * format=csv returns a downloadable CSV file.
 * format=json (default) returns structured JSON.
 */
export async function GET(request) {
  try {
    await requireAdmin()

    const { searchParams } = new URL(request.url)
    const hqId = searchParams.get('hqId')
    const format = searchParams.get('format') || 'json'

    if (!hqId) {
      return NextResponse.json({ error: 'hqId required' }, { status: 400 })
    }

    const records = await fetchAirtableRecords(SURVEY_TABLE, {
      filterByFormula: `{HQ Creator ID}="${hqId}"`,
      fields: ['Question Key', 'Question Text', 'Answer', 'Team Tag', 'Section'],
    })

    if (records.length === 0) {
      return NextResponse.json({ error: 'No survey answers found' }, { status: 404 })
    }

    // Group by section, preserving order
    const sectionOrder = ['Identity', 'Personality & Voice', 'Chat Style', 'Content & Pricing', 'Favorites & Fun', 'Response Templates']
    const grouped = {}
    for (const sec of sectionOrder) grouped[sec] = []

    for (const rec of records) {
      const section = rec.fields['Section'] || 'Other'
      const entry = {
        question: rec.fields['Question Text'] || '',
        answer: rec.fields['Answer'] || '',
        teamTag: (rec.fields['Team Tag'] || []).join(', '),
      }
      if (!grouped[section]) grouped[section] = []
      grouped[section].push(entry)
    }

    if (format === 'csv') {
      const rows = ['Section,Question,Answer,Team']
      for (const [section, entries] of Object.entries(grouped)) {
        for (const e of entries) {
          if (!e.answer) continue
          const escapeCsv = (s) => `"${(s || '').replace(/"/g, '""')}"`
          rows.push(`${escapeCsv(section)},${escapeCsv(e.question)},${escapeCsv(e.answer)},${escapeCsv(e.teamTag)}`)
        }
      }

      return new Response(rows.join('\n'), {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="survey-${hqId}.csv"`,
        },
      })
    }

    return NextResponse.json({ hqId, sections: grouped })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[survey-export] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
