export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecordsByIds } from '@/lib/adminAuth'

// POST /api/admin/posts/status — body: { postIds: string[] }
// Returns the live Status / Telegram Sent At / Telegram Message ID / Send Error
// for each requested Post. Used by the Grid Planner bulk-send to compute the
// final "X sent · Y failed" counter from Airtable ground truth instead of
// summing per-tick results (the latter races with the scheduled Vercel cron
// over the same queue and silently under-counts).
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { postIds } = await request.json()
    if (!Array.isArray(postIds) || !postIds.length) {
      return NextResponse.json({ statuses: {} })
    }

    const records = await fetchAirtableRecordsByIds('Posts', postIds, {
      fields: ['Status', 'Telegram Sent At', 'Telegram Message ID', 'Send Error'],
    })

    const statuses = {}
    for (const r of records) {
      const f = r.fields || {}
      const statusName = typeof f.Status === 'string' ? f.Status : (f.Status?.name || '')
      statuses[r.id] = {
        status: statusName,
        sentAt: f['Telegram Sent At'] || null,
        messageId: f['Telegram Message ID'] || null,
        error: f['Send Error'] || null,
      }
    }

    return NextResponse.json({ statuses })
  } catch (err) {
    console.error('[Posts/status] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
