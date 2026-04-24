export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdminOrSocialMedia, patchAirtableRecord } from '@/lib/adminAuth'

// POST /api/admin/sm-grid/mark-scheduled
// Body: { postId, scheduled: boolean }
export async function POST(request) {
  try { await requireAdminOrSocialMedia() } catch (e) { return e }

  try {
    const { postId, scheduled } = await request.json()
    if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })

    const fields = {
      'SMM Scheduled': !!scheduled,
      'SMM Scheduled At': scheduled ? new Date().toISOString() : null,
    }
    await patchAirtableRecord('Posts', postId, fields)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[mark-scheduled] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
