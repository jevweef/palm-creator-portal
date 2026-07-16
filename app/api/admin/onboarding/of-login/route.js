import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { patchHqRecord } from '@/lib/hqAirtable'

export const dynamic = 'force-dynamic'

const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'

// Only these OF-login fields (on HQ Creators) are editable from the board's
// OF-login card. Field map: Free = OF Email / OF Password ;
// Paid/VIP = 2nd OF Email / 2nd OF Password.
const EDITABLE = new Set(['OF Email', 'OF Password', '2nd OF Email', '2nd OF Password'])

// PATCH /api/admin/onboarding/of-login
// Body: { hqId, fields: { 'OF Email'?, 'OF Password'?, '2nd OF Email'?, '2nd OF Password'? } }
// Writes the creator's OnlyFans logins to HQ Creators (cf), NOT the Onboarding record.
export async function PATCH(request) {
  try {
    await requireAdmin()

    const { hqId, fields } = await request.json()
    if (!hqId) return NextResponse.json({ error: 'hqId is required' }, { status: 400 })
    if (!fields || typeof fields !== 'object') {
      return NextResponse.json({ error: 'fields object is required' }, { status: 400 })
    }

    // Whitelist — silently drop anything not an OF-login field.
    const safe = {}
    for (const [k, v] of Object.entries(fields)) {
      if (EDITABLE.has(k)) safe[k] = typeof v === 'string' ? v.trim() : v
    }
    if (Object.keys(safe).length === 0) {
      return NextResponse.json({ error: 'No editable OF-login fields supplied' }, { status: 400 })
    }

    const updated = await patchHqRecord(HQ_CREATORS, hqId, safe)
    return NextResponse.json({ success: true, fields: updated.fields || {} })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[onboarding/of-login PATCH] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
