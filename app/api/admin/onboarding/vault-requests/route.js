import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { ensureVaultRequests } from '@/lib/onboarding/vaultRequests'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST { hqId } — ensure one Active vault Content Request per active OnlyFans
// Revenue Account (the board card's button; also fired automatically when a
// Revenue Account record is created).
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const { hqId } = await request.json()
    if (!hqId) return NextResponse.json({ error: 'hqId required' }, { status: 400 })
    const result = await ensureVaultRequests(hqId)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[onboarding/vault-requests] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
