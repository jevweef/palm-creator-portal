export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { buildContentRequestOverview } from '@/lib/contentRequests'

// Admin oversight of content-request uploads, grouped per creator for a given
// month. NO content preview — counts, times, Dropbox links, and errors only.
// Admin sees every creator (no team scoping).
export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const month = new URL(request.url).searchParams.get('month') || undefined
    const data = await buildContentRequestOverview({ month })
    return NextResponse.json(data)
  } catch (err) {
    console.error('[admin/content-requests] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
