import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { patchHqRecord } from '@/lib/hqAirtable'

export const dynamic = 'force-dynamic'

const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'
// Mirror the singleSelect choices on HQ Creators 'Chat Team' (fld4wToCuDZmVmFHb).
const VALID_TEAMS = new Set(['A Team', 'B Team'])

// PATCH /api/admin/onboarding/chat-team
// Body: { hqId, chatTeam }  — chatTeam must be a valid choice, or null to clear.
export async function PATCH(request) {
  try {
    await requireAdmin()

    const { hqId, chatTeam } = await request.json()
    if (!hqId) return NextResponse.json({ error: 'hqId is required' }, { status: 400 })
    if (chatTeam !== null && !VALID_TEAMS.has(chatTeam)) {
      return NextResponse.json({ error: `chatTeam must be one of: ${[...VALID_TEAMS].join(', ')} (or null)` }, { status: 400 })
    }

    await patchHqRecord(HQ_CREATORS, hqId, { 'Chat Team': chatTeam })
    return NextResponse.json({ success: true, chatTeam })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[onboarding/chat-team PATCH] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
