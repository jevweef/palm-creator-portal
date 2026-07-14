export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'
import { requireAdmin } from '@/lib/adminAuth'

// POST /api/admin/team/live-chat-access  { userId, enabled }
//
// Admin-only. Flips the per-user `liveChatAccess` flag on a chat manager's Clerk
// publicMetadata. requireLiveChatAccess() reads this fresh (Backend API, not the
// cached token) on every /api/admin/live-chat/* call, so turning it OFF here
// cuts her Live Chat view on her very next request — an instant kill-switch.
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const { userId, enabled } = await request.json()
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

    const client = await clerkClient()
    const user = await client.users.getUser(userId)
    if (user?.publicMetadata?.role !== 'chat_manager') {
      return NextResponse.json({ error: 'User is not a chat manager' }, { status: 400 })
    }

    // Merge — never clobber role / chatTeam / other metadata.
    await client.users.updateUser(userId, {
      publicMetadata: { ...(user.publicMetadata || {}), liveChatAccess: !!enabled },
    })

    return NextResponse.json({ ok: true, userId, liveChatAccess: !!enabled })
  } catch (err) {
    console.error('[team/live-chat-access]', err?.message || err)
    return NextResponse.json({ error: err?.message || 'update failed' }, { status: 500 })
  }
}
