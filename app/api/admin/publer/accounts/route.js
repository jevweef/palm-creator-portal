export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { listAccounts } from '@/lib/publer'

// 5-minute in-memory cache. Lives for the lifetime of the serverless function
// instance — long enough to coalesce burst clicks from the admin UI but short
// enough that a newly-connected Publer account shows up within a minute or two
// after a fresh server cold-start. The admin can also force a refresh by
// POSTing to /api/admin/publer/sync-accounts which bypasses this cache.
const CACHE_TTL_MS = 5 * 60 * 1000
let cache = { ts: 0, data: null }

// GET /api/admin/publer/accounts
//   ?fresh=1 → bypass cache, fetch live from Publer.
//
// Returns the raw Publer /accounts response. Phase 1 use case is the admin
// mapping UI which needs to show every connected Publer account so the admin
// can pair it with a Palm Creator + Account Type.
export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { searchParams } = new URL(request.url)
    const fresh = searchParams.get('fresh') === '1'

    const now = Date.now()
    if (!fresh && cache.data && (now - cache.ts) < CACHE_TTL_MS) {
      return NextResponse.json({ ok: true, cached: true, ageMs: now - cache.ts, ...cache.data })
    }

    const data = await listAccounts()
    cache = { ts: now, data }
    return NextResponse.json({ ok: true, cached: false, ...data })
  } catch (err) {
    console.error('[admin/publer/accounts] error:', err)
    return NextResponse.json(
      { error: err.message, publerStatus: err.status || null },
      { status: err.status && err.status < 500 ? err.status : 500 }
    )
  }
}
