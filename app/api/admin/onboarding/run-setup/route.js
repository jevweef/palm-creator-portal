import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { runFullCreatorSetup } from '@/lib/creatorSetup'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/admin/onboarding/run-setup
 * Body: { creatorRecordId: "recXXX..." }
 *
 * Replaces the old Make.com automation:
 *   1. Creates 8 standard Social Account records (HQ Accounts table)
 *   2. Creates Credentials records linked to each Account
 *   3. Creates the Dropbox folder tree under /Palm Ops/Creators/{aka}/
 *   4. Creates two Dropbox file requests (Social + Long Form)
 *   5. Updates the HQ Onboarding record with all paths/URLs
 *
 * Idempotent — safe to re-run; will skip anything that already exists.
 */
export async function POST(request) {
  try {
    await requireAdmin()

    const { creatorRecordId } = await request.json()
    if (!creatorRecordId) {
      return NextResponse.json({ error: 'creatorRecordId is required' }, { status: 400 })
    }

    const result = await runFullCreatorSetup(creatorRecordId)

    return NextResponse.json({
      success: true,
      ...result,
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[onboarding/run-setup] Error:', err.message, err.stack)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
