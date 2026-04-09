export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdminOrEditor } from '@/lib/adminAuth'
import { getTop50USA } from '@/lib/spotify'

export async function GET() {
  try { await requireAdminOrEditor() } catch (e) { return e }

  try {
    const tracks = await getTop50USA()
    return NextResponse.json({ ok: true, tracks })
  } catch (err) {
    console.error('[Music Charts] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
