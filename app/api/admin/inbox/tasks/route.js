// List tasks extracted from inbox conversations. Default scope: open tasks
// only, newest first. Supports ?status=Done|Snoozed|Dismissed|Open|all and
// ?owner=Evan|Josh|Other for filtering.

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'

const TASKS_TABLE = 'Inbox Tasks'

export async function GET(request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const url = new URL(request.url)
  const status = url.searchParams.get('status') || 'Open'
  const owner = url.searchParams.get('owner') || null

  const filters = []
  if (status !== 'all') filters.push(`{Status} = '${status}'`)
  if (owner) filters.push(`{Owner} = '${owner}'`)
  const formula = filters.length === 0 ? undefined : (filters.length === 1 ? filters[0] : `AND(${filters.join(',')})`)

  try {
    const records = await fetchAirtableRecords(TASKS_TABLE, {
      filterByFormula: formula,
      sort: [{ field: 'Detected At', direction: 'desc' }],
      maxRecords: 200,
    })

    const tasks = records.map(r => ({
      id: r.id,
      task: r.fields?.Task || '',
      status: r.fields?.Status || 'Open',
      owner: r.fields?.Owner || 'Other',
      ownerUsername: r.fields?.['Owner Username'] || '',
      creatorAka: r.fields?.['Creator AKA'] || '',
      sourceQuote: r.fields?.['Source Quote'] || '',
      sourceChatIds: r.fields?.['Source Chat'] || [],
      urgency: r.fields?.Urgency || 'Soon',
      confidence: r.fields?.['AI Confidence'] || null,
      detectedAt: r.fields?.['Detected At'] || null,
      notes: r.fields?.Notes || '',
    }))

    return NextResponse.json({ tasks })
  } catch (err) {
    console.error('[inbox/tasks] list error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
